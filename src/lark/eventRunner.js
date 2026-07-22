import { spawn } from "node:child_process";
import { mapLarkCliEvent } from "./eventAdapter.js";
import { logger } from "../logger.js";
import { windowsCommand } from "./client.js";

export class LarkEventRunner {
  constructor({ config, client, router, accessStore, eventStore }) {
    this.config = config;
    this.client = client;
    this.router = router;
    this.accessStore = accessStore;
    this.eventStore = eventStore;
    this.child = null;
  }

  start() {
    const args = [
      "--profile", this.config.profile,
      "event", "consume", "im.message.receive_v1",
      "--as", this.config.eventAs,
      "--quiet"
    ];
    const command = windowsCommand(this.config.bin, args);
    this.child = spawn(command.bin, command.args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");

    let buffer = "";
    this.child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) void this.handleLine(line);
    });
    this.child.stderr.on("data", (chunk) => {
      for (const line of chunk.split(/\r?\n/).filter(Boolean)) logger.info("lark.event.status", { message: line });
    });
    this.child.on("error", (error) => logger.error("lark.event.error", { error: error.message }));

    return new Promise((resolve, reject) => {
      this.child.on("close", (code) => code === 0 ? resolve(code) : reject(new Error(`lark-cli 事件监听退出，代码 ${code}`)));
    });
  }

  stop() {
    this.child?.kill("SIGTERM");
  }

  async handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let raw;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      logger.error("lark.event.invalid_json");
      return;
    }

    const event = mapLarkCliEvent(raw);
    if (event.type === "ignored") return;
    if (!await this.eventStore.claim(event.eventId || event.messageId)) return;
    if (event.type !== "text") {
      if (event.messageId) await this.reply(event, event.reason || "暂时只支持文本消息。");
      return;
    }
    if (!this.config.allowGroupChats && event.chatType === "group") {
      await this.reply(event, "为保护本机 Codex，默认只允许私聊机器人。");
      return;
    }

    const pairing = await this.accessStore.tryPair(event, event.text);
    if (pairing.matched) {
      await this.reply(event, pairing.ok ? "✅ 配对成功。发送 tasks 查看可续聊的 Codex Task。" : pairing.reason);
      return;
    }
    if (!await this.accessStore.isAuthorized(event)) {
      const hasOwner = await this.accessStore.hasAuthorizedUser();
      await this.reply(event, hasOwner ? "未授权用户，无法操作此电脑的 Codex。" : "机器人尚未配对。请在电脑上运行 npm run pairing 获取一次性配对码。");
      return;
    }

    try {
      const result = await this.router.handle(event);
      if (result.reply && !result.data?.async) await this.reply(event, result.reply);
    } catch (error) {
      logger.error("bridge.handle.failed", { error: error.message });
      await this.reply(event, `处理失败：${error.message}`);
    }
  }

  reply(event, text) {
    return this.client.replyText(event.messageId, text, event.messageId, { chatId: event.chatId });
  }
}

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../logger.js";

export class LarkClient {
  constructor({ bin, profile, replyAs = "bot", runtimeDir }, runner = runCommand) {
    this.bin = bin;
    this.profile = profile;
    this.replyAs = replyAs;
    this.runtimeDir = runtimeDir;
    this.runner = runner;
  }

  async replyText(messageId, text, idempotencyKey = "", options = {}) {
    if (!messageId && !options.chatId) return null;
    const chunks = splitMessage(String(text || ""));
    const responses = [];
    for (let index = 0; index < chunks.length; index += 1) {
      responses.push(await this.sendChunk({
        messageId,
        chatId: options.chatId || "",
        text: chunks[index],
        idempotencyKey: idempotencyKey ? `${idempotencyKey}:${index}` : ""
      }));
    }
    return responses.at(-1) || null;
  }

  async sendChunk({ messageId, chatId, text, idempotencyKey }) {
    const useChatSend = Boolean(chatId);
    const jsonFile = useChatSend ? await this.writeMessageFile(chatId, text) : "";
    const args = useChatSend
      ? ["api", "POST", "/open-apis/im/v1/messages", "--params", JSON.stringify({ receive_id_type: "chat_id" }), "--data", `@${jsonFile}`, "--as", this.replyAs, "--format", "json"]
      : ["im", "+messages-reply", "--message-id", messageId, "--text", text, "--as", this.replyAs, "--format", "json"];
    if (idempotencyKey && !useChatSend) args.push("--idempotency-key", idempotencyKey);

    try {
      const output = await this.runner(this.bin, this.withProfile(args));
      return parseJsonOutput(output.stdout);
    } finally {
      if (jsonFile) await fs.unlink(path.resolve(process.cwd(), jsonFile)).catch(() => {});
    }
  }

  withProfile(args) {
    return this.profile ? ["--profile", this.profile, ...args] : args;
  }

  async writeMessageFile(chatId, text) {
    await fs.mkdir(this.runtimeDir, { recursive: true });
    const absolutePath = path.join(this.runtimeDir, `message-${process.pid}-${Date.now()}.json`);
    await fs.writeFile(absolutePath, JSON.stringify({
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text })
    }), "utf8");
    return path.relative(process.cwd(), absolutePath);
  }
}

export function runCommand(bin, args, { stdin = "ignore" } = {}) {
  return new Promise((resolve, reject) => {
    const command = windowsCommand(bin, args);
    const child = spawn(command.bin, command.args, { windowsHide: true, stdio: [stdin, "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      logger.error("command.failed", { bin: path.basename(bin), code });
      reject(new Error(`${path.basename(bin)} 执行失败，退出码 ${code}。请运行 npm run doctor 查看详情。`));
    });
  });
}

export function windowsCommand(bin, args) {
  if (process.platform !== "win32") return { bin, args };
  return { bin: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", bin, ...args] };
}

function parseJsonOutput(stdout) {
  const trimmed = stdout.trim();
  return trimmed ? JSON.parse(trimmed) : {};
}

function splitMessage(text, limit = 3800) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    let index = remaining.lastIndexOf("\n", limit);
    if (index < limit / 2) index = limit;
    chunks.push(remaining.slice(0, index));
    remaining = remaining.slice(index).replace(/^\n/, "");
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LarkClient, normalizeIdempotencyKey, parseCommandFailure, windowsCommand } from "../src/lark/client.js";

test("飞书回复优先使用原消息 ID，而不是按会话发送", async () => {
  let invocation;
  const client = new LarkClient({
    bin: "lark-cli.cmd",
    profile: "test-profile",
    replyAs: "bot",
    runtimeDir: "."
  }, async (bin, args) => {
    invocation = { bin, args };
    return { stdout: '{"ok":true}', stderr: "" };
  });

  await client.replyText("om_test", "配对成功", "event:test", { chatId: "oc_test" });

  assert.equal(invocation.bin, "lark-cli.cmd");
  assert.deepEqual(invocation.args.slice(0, 8), [
    "--profile", "test-profile", "im", "+messages-reply", "--as", "bot", "--format", "json"
  ]);
  assert.equal(invocation.args.includes("+messages-send"), false);
  assert.equal(invocation.args.includes("om_test"), true);
});

test("缺少消息 ID 时使用会话发送 shortcut", async () => {
  let args;
  const client = new LarkClient({
    bin: "lark-cli.cmd",
    profile: "test-profile",
    replyAs: "bot",
    runtimeDir: "."
  }, async (_bin, commandArgs) => {
    args = commandArgs;
    return { stdout: '{"ok":true}', stderr: "" };
  });

  await client.replyText("", "测试", "event:test", { chatId: "oc_test" });

  assert.equal(args.includes("+messages-send"), true);
  assert.equal(args.includes("--chat-id"), true);
  assert.equal(args.includes("oc_test"), true);
});

test("超长幂等键稳定压缩到 50 字符并保持分段唯一", async () => {
  const keys = [];
  const client = new LarkClient({
    bin: "lark-cli.cmd",
    profile: "test-profile",
    replyAs: "bot",
    runtimeDir: "."
  }, async (_bin, args) => {
    const index = args.indexOf("--idempotency-key");
    keys.push(args[index + 1]);
    return { stdout: '{"ok":true}', stderr: "" };
  });
  const source = `${"om_"}${"a".repeat(40)}:progress:1785375970680`;

  await client.replyText("om_test", "A".repeat(7601), source);

  assert.equal(keys.length, 3);
  assert.equal(keys.every((key) => key.length === 50), true);
  assert.equal(new Set(keys).size, 3);
  assert.equal(normalizeIdempotencyKey(`${source}:0`), keys[0]);
});

test("解析 lark-cli 结构化错误并保留最小权限提示", () => {
  const failure = parseCommandFailure(JSON.stringify({
    ok: false,
    identity: "user",
    error: {
      type: "authorization",
      subtype: "missing_scope",
      message: "Permission denied",
      hint: "Enable bot scope in developer console",
      missing_scopes: ["im:message:send_as_bot"]
    }
  }));

  assert.equal(failure.type, "authorization");
  assert.equal(failure.subtype, "missing_scope");
  assert.equal(failure.identity, "user");
  assert.deepEqual(failure.missingScopes, ["im:message:send_as_bot"]);
  assert.match(failure.summary, /缺少用户权限/);
  assert.match(failure.summary, /im:message:send_as_bot/);
});

test("Windows 直接调用 lark-cli JavaScript 入口并原样保留复杂文本", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "feishu-lark-cli-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const shim = path.join(directory, "lark-cli.cmd");
  const entry = path.join(directory, "node_modules", "@larksuite", "cli", "scripts", "run.js");
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(shim, "@echo off\r\n", "utf8");
  await fs.writeFile(entry, "// fake lark cli\n", "utf8");
  const text = "任务 A & B\n路径：C:\\项目\\\"测试\"";

  const command = windowsCommand("lark-cli.cmd", ["im", "+messages-reply", "--as", "bot", "--text", text], {
    platform: "win32",
    env: { Path: directory, ComSpec: "cmd.exe" },
    nodeBin: "node.exe"
  });

  assert.equal(command.bin, "node.exe");
  assert.equal(command.args[0], entry);
  assert.equal(command.args.at(-1), text);
  assert.equal(command.args.includes("cmd.exe"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { LarkClient, parseCommandFailure } from "../src/lark/client.js";

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
  assert.deepEqual(invocation.args.slice(0, 5), [
    "--profile", "test-profile", "im", "+messages-reply", "--message-id"
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

test("解析 lark-cli 结构化错误并保留最小权限提示", () => {
  const failure = parseCommandFailure(JSON.stringify({
    ok: false,
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
  assert.deepEqual(failure.missingScopes, ["im:message:send_as_bot"]);
  assert.match(failure.summary, /im:message:send_as_bot/);
});

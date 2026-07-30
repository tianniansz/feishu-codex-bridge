import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { CodexAppServerClient } from "../src/codex/appServerClient.js";

test("Codex 客户端按顺序初始化、恢复 Task 并开始 turn", async () => {
  const harness = fakeAppServerHarness({ replyText: "Codex reply" });
  const client = new CodexAppServerClient({ bin: "codex", cwd: process.cwd() }, harness.spawn);
  const result = await client.sendMessage("thread_1", "hello");

  assert.equal(result.ok, true);
  assert.equal(result.text, "Codex reply");
  assert.deepEqual(harness.methods, ["initialize", "thread/resume", "turn/start"]);
  assert.equal(harness.maxPendingRequests, 1);
});

test("Codex 完成但没有回复时返回可诊断错误", async () => {
  const harness = fakeAppServerHarness({ replyText: "", warning: "Unknown model gpt-test" });
  const client = new CodexAppServerClient({ bin: "codex", cwd: process.cwd() }, harness.spawn);
  const result = await client.sendMessage("thread_1", "hello");

  assert.equal(result.ok, false);
  assert.match(result.error, /does not recognize/);
});

test("Codex 客户端转发服务端审批请求并返回决定", async () => {
  const harness = fakeAppServerHarness({ replyText: "已完成", approval: true });
  const client = new CodexAppServerClient({ bin: "codex", cwd: process.cwd() }, harness.spawn);
  const approvals = [];
  const result = await client.sendMessage("thread_1", "run tests", {
    async onApproval(request) {
      approvals.push(request);
      return { decision: "accept" };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(approvals[0].method, "item/commandExecution/requestApproval");
  assert.deepEqual(harness.serverResponses, [{ id: 900, result: { decision: "accept" } }]);
});

test("Codex 客户端在单个 App Server 中批量读取当前页 Task", async () => {
  const harness = fakeAppServerHarness({ replyText: "" });
  const client = new CodexAppServerClient({ bin: "codex", cwd: process.cwd() }, harness.spawn);
  const threads = await client.readThreads(["thread_1", "thread_2"]);

  assert.deepEqual(threads.map((thread) => thread.id), ["thread_1", "thread_2"]);
  assert.deepEqual(harness.methods, ["initialize", "thread/read", "thread/read"]);
});

function fakeAppServerHarness({ replyText, warning = "", approval = false }) {
  const methods = [];
  const serverResponses = [];
  let pendingRequests = 0;
  let maxPendingRequests = 0;

  return {
    methods,
    serverResponses,
    get maxPendingRequests() { return maxPendingRequests; },
    spawn() {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {};
      child.stdin = {
        write(line) {
          const message = JSON.parse(line);
          if (!message.method) {
            serverResponses.push({ id: message.id, result: message.result });
            if (message.id === 900) {
              queueMicrotask(() => {
                if (replyText) emit({ method: "item/completed", params: { item: { type: "agentMessage", text: replyText } } });
                emit({ method: "turn/completed", params: { turn: { id: "turn_1", status: "completed", items: [] } } });
              });
            }
            return true;
          }
          methods.push(message.method);
          pendingRequests += 1;
          maxPendingRequests = Math.max(maxPendingRequests, pendingRequests);
          queueMicrotask(() => {
            pendingRequests -= 1;
            if (message.method === "initialize") return emit({ id: message.id, result: { userAgent: "test" } });
            if (message.method === "thread/resume") return emit({ id: message.id, result: { thread: { id: "thread_1" } } });
            if (message.method === "turn/start") {
              emit({ id: message.id, result: { turn: { id: "turn_1", status: "inProgress" } } });
              if (approval) {
                emit({ id: 900, method: "item/commandExecution/requestApproval", params: { threadId: "thread_1", turnId: "turn_1", itemId: "item_1", command: "npm test" } });
                return;
              }
              if (replyText) emit({ method: "item/completed", params: { item: { type: "agentMessage", text: replyText } } });
              if (warning) child.stderr.write(warning);
              emit({ method: "turn/completed", params: { turn: { id: "turn_1", status: "completed", items: [] } } });
              return;
            }
            if (message.method === "thread/read") {
              emit({ id: message.id, result: { thread: { id: message.params.threadId, turns: [{ id: "turn_1", status: "completed", items: [] }] } } });
            }
          });
          return true;
        }
      };
      function emit(message) { child.stdout.write(`${JSON.stringify(message)}\n`); }
      return child;
    }
  };
}

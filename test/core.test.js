import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AccessStore } from "../src/core/accessStore.js";
import { DeveloperProjectStore } from "../src/core/projectStore.js";
import { DeveloperRouter } from "../src/core/router.js";
import { EventStore } from "../src/core/eventStore.js";
import { mapLarkCliEvent } from "../src/lark/eventAdapter.js";

test("一次性配对码只能授权匹配的飞书用户", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "feishu-codex-bridge-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new AccessStore(path.join(directory, "access.json"), { pairingTtlMs: 60_000 });
  const { code } = await store.createPairingCode();
  const event = { senderId: "ou_test" };

  assert.equal((await store.tryPair(event, "pair 000000")).ok, false);
  assert.equal(await store.isAuthorized(event), false);
  assert.equal((await store.tryPair(event, `pair ${code}`)).ok, true);
  assert.equal(await store.isAuthorized(event), true);
  assert.equal((await store.tryPair({ senderId: "ou_other" }, `pair ${code}`)).ok, false);
});

test("过期配对码不能授权用户", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "feishu-codex-bridge-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let now = Date.now();
  const store = new AccessStore(path.join(directory, "access.json"), { pairingTtlMs: 1_000, now: () => now });
  const { code } = await store.createPairingCode();
  now += 1_001;
  assert.equal((await store.tryPair({ senderId: "ou_test" }, `pair ${code}`)).ok, false);
});

test("飞书事件适配器提取文本、用户和群聊类型", () => {
  const event = mapLarkCliEvent({
    header: { event_type: "im.message.receive_v1", event_id: "evt_1" },
    event: {
      sender: { sender_id: { open_id: "ou_1" } },
      message: {
        message_id: "om_1",
        chat_id: "oc_1",
        chat_type: "group",
        message_type: "text",
        content: JSON.stringify({ text: "tasks" })
      }
    }
  });

  assert.deepEqual(event, {
    type: "text",
    text: "tasks",
    messageId: "om_1",
    chatId: "oc_1",
    senderId: "ou_1",
    senderType: "",
    chatType: "group",
    eventId: "evt_1"
  });
});

test("重复飞书事件只允许处理一次", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "feishu-codex-bridge-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new EventStore(path.join(directory, "events.json"));
  assert.equal(await store.claim("evt_1"), true);
  assert.equal(await store.claim("evt_1"), false);
});

test("项目存储只保留允许根目录内的 Task", () => {
  const store = new DeveloperProjectStore({ allowedRoots: ["D:\\Projects"] });
  const threads = [
    { id: "allowed", cwd: "D:\\Projects\\demo" },
    { id: "blocked", cwd: "D:\\Private\\secret" }
  ];
  assert.deepEqual(store.filterThreads(threads).map((thread) => thread.id), ["allowed"]);
});

test("Router 只列出允许目录的 Task 并能续聊", async () => {
  const codexClient = fakeCodexClient();
  const sessionStore = memorySessionStore();
  const projectStore = new DeveloperProjectStore({ allowedRoots: ["D:\\Projects"] });
  const router = new DeveloperRouter({ codexClient, sessionStore, projectStore });
  const event = { text: "tasks", chatId: "oc_1", senderId: "ou_1" };

  const list = await router.handle(event);
  assert.match(list.reply, /Allowed Task/);
  assert.doesNotMatch(list.reply, /Blocked Task/);

  const opened = await router.handle({ ...event, text: "open 1" });
  assert.equal(opened.ok, true);
  const reply = await router.handle({ ...event, text: "继续处理" });
  assert.equal(reply.reply, "Codex reply");
  assert.deepEqual(codexClient.sent, [{ threadId: "allowed", text: "继续处理" }]);
});

test("Router 默认禁止从飞书新建 Task", async () => {
  const router = new DeveloperRouter({
    codexClient: fakeCodexClient(),
    sessionStore: memorySessionStore(),
    projectStore: new DeveloperProjectStore({ allowedRoots: ["D:\\Projects"] })
  });
  const result = await router.handle({ text: "new", chatId: "oc_1", senderId: "ou_1" });
  assert.equal(result.ok, false);
  assert.match(result.reply, /默认禁止/);
});

function fakeCodexClient() {
  const sent = [];
  return {
    sent,
    async listThreads() {
      return [
        { id: "allowed", name: "Allowed Task", cwd: "D:\\Projects\\demo", status: { type: "idle" } },
        { id: "blocked", name: "Blocked Task", cwd: "D:\\Private\\secret", status: { type: "idle" } }
      ];
    },
    async readThread(threadId) {
      return { id: threadId, name: "Allowed Task", cwd: "D:\\Projects\\demo", status: { type: "idle" }, turns: [] };
    },
    async sendMessage(threadId, text) {
      sent.push({ threadId, text });
      return { ok: true, text: "Codex reply" };
    }
  };
}

function memorySessionStore() {
  const sessions = new Map();
  return {
    async get(key) { return sessions.get(key) || null; },
    async set(key, value) { sessions.set(key, value); return value; },
    async update(key, value) { sessions.set(key, { ...(sessions.get(key) || {}), ...value }); },
    async clear(key) { const value = sessions.get(key) || null; sessions.delete(key); return value; },
    async getFlow() { return null; },
    async listTaskMetadata() { return {}; },
    async getTaskMetadata() { return null; }
  };
}

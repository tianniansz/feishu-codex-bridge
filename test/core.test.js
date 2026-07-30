import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AccessStore } from "../src/core/accessStore.js";
import { DeveloperProjectStore } from "../src/core/projectStore.js";
import { DeveloperRouter } from "../src/core/router.js";
import { DeveloperJobManager } from "../src/core/jobManager.js";
import { browseTasks, parseTaskQuery } from "../src/core/taskBrowser.js";
import { formatNewTaskReply, formatThreadStatus, getThreadRuntimeState } from "../src/core/taskFormatter.js";
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

test("运行中的 Bridge 可以读取启动后生成的配对码", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "feishu-codex-bridge-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "access.json");
  const runningStore = new AccessStore(filePath);
  const pairingCommandStore = new AccessStore(filePath);

  const { code } = await pairingCommandStore.createPairingCode();
  const result = await runningStore.tryPair({ senderId: "ou_after_ready" }, `pair ${code}`);

  assert.equal(result.ok, true);
  assert.equal(await runningStore.isAuthorized({ senderId: "ou_after_ready" }), true);
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

test("Codex worktree is allowed when its main repository is allowed", () => {
  const repositoryRoot = "C:\\MyProject";
  const worktreeRoot = "C:\\Users\\Administrator\\.codex\\worktrees\\5e10\\MyProject";
  const store = new DeveloperProjectStore({
    allowedRoots: [repositoryRoot],
    gitCommonDirResolver(cwd) {
      return cwd === worktreeRoot ? `${repositoryRoot}\\.git` : "";
    }
  });
  const threads = [
    { id: "main", cwd: repositoryRoot },
    { id: "worktree", cwd: worktreeRoot },
    { id: "blocked", cwd: "C:\\Users\\Administrator\\.codex\\worktrees\\other\\Secret" }
  ];

  assert.deepEqual(store.filterThreads(threads).map((thread) => thread.id), ["main", "worktree"]);
  assert.equal(store.resolveAllowedCwd(worktreeRoot), repositoryRoot);
  assert.equal(store.projectForThread(threads[1]).cwd, repositoryRoot);
  assert.equal(store.inspectThread(threads[1]).reason, "allowed-worktree");
  assert.equal(store.inspectThread(threads[2]).reason, "outside-allowed-roots");
  assert.equal(store.inspectThread({ id: "missing" }).reason, "missing-cwd");
});

test("Codex worktree is resolved through the real Git common directory", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "feishu-codex-worktree-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const repositoryRoot = path.join(directory, "repository");
  const worktreeRoot = path.join(directory, "worktree");
  await fs.mkdir(repositoryRoot);
  execFileSync("git", ["init"], { cwd: repositoryRoot, stdio: "ignore" });
  await fs.writeFile(path.join(repositoryRoot, "README.md"), "worktree test\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repositoryRoot, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.name=Bridge Test", "-c", "user.email=bridge@example.invalid", "commit", "-m", "initial"],
    { cwd: repositoryRoot, stdio: "ignore" }
  );
  execFileSync("git", ["worktree", "add", worktreeRoot], { cwd: repositoryRoot, stdio: "ignore" });

  const store = new DeveloperProjectStore({ allowedRoots: [repositoryRoot] });
  assert.equal(store.isAllowed(worktreeRoot), true);
  assert.equal(store.resolveAllowedCwd(worktreeRoot), repositoryRoot);
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
  assert.match(list.reply, /本机 Codex Task/);
  assert.match(list.reply, /Unknown（Desktop\/CLI）/);
  assert.match(list.reply, /查看 Bridge 状态和最后记录/);

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

test("Task 列表支持关键词、项目过滤和分页", () => {
  const threads = [
    { id: "1", name: "修复登录", cwd: "D:\\Projects\\alpha" },
    { id: "2", name: "更新文档", cwd: "D:\\Projects\\beta" },
    { id: "3", name: "登录回归", cwd: "D:\\Projects\\alpha" }
  ];
  const projectStore = new DeveloperProjectStore({ allowedRoots: ["D:\\Projects"] });
  const parsed = parseTaskQuery("tasks 登录 project:alpha page:2");
  const result = browseTasks(threads, { ...parsed, pageSize: 1, projectStore });

  assert.deepEqual(parsed, { query: "登录", project: "alpha", page: 2 });
  assert.equal(parseTaskQuery("tasks 2").page, 2);
  assert.equal(result.total, 2);
  assert.equal(result.page, 2);
  assert.equal(result.threads[0].id, "3");
});

test("持久化 inProgress 只作为最后记录，不推断外部实时状态", () => {
  const thread = {
    id: "external-running",
    status: { type: "notLoaded" },
    turns: [{
      id: "turn-1",
      status: "inProgress",
      items: [{ type: "commandExecution", status: "inProgress" }]
    }]
  };

  assert.deepEqual(getThreadRuntimeState(thread), {
    kind: "unknown",
    label: "Unknown（Desktop/CLI）",
    source: "not-loaded",
    recorded: { kind: "running", label: "In Progress" }
  });
  const message = formatThreadStatus(thread, { refreshedAt: new Date("2026-07-29T08:00:00Z") });
  assert.match(message, /Task 信息已刷新/);
  assert.match(message, /状态：🟠 Unknown（Desktop\/CLI）/);
  assert.match(message, /最后记录：In Progress/);
  assert.match(message, /最后记录为命令执行中/);
  assert.match(message, /“最后记录”不代表当前状态/);
  assert.doesNotMatch(message, /Running（外部发起）/);
});

test("notLoaded 且没有持久化记录的 Task 显示其他入口状态未知", () => {
  const runtime = getThreadRuntimeState({ status: { type: "notLoaded" }, turns: [] });
  assert.equal(runtime.kind, "unknown");
  assert.equal(runtime.label, "Unknown（Desktop/CLI）");
  assert.equal(runtime.recorded.label, "暂无持久化记录");
});

test("持久化 Interrupted 不冒充当前实时状态", () => {
  const thread = {
    status: { type: "notLoaded" },
    turns: [{ id: "turn-1", status: "interrupted", items: [] }]
  };
  const runtime = getThreadRuntimeState(thread);
  const message = formatThreadStatus(thread);

  assert.equal(runtime.kind, "unknown");
  assert.equal(runtime.recorded.label, "Interrupted");
  assert.match(message, /状态：🟠 Unknown（Desktop\/CLI）/);
  assert.match(message, /最后记录：Interrupted/);
  assert.doesNotMatch(message, /状态：.*Interrupted/);
});

test("独立 App Server 返回 idle 也不冒充 Waiting User", () => {
  const runtime = getThreadRuntimeState({
    status: { type: "idle" },
    turns: [{ status: "interrupted" }]
  });

  assert.equal(runtime.kind, "unknown");
  assert.equal(runtime.label, "Unknown（Desktop/CLI）");
  assert.equal(runtime.recorded.label, "Interrupted");
});

test("Bridge 新建且尚未执行的 Task 显示 Waiting User", () => {
  const message = formatNewTaskReply({ id: "bridge-new", status: { type: "idle" }, turns: [] });
  assert.match(message, /🟢 Waiting User/);
});

test("只有 Bridge 管理的 Job 显示确定 Running", () => {
  const runtime = getThreadRuntimeState({
    status: { type: "notLoaded" },
    turns: [{ status: "inProgress" }]
  }, { bridgeRunning: true });

  assert.equal(runtime.kind, "running");
  assert.equal(runtime.label, "Running（Bridge）");
  assert.equal(runtime.source, "bridge");
});

test("Router 分离外部任务实时状态与最后记录，不伪装并发保护", async () => {
  const sent = [];
  const runningThread = {
    id: "external-running",
    name: "S01",
    cwd: "D:\\Projects\\demo",
    status: { type: "notLoaded" },
    turns: [{
      id: "turn-1",
      status: "inProgress",
      items: [{ type: "commandExecution", status: "inProgress" }]
    }]
  };
  const codexClient = {
    async listThreads() { return [runningThread]; },
    async readThread() { return runningThread; },
    async sendMessage(threadId, text) {
      sent.push({ threadId, text });
      return { ok: true, text: "Codex reply", turn: { id: "turn-2" } };
    }
  };
  const sessionStore = memorySessionStore();
  const router = new DeveloperRouter({
    codexClient,
    sessionStore,
    projectStore: new DeveloperProjectStore({ allowedRoots: ["D:\\Projects"] })
  });
  const event = { chatId: "oc_1", senderId: "ou_1" };

  await router.handle({ ...event, text: "tasks" });
  const opened = await router.handle({ ...event, text: "open 1" });
  assert.match(opened.reply, /Unknown（Desktop\/CLI）/);
  assert.match(opened.reply, /最后记录：In Progress/);
  assert.match(opened.reply, /请先确认本机 Desktop\/CLI 没有执行/);
  assert.doesNotMatch(opened.reply, /普通消息不会追加/);

  const status = await router.handle({ ...event, text: "status" });
  assert.match(status.reply, /Task 信息已刷新/);
  assert.match(status.reply, /最后记录：In Progress/);

  const continued = await router.handle({ ...event, text: "继续处理" });
  assert.equal(continued.ok, true);
  assert.deepEqual(sent, [{ threadId: "external-running", text: "继续处理" }]);
});

test("飞书审批码只允许原会话处理", async () => {
  const sent = [];
  const codexClient = {
    async sendMessage(threadId, text, options) {
      const approval = await options.onApproval({
        method: "item/commandExecution/requestApproval",
        threadId,
        itemId: "item_1",
        command: "npm test",
        reason: "运行相关测试"
      });
      return { ok: true, text: approval.decision };
    }
  };
  const manager = new DeveloperJobManager({
    codexClient,
    feishuClient: { async replyText(messageId, text) { sent.push({ messageId, text }); } },
    runningNoticeDelayMs: 0,
    progressNoticeIntervalMs: 0
  });
  const started = manager.start({
    event: { messageId: "om_1", chatId: "oc_1" },
    sessionKey: "oc_1:ou_1",
    threadId: "thread_1",
    text: "继续",
    cwd: "D:\\Projects\\alpha"
  });
  await new Promise((resolve) => setImmediate(resolve));
  const code = sent[0].text.match(/审批码：([A-F0-9]{6})/)[1];

  assert.equal(manager.resolveApproval({ sessionKey: "oc_2:ou_2", code, decision: "accept" }).ok, false);
  assert.equal(manager.resolveApproval({ sessionKey: "oc_1:ou_1", code, decision: "accept" }).ok, true);
  assert.equal(manager.resolveApproval({ sessionKey: "oc_1:ou_1", code, decision: "accept" }).ok, false);
  await started.job.promise;
  assert.equal(sent.at(-1).text.includes("accept"), true);
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

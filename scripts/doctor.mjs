import fs from "node:fs/promises";
import path from "node:path";
import { loadDotEnv } from "../src/env.js";
import { loadConfig } from "../src/config.js";
import { AccessStore } from "../src/core/accessStore.js";
import { DeveloperProjectStore } from "../src/core/projectStore.js";
import { DeveloperSessionStore } from "../src/core/sessionStore.js";
import { getThreadRuntimeState } from "../src/core/taskFormatter.js";
import { CodexAppServerClient } from "../src/codex/appServerClient.js";
import { runCommand } from "../src/lark/client.js";

loadDotEnv();

const checks = [];
const includeTaskDiagnostics = process.argv.includes("--tasks");
let taskDiagnostics = [];
let config;

await check("Node.js >= 20", async () => {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) throw new Error(`当前版本 ${process.version}`);
  return process.version;
});

await check("配置文件", async () => {
  config = loadConfig();
  return `${config.bridge.allowedWorkspaceRoots.length} 个允许目录`;
});

if (config) {
  await check("Codex CLI", async () => (await runCommand(config.codex.bin, ["--version"])).stdout.trim());
  await check("Codex 登录", async () => {
    await runCommand(config.codex.bin, ["login", "status"]);
    return "已登录";
  });
  await check("Codex App Server", async () => {
    await runCommand(config.codex.bin, ["app-server", "--help"]);
    return "可用";
  });
  await check("lark-cli", async () => (await runCommand(config.lark.bin, ["--version"])).stdout.trim());
  await check("飞书 Profile", async () => {
    const output = await runCommand(config.lark.bin, ["--profile", config.lark.profile, "whoami"]);
    const identity = JSON.parse(output.stdout.trim());
    if (identity.ok === false || identity.available === false) throw new Error("Profile 不可用");
    return config.lark.profile;
  });
  for (const root of config.bridge.allowedWorkspaceRoots) {
    await check(`工作目录 ${path.basename(root)}`, async () => {
      const stat = await fs.stat(root);
      if (!stat.isDirectory()) throw new Error("不是目录");
      return "可访问";
    });
  }
  await check("飞书配对", async () => {
    const store = new AccessStore(path.join(config.runtimeDir, "access.json"));
    return await store.hasAuthorizedUser() ? "已配对" : "待配对（运行 feishu-codex-bridge pairing）";
  }, { warningOnly: true });

  if (includeTaskDiagnostics) {
    await check("Task 过滤诊断", async () => {
      const client = new CodexAppServerClient(config.codex);
      const sessionStore = new DeveloperSessionStore(path.join(config.runtimeDir, "developer-sessions.json"));
      const projectStore = new DeveloperProjectStore({ allowedRoots: config.bridge.allowedWorkspaceRoots });
      const metadata = await sessionStore.listTaskMetadata();
      const activeThreads = await client.listThreads({ limit: config.bridge.taskLimit, archived: false });
      const archivedThreads = await client.listThreads({ limit: config.bridge.taskLimit, archived: true });
      const activeDiagnostics = [];
      for (const thread of activeThreads) {
        const inspection = projectStore.inspectThread(thread, metadata);
        let snapshot = thread;
        if (inspection.allowed) {
          snapshot = await client.readThread(thread.id, { includeTurns: true }) || thread;
        }
        const lastTurn = Array.isArray(snapshot.turns) ? snapshot.turns.at(-1) : null;
        activeDiagnostics.push({
          thread: snapshot,
          ...inspection,
          runtime: getThreadRuntimeState(snapshot),
          threadStatus: snapshot.status || thread.status || null,
          lastTurnStatus: lastTurn?.status || null
        });
      }
      taskDiagnostics = [
        ...activeDiagnostics,
        ...archivedThreads.map((thread) => ({
          thread,
          allowed: false,
          cwd: thread.cwd || thread.workspacePath || "",
          resolvedCwd: "",
          reason: "archived"
        }))
      ];
      const allowedCount = taskDiagnostics.filter((item) => item.allowed).length;
      return `${allowedCount}/${activeThreads.length} 个未归档 Task 可从飞书访问`;
    });
  }
}

console.log("");
for (const item of checks) {
  const icon = item.ok ? (item.warning ? "⚠️" : "✅") : "❌";
  console.log(`${icon} ${item.name}：${item.message}`);
}

if (includeTaskDiagnostics && taskDiagnostics.length) {
  console.log("");
  console.log("Task 过滤诊断（仅在本机显示）：");
  for (const item of taskDiagnostics) {
    console.log(`${item.allowed ? "✅" : "⛔"} ${taskTitle(item.thread)}`);
    console.log(`   ${diagnosticReason(item.reason)}`);
    if (item.runtime) console.log(`   bridgeStatus: ${item.runtime.label}`);
    if (item.threadStatus) console.log(`   threadStatus: ${JSON.stringify(item.threadStatus)}`);
    if (item.lastTurnStatus) console.log(`   lastTurnStatus: ${JSON.stringify(item.lastTurnStatus)}`);
    if (item.cwd) console.log(`   cwd: ${item.cwd}`);
    if (item.resolvedCwd && item.resolvedCwd !== item.cwd) {
      console.log(`   repository: ${item.resolvedCwd}`);
    }
  }
}

const failed = checks.filter((item) => !item.ok);
console.log("");
if (failed.length) {
  console.log(`自检未通过：${failed.length} 项需要处理。详见 docs/TROUBLESHOOTING.md。`);
  process.exitCode = 1;
} else {
  console.log("系统已准备完成。");
}

async function check(name, action, { warningOnly = false } = {}) {
  try {
    const message = await action();
    checks.push({ name, ok: true, warning: warningOnly && String(message).startsWith("待"), message });
  } catch (error) {
    checks.push({ name, ok: warningOnly, warning: warningOnly, message: error.message });
  }
}

function taskTitle(thread = {}) {
  return String(thread.name || thread.title || thread.preview || "未命名 Task")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function diagnosticReason(reason) {
  const reasons = {
    "allowed-root": "允许：工作目录在白名单内",
    "allowed-worktree": "允许：Codex worktree 的原始仓库在白名单内",
    "missing-cwd": "已排除：Codex 未返回工作目录",
    "outside-allowed-roots": "已排除：工作目录和原始仓库均不在白名单内",
    archived: "已排除：Task 已归档"
  };
  return reasons[reason] || `状态：${reason}`;
}

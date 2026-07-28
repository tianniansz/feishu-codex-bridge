import path from "node:path";

export function loadConfig(env = process.env) {
  const runtimeDir = path.resolve(env.RUNTIME_DIR || ".runtime");
  const allowedWorkspaceRoots = splitList(env.ALLOWED_WORKSPACE_ROOTS).map((item) => path.resolve(item));

  if (!env.LARK_CLI_PROFILE?.trim()) {
    throw new Error("缺少 LARK_CLI_PROFILE，请先运行 feishu-codex-bridge setup（源码模式可运行 setup.ps1）");
  }
  if (allowedWorkspaceRoots.length === 0) {
    throw new Error("缺少 ALLOWED_WORKSPACE_ROOTS，请至少配置一个允许 Codex 操作的目录");
  }

  return {
    runtimeDir,
    lark: {
      bin: env.LARK_CLI_BIN || (process.platform === "win32" ? "lark-cli.cmd" : "lark-cli"),
      profile: env.LARK_CLI_PROFILE.trim(),
      eventAs: env.LARK_EVENT_AS || "bot",
      replyAs: env.LARK_CLI_REPLY_AS || "bot",
      allowGroupChats: parseBoolean(env.ALLOW_GROUP_CHATS, false)
    },
    codex: {
      bin: env.CODEX_BIN || "codex",
      cwd: allowedWorkspaceRoots[0],
      timeoutMs: parsePositiveInteger(env.CODEX_APP_SERVER_TIMEOUT_MS, 3_600_000)
    },
    bridge: {
      allowedWorkspaceRoots,
      allowCreateTask: parseBoolean(env.ALLOW_CREATE_TASK, false),
      taskLimit: parsePositiveInteger(env.TASK_LIMIT, 50),
      taskPageSize: parsePositiveInteger(env.TASK_PAGE_SIZE, 8),
      runningNoticeDelayMs: parsePositiveInteger(env.RUNNING_NOTICE_DELAY_MS, 180_000),
      progressNoticeIntervalMs: parsePositiveInteger(env.PROGRESS_NOTICE_INTERVAL_MS, 60_000),
      pairingTtlMs: parsePositiveInteger(env.PAIRING_TTL_MINUTES, 10) * 60_000
    }
  };
}

function splitList(value = "") {
  return String(value)
    .split(/[;,\r\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

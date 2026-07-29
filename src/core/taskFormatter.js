const RUNNING_STATUS = new Set(["active", "running", "processing", "queued", "inprogress"]);

export function formatTasks(threads = [], {
  taskMetadata = {},
  projectStore = null,
  runningThreadIds = new Set(),
  page = 1,
  pageCount = 1,
  total = threads.length,
  query = "",
  project = ""
} = {}) {
  if (!threads.length) {
    return [
      query || project ? "没有找到符合条件的 Task。" : "当前没有可接续的 Task。",
      "",
      "可尝试发送 tasks 清除筛选条件。"
    ].join("\n");
  }

  const filters = [query && `关键词：${query}`, project && `项目：${project}`].filter(Boolean).join("；");
  const lines = ["Codex Desktop Task", `第 ${page}/${pageCount} 页，共 ${total} 个${filters ? `；${filters}` : ""}`, ""];
  threads.forEach((thread, index) => {
    const metadata = taskMetadata[thread.id] || {};
    const project = projectStore?.projectForThread?.(thread, { metadata: taskMetadata }) || {
      name: metadata.projectName || "默认（未分类）"
    };
    const runtime = getThreadRuntimeState(thread, { bridgeRunning: runningThreadIds.has(thread.id) });
    const status = runtime.label;
    lines.push(`${index + 1}. ${metadata.title || titleForThread(thread)}`);
    lines.push(`项目：${project.name || "默认（未分类）"}`);
    lines.push(`${statusIcon(status)} ${status}`);
    lines.push(`更新时间：${formatUpdatedAt(getThreadActivityAt(thread))}`);
    lines.push("");
  });

  lines.push("发送 open <编号> 进入指定 Task。");
  lines.push("进入后发送 status 可主动刷新最新状态和进展。");
  if (page < pageCount) lines.push(`下一页：tasks${query ? ` ${query}` : ""}${project ? ` project:${project}` : ""} page:${page + 1}`);
  return lines.join("\n").trim();
}

export function formatJobStatus(job = null) {
  if (!job) return "当前 Task 没有正在执行的任务。";
  const lines = [
    "Codex 正在执行",
    "",
    `运行时长：${formatElapsed(Date.now() - job.startedAt)}`,
    `当前阶段：${job.progress?.label || "正在思考和处理"}`
  ];
  if (job.progress?.detail) lines.push(`详情：${clip(job.progress.detail, 500)}`);
  if (job.pendingApprovalCode) lines.push("", `等待审批：${job.pendingApprovalCode}`, `批准：approve ${job.pendingApprovalCode}`, `拒绝：reject ${job.pendingApprovalCode}`);
  return lines.join("\n");
}

export function formatOpenReply(thread = {}, { index = null, project = null, prefix = "", bridgeRunning = false } = {}) {
  const title = titleForThread(thread);
  const runtime = getThreadRuntimeState(thread, { bridgeRunning });
  const status = runtime.label;
  const header = index ? `已进入 Task #${index}` : "已进入当前 Task";
  const parts = [];

  if (prefix) {
    parts.push(prefix.trim(), "────────────────");
  }

  parts.push(
    header,
    "",
    "标题：",
    title,
    "",
    "项目：",
    project?.name || "默认（未分类）",
    "",
    "状态：",
    `${statusIcon(status)} ${status}`,
    "",
    "最近进展：",
    formatLatestProgress(thread),
    "",
    "最后一次对话：",
    formatLastConversation(thread),
    "",
    runtime.kind === "running"
      ? "当前执行结束前，普通消息不会追加到该 Task。"
      : "你现在发送的所有消息都将进入该 Task。",
    ...runtimeGuidance(runtime),
    "",
    "输入 exit 可退出当前 Task。"
  );

  return parts.join("\n").trim();
}

export function formatNewTaskReply(thread = {}, { project = null } = {}) {
  const runtime = getThreadRuntimeState(thread);
  return [
    "已创建并进入新 Task",
    "",
    "项目：",
    project?.name || "默认（未分类）",
    "",
    "标题：",
    titleForThread(thread),
    "",
    "状态：",
    `${statusIcon(runtime.label)} ${runtime.label}`,
    "",
    "最近进展：",
    formatLatestProgress(thread),
    "",
    "最后一次对话：",
    formatLastConversation(thread),
    "",
    "你现在发送的所有消息都将进入该 Task。",
    "",
    "输入 exit 可退出当前 Task。"
  ].join("\n").trim();
}

export function formatUndeliveredResult(thread = {}, delivery = null) {
  if (!delivery || !["running", "timeout", "failed"].includes(delivery.status)) return "";

  const turn = findDeliveryTurn(thread, delivery);
  const agentText = latestAgentText(turn);

  if (turn && isCompletedTurn(turn) && agentText) {
    return [
      "✅ Codex 已完成",
      "",
      clip(agentText, 4000)
    ].join("\n");
  }

  if (delivery.status === "failed") {
    return [
      "⚠️ Codex 本轮处理失败。",
      "",
      delivery.error ? `原因：${delivery.error}` : "原因：未知错误",
      "",
      "可以发送 open 刷新当前 Task 状态。",
      "",
      "如需退出当前 Task，可发送 exit。"
    ].join("\n");
  }

  return formatLastTaskStillRunning();
}

export function hasCompletedUndeliveredResult(thread = {}, delivery = null) {
  if (!delivery || !["running", "timeout", "failed"].includes(delivery.status)) return false;
  const turn = findDeliveryTurn(thread, delivery);
  return Boolean(turn && isCompletedTurn(turn) && latestAgentText(turn));
}

export function hasPendingUndeliveredResult(thread = {}, delivery = null) {
  if (!delivery || !["running", "timeout"].includes(delivery.status)) return false;
  return !hasCompletedUndeliveredResult(thread, delivery);
}

export function formatLastTaskStillRunning() {
  return [
    "最后的任务还在执行中，请耐心等待。",
    "",
    "你可以稍后发送：",
    "open",
    "",
    "刷新当前 Task 状态。",
    "",
    "如需退出当前 Task，可发送：",
    "exit"
  ].join("\n");
}

export function isRunningStatus(status) {
  return RUNNING_STATUS.has(normalizeStatus(status));
}

export function getThreadRuntimeState(thread = {}, { bridgeRunning = false } = {}) {
  if (bridgeRunning) return runtimeState("running", "Running", "bridge");

  const threadStatus = normalizeStatus(thread.status);
  const lastTurn = Array.isArray(thread.turns) ? thread.turns.at(-1) : null;
  const turnStatus = normalizeStatus(lastTurn?.status);

  if (RUNNING_STATUS.has(threadStatus)) return runtimeState("running", "Running（外部发起）", "thread");
  if (RUNNING_STATUS.has(turnStatus)) return runtimeState("running", "Running（外部发起）", "persisted-turn");
  if (threadStatus === "systemerror" || ["failed", "error"].includes(turnStatus)) {
    return runtimeState("failed", "Failed", "thread");
  }
  if (["completed", "complete", "done"].includes(turnStatus)) {
    return runtimeState("completed", "Completed", "persisted-turn");
  }
  if (["interrupted", "cancelled", "canceled"].includes(turnStatus)) {
    return runtimeState("completed", "Interrupted", "persisted-turn");
  }
  if (threadStatus === "idle") return runtimeState("waiting", "Waiting User", "thread");
  return runtimeState("unknown", "Unknown", threadStatus === "notloaded" ? "not-loaded" : "unknown");
}

export function formatThreadStatus(thread = {}, { refreshedAt = new Date() } = {}) {
  const runtime = getThreadRuntimeState(thread);
  const lines = [
    "Task 状态已刷新",
    "",
    `刷新时间：${formatRefreshTime(refreshedAt)}`,
    `状态：${statusIcon(runtime.label)} ${runtime.label}`,
    "",
    `最近进展：${formatLatestProgress(thread)}`
  ];
  lines.push(...runtimeGuidance(runtime));
  return lines.join("\n").trim();
}

export function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours} 小时 ${restMinutes} 分` : `${hours} 小时`;
}

function titleForThread(thread = {}) {
  return compact(thread.name || thread.title || thread.preview || thread.id || "未命名 Task");
}

function statusIcon(status) {
  if (status.startsWith("Running")) return "🔵";
  if (status === "Completed") return "✅";
  if (status === "Failed") return "⚠️";
  if (status === "Unknown") return "⚪";
  return "🟢";
}

function runtimeState(kind, label, source) {
  return { kind, label, source };
}

function runtimeGuidance(runtime) {
  if (runtime.kind === "running" && runtime.source !== "bridge") {
    return [
      "",
      "该任务由其他 Codex 入口发起，飞书不会自动推送执行进展。",
      "发送 status 刷新最新状态；发送 open 刷新完整进展。"
    ];
  }
  if (runtime.kind === "unknown") {
    return [
      "",
      "当前 App Server 无法确认该任务的实时状态。",
      "稍后发送 status 或 open 主动刷新。"
    ];
  }
  if (runtime.kind === "completed") {
    return ["", "任务已结束，现在可以直接发送消息继续该 Task。"];
  }
  return [];
}

function normalizeStatus(status) {
  const value = typeof status === "string" ? status : status?.type || status?.state || status?.status;
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function formatRefreshTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatLatestProgress(thread = {}) {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const lastTurn = turns.at(-1);
  const recentAgentProgress = formatRecentProgress(lastTurn ? { turns: [lastTurn] } : thread);
  if (recentAgentProgress !== "暂无进展。") return recentAgentProgress;

  const items = Array.isArray(lastTurn?.items) ? lastTurn.items : [];
  const item = [...items].reverse().find((candidate) => activityLabel(candidate));
  return item ? activityLabel(item) : "暂未发现新的持久化进展。";
}

function activityLabel(item = {}) {
  const type = String(item.type || "").toLowerCase();
  const running = isRunningStatus(item.status);
  if (type === "commandexecution") return running ? "正在执行命令" : "最近完成命令执行";
  if (type === "mcptoolcall") return running ? "正在调用工具" : "最近完成工具调用";
  if (type === "filechange") return running ? "正在修改文件" : "最近完成文件修改";
  if (type === "websearch") return running ? "正在进行网络搜索" : "最近完成网络搜索";
  return "";
}

function formatRecentProgress(thread = {}) {
  const messages = flattenMessages(thread)
    .filter((message) => message.role === "agent" && message.text)
    .slice(-3)
    .map((message) => `• ${clip(compact(message.text), 80)}`);

  return messages.length ? messages.join("\n") : "暂无进展。";
}

function formatLastConversation(thread = {}) {
  const message = flattenMessages(thread).filter((item) => item.text).at(-1);
  if (!message) return "暂无对话。";
  return `${message.role === "agent" ? "Codex" : "你"}：\n${clip(message.text, 1200)}`;
}

function flattenMessages(thread = {}) {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const messages = [];
  for (const turn of turns) {
    const items = Array.isArray(turn.items) ? turn.items : [];
    for (const item of items) {
      const text = textFromItem(item);
      if (!text) continue;
      messages.push({
        role: isAgentItem(item) ? "agent" : "user",
        text,
        at: item.createdAt || turn.createdAt || turn.updatedAt || ""
      });
    }
  }
  return messages;
}

function textFromItem(item = {}) {
  if (typeof item.text === "string") return item.text.trim();
  if (typeof item.content === "string") return item.content.trim();
  if (Array.isArray(item.content)) {
    return item.content.map((part) => part?.text || part?.content || "").filter(Boolean).join("\n").trim();
  }
  return "";
}

function isAgentItem(item = {}) {
  const type = String(item.type || item.role || "").toLowerCase();
  return type.includes("agent") || type.includes("assistant");
}

function latestAgentText(turn = null) {
  if (!turn) return "";
  const items = Array.isArray(turn.items) ? turn.items : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (isAgentItem(item)) {
      const text = textFromItem(item);
      if (text) return text;
    }
  }
  return "";
}

function isCompletedTurn(turn = {}) {
  const status = typeof turn.status === "string" ? turn.status : turn.status?.type || turn.status?.state;
  return String(status || "").toLowerCase() === "completed";
}

function findDeliveryTurn(thread = {}, delivery = {}) {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  if (delivery.turnId) {
    const byId = turns.find((turn) => turn.id === delivery.turnId);
    if (byId) return byId;
  }

  if (delivery.userText) {
    const normalizedUserText = compact(delivery.userText);
    const byUserText = [...turns].reverse().find((turn) => {
      const text = flattenMessages({ turns: [turn] })
        .filter((message) => message.role === "user")
        .map((message) => compact(message.text))
        .join("\n");
      return text.includes(normalizedUserText) || normalizedUserText.includes(text);
    });
    if (byUserText) return byUserText;
  }

  if (delivery.submittedAt) {
    const submitted = Date.parse(delivery.submittedAt);
    if (Number.isFinite(submitted)) {
      const byTime = [...turns].reverse().find((turn) => {
        const created = Date.parse(turn.createdAt || turn.updatedAt || "");
        return Number.isFinite(created) && created >= submitted - 5000;
      });
      if (byTime) return byTime;
    }
  }

  return turns.at(-1) || null;
}

function getThreadActivityAt(thread = {}) {
  const direct = thread.updatedAt || thread.updated_at || thread.lastActivityAt || thread.lastMessageAt;
  if (direct) return direct;
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const lastTurn = turns.at(-1);
  return lastTurn?.updatedAt || lastTurn?.completedAt || lastTurn?.createdAt || thread.createdAt || "";
}

function formatUpdatedAt(value) {
  const date = normalizeTimestamp(value);
  if (!date) return "未知";
  return date.toLocaleString("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function normalizeTimestamp(value) {
  if (!value) return null;
  if (typeof value === "number") {
    const ms = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function compact(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clip(value = "", max = 300) {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

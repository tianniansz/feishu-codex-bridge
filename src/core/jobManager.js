import { randomBytes } from "node:crypto";
import { logger } from "../logger.js";
import { formatElapsed } from "./taskFormatter.js";

export class DeveloperJobManager {
  constructor({ codexClient, feishuClient, sessionStore = null, runningNoticeDelayMs = 180000, progressNoticeIntervalMs = 60000, now = () => Date.now() }) {
    this.codexClient = codexClient;
    this.feishuClient = feishuClient;
    this.sessionStore = sessionStore;
    this.runningNoticeDelayMs = runningNoticeDelayMs;
    this.progressNoticeIntervalMs = progressNoticeIntervalMs;
    this.now = now;
    this.jobs = new Map();
    this.pendingApprovals = new Map();
  }

  isRunning(threadId) {
    return this.jobs.has(threadId);
  }

  runningThreadIds() {
    return new Set(this.jobs.keys());
  }

  getJob(threadId) {
    return this.jobs.get(threadId) || null;
  }

  start({ event, sessionKey, threadId, text, cwd = null }) {
    if (this.jobs.has(threadId)) {
      return { started: false, job: this.jobs.get(threadId) };
    }

    const startedAt = this.now();
    const submittedAt = new Date(startedAt).toISOString();
    const job = {
      sessionKey,
      threadId,
      messageId: event.messageId || "",
      chatId: event.chatId || "",
      text,
      submittedAt,
      startedAt,
      status: "running",
      progress: { label: "正在思考和处理", detail: "", updatedAt: startedAt },
      lastProgressNoticeAt: startedAt
    };
    this.jobs.set(threadId, job);
    void this.updateDelivery(job, { status: "running" }).catch((error) => this.logBackgroundFailure("delivery", error));

    const runningTimer = this.runningNoticeDelayMs > 0
      ? setTimeout(() => {
          void this.sendRunningNotice(job);
        }, this.runningNoticeDelayMs)
      : null;

    job.promise = this.codexClient.sendMessage(threadId, text, {
      cwd,
      onProgress: (message) => this.updateProgress(job, message),
      onApproval: (request) => this.requestApproval(job, request)
    })
      .then((result) => this.finishJob(job, result))
      .catch((error) => this.failJob(job, error))
      .catch((error) => this.logBackgroundFailure("job", error))
      .finally(() => {
        if (runningTimer) clearTimeout(runningTimer);
        this.clearApprovals(job);
        this.jobs.delete(threadId);
      });

    return { started: true, job };
  }

  updateProgress(job, message) {
    const progress = progressFromMessage(message);
    if (!progress) return;
    job.progress = { ...progress, updatedAt: this.now() };
    if (this.progressNoticeIntervalMs <= 0) return;
    if (this.now() - job.lastProgressNoticeAt < this.progressNoticeIntervalMs) return;
    job.lastProgressNoticeAt = this.now();
    void this.sendReply(
      job,
      job.messageId,
      [`Codex 执行进度：${progress.label}`, progress.detail ? `\n${clip(progress.detail, 500)}` : "", "\n发送 status 可随时查看状态。"].join("").trim(),
      `${job.messageId}:progress:${job.lastProgressNoticeAt}`,
      { chatId: job.chatId },
      "progress"
    );
  }

  async requestApproval(job, request) {
    const code = this.createApprovalCode();
    const approval = { code, job, request, resolve: null };
    const decisionPromise = new Promise((resolve) => { approval.resolve = resolve; });
    this.pendingApprovals.set(code, approval);
    job.pendingApprovalCode = code;
    job.progress = { label: "等待你的批准", detail: approvalSummary(request), updatedAt: this.now() };

    const sent = await this.sendReply(
      job,
      job.messageId,
      formatApprovalRequest(code, request),
      `${job.messageId}:approval:${code}`,
      { chatId: job.chatId },
      "approval"
    );
    if (!sent) {
      this.pendingApprovals.delete(code);
      job.pendingApprovalCode = null;
      return { decision: "decline" };
    }

    const decision = await decisionPromise;
    this.pendingApprovals.delete(code);
    job.pendingApprovalCode = null;
    job.progress = { label: decision === "accept" ? "已批准，继续执行" : "已拒绝，等待 Codex 处理", detail: "", updatedAt: this.now() };
    return { decision };
  }

  resolveApproval({ sessionKey, code, decision }) {
    const normalizedCode = String(code || "").toUpperCase();
    const approval = this.pendingApprovals.get(normalizedCode);
    if (!approval || approval.job.sessionKey !== sessionKey) {
      return { ok: false, reply: "未找到属于当前会话的待审批请求，可能已过期或已处理。" };
    }
    const safeDecision = decision === "accept" ? "accept" : "decline";
    this.pendingApprovals.delete(normalizedCode);
    approval.job.pendingApprovalCode = null;
    approval.resolve(safeDecision);
    return {
      ok: true,
      reply: safeDecision === "accept" ? `已批准 ${normalizedCode}，Codex 将继续执行。` : `已拒绝 ${normalizedCode}，Codex 将继续处理或结束本轮。`
    };
  }

  createApprovalCode() {
    let code;
    do code = randomBytes(3).toString("hex").toUpperCase();
    while (this.pendingApprovals.has(code));
    return code;
  }

  clearApprovals(job) {
    for (const [code, approval] of this.pendingApprovals) {
      if (approval.job !== job) continue;
      approval.resolve("decline");
      this.pendingApprovals.delete(code);
    }
    job.pendingApprovalCode = null;
  }

  async sendRunningNotice(job) {
    if (!job.chatId) return;
    const elapsed = formatElapsed(this.now() - job.startedAt);
    await this.sendReply(
      job,
      job.messageId,
      [
        "Codex 仍在执行中，时间较长。",
        "",
        `运行时长：${elapsed}`,
        "",
        "你可以稍后发送：",
        "status",
        "",
        "刷新当前 Task 状态。",
        "",
        "如需退出当前 Task，可发送：",
        "exit"
      ].join("\n"),
      `${job.messageId}:running`,
      { chatId: job.chatId },
      "running"
    );
  }

  async finishJob(job, result) {
    await this.updateDelivery(job, {
      status: result.ok ? "completed" : "failed",
      turnId: result.turn?.id || null,
      error: result.error || null,
      completedAt: new Date(this.now()).toISOString()
    });

    if (!job.chatId) return;
    const elapsed = formatElapsed(this.now() - job.startedAt);
    const reply = result.ok
      ? ["✅ Codex 已完成", "", result.text, "", `运行时长：${elapsed}`].join("\n").trim()
      : [
          "⚠️ Codex 本轮执行未生成可展示结果。",
          "",
          result.error ? `原因：${result.error}` : "",
          `运行时长：${elapsed}`,
          "",
          "可以发送 open 刷新当前 Task 状态。",
          "如需退出当前 Task，可发送 exit。"
        ].filter(Boolean).join("\n");

    await this.sendReply(job, job.messageId, reply, `${job.messageId}:completed`, { chatId: job.chatId }, "completed");
  }

  async failJob(job, error) {
    const elapsed = formatElapsed(this.now() - job.startedAt);
    const isTimeout = String(error?.message || "").includes("timed out");
    await this.updateDelivery(job, {
      status: isTimeout ? "timeout" : "failed",
      error: error?.message || "未知错误",
      completedAt: isTimeout ? null : new Date(this.now()).toISOString()
    });

    if (!job.chatId) return;
    const reply = isTimeout
      ? [
          "⚠️ Codex 执行等待已超时，后台监听已结束。",
          "",
          `运行时长：${elapsed}`,
          "",
          "当前 Task 不会自动推送最终结果。",
          "",
          "你可以稍后发送：",
          "open",
          "",
          "刷新当前 Task 状态。",
          "",
          "如需退出当前 Task，可发送：",
          "exit"
        ].join("\n")
      : [
          "⚠️ Codex 本轮处理失败。",
          "",
          `原因：${error?.message || "未知错误"}`,
          `运行时长：${elapsed}`,
          "",
          "可以发送 open 刷新当前 Task 状态。",
          "如需退出当前 Task，可发送 exit。"
        ].join("\n");

    await this.sendReply(job, job.messageId, reply, `${job.messageId}:error`, { chatId: job.chatId }, "error");
  }

  async sendReply(job, messageId, text, idempotencyKey, options, kind) {
    try {
      await this.feishuClient.replyText(messageId, text, idempotencyKey, options);
      return true;
    } catch (error) {
      this.logBackgroundFailure(`reply:${kind}`, error, job);
      return false;
    }
  }

  logBackgroundFailure(operation, error, job = null) {
    logger.error("job.background_failed", {
      operation,
      threadId: job?.threadId || "",
      error: String(error?.message || error || "未知错误").slice(0, 800)
    });
  }

  async updateDelivery(job, patch) {
    if (!this.sessionStore || !job.sessionKey) return;
    await this.sessionStore.update?.(job.sessionKey, {
      lastDelivery: {
        threadId: job.threadId,
        userText: job.text,
        submittedAt: job.submittedAt,
        ...patch
      }
    });
  }
}

function progressFromMessage(message = {}) {
  if (message.method !== "item/started" && message.method !== "item/completed") return null;
  const item = message.params?.item || {};
  const completed = message.method === "item/completed";
  const type = item.type || "";
  if (type === "commandExecution") return { label: completed ? "命令执行完成" : "正在执行命令", detail: redactSensitive(commandText(item)) };
  if (type === "fileChange") return { label: completed ? "文件修改完成" : "正在修改文件", detail: summarizeChanges(item.changes) };
  if (type === "mcpToolCall") return { label: completed ? "工具调用完成" : "正在调用工具", detail: item.tool || item.name || "" };
  if (type === "webSearch") return { label: completed ? "网络搜索完成" : "正在搜索网络", detail: item.query || "" };
  if (type === "agentMessage") return { label: completed ? "正在整理最终回复" : "正在生成回复", detail: "" };
  return null;
}

function formatApprovalRequest(code, request = {}) {
  const network = request.networkApprovalContext;
  const isFile = request.method === "item/fileChange/requestApproval";
  const lines = ["⚠️ Codex 请求你的批准", "", `审批码：${code}`, `类型：${network ? "网络访问" : isFile ? "文件修改" : "命令执行"}`];
  if (network) lines.push(`目标：${network.protocol || "network"}://${network.host || "未知"}${network.port ? `:${network.port}` : ""}`);
  else if (isFile) lines.push(`范围：${request.grantRoot || "当前 Task 工作区"}`);
  else lines.push(`内容：${clip(redactSensitive(commandText(request)), 800) || "Codex 未提供命令预览"}`);
  if (request.reason) lines.push(`原因：${clip(request.reason, 500)}`);
  lines.push("", `批准一次：approve ${code}`, `拒绝：reject ${code}`, "", "审批码仅对当前飞书会话和本次请求有效。");
  return lines.join("\n");
}

function approvalSummary(request = {}) {
  if (request.networkApprovalContext) return `${request.networkApprovalContext.protocol || "network"}://${request.networkApprovalContext.host || "未知"}`;
  if (request.method === "item/fileChange/requestApproval") return request.grantRoot || request.reason || "文件修改";
  return redactSensitive(commandText(request)) || request.reason || "命令执行";
}

function commandText(value = {}) {
  if (typeof value.command === "string") return value.command;
  if (Array.isArray(value.command)) return value.command.join(" ");
  if (Array.isArray(value.commandActions)) return value.commandActions.map((action) => action.command || action.cmd || JSON.stringify(action)).join("\n");
  return "";
}

function summarizeChanges(changes = []) {
  if (!Array.isArray(changes)) return "";
  return changes.slice(0, 5).map((change) => change.path || change.filePath || change.type || "文件变更").join("、");
}

function clip(value = "", max = 500) {
  const text = String(value || "").trim();
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function redactSensitive(value = "") {
  return String(value || "")
    .replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s]+)/gi, "$1[REDACTED]")
    .replace(/((?:--api[_-]?key|--token|--secret|--password)\s+)("[^"]*"|'[^']*'|[^\s]+)/gi, "$1[REDACTED]");
}

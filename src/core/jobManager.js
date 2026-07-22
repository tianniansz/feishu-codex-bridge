import { formatElapsed } from "./taskFormatter.js";

export class DeveloperJobManager {
  constructor({ codexClient, feishuClient, sessionStore = null, runningNoticeDelayMs = 180000, now = () => Date.now() }) {
    this.codexClient = codexClient;
    this.feishuClient = feishuClient;
    this.sessionStore = sessionStore;
    this.runningNoticeDelayMs = runningNoticeDelayMs;
    this.now = now;
    this.jobs = new Map();
  }

  isRunning(threadId) {
    return this.jobs.has(threadId);
  }

  runningThreadIds() {
    return new Set(this.jobs.keys());
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
      status: "running"
    };
    this.jobs.set(threadId, job);
    void this.updateDelivery(job, { status: "running" });

    const runningTimer = this.runningNoticeDelayMs > 0
      ? setTimeout(() => {
          void this.sendRunningNotice(job);
        }, this.runningNoticeDelayMs)
      : null;

    job.promise = this.codexClient.sendMessage(threadId, text, { cwd })
      .then((result) => this.finishJob(job, result))
      .catch((error) => this.failJob(job, error))
      .finally(() => {
        if (runningTimer) clearTimeout(runningTimer);
        this.jobs.delete(threadId);
      });

    return { started: true, job };
  }

  async sendRunningNotice(job) {
    if (!job.chatId) return;
    const elapsed = formatElapsed(this.now() - job.startedAt);
    await this.feishuClient.replyText(
      job.messageId,
      [
        "Codex 仍在执行中，时间较长。",
        "",
        `运行时长：${elapsed}`,
        "",
        "你可以稍后发送：",
        "open",
        "",
        "刷新当前 Task 状态。",
        "",
        "如需退出当前 Task，可发送：",
        "exit"
      ].join("\n"),
      `${job.messageId}:running`,
      { chatId: job.chatId }
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

    await this.feishuClient.replyText(job.messageId, reply, `${job.messageId}:completed`, { chatId: job.chatId });
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

    await this.feishuClient.replyText(job.messageId, reply, `${job.messageId}:error`, { chatId: job.chatId });
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

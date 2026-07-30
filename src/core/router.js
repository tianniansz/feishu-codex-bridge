import { developerSessionKey } from "./sessionStore.js";
import { DeveloperProjectStore } from "./projectStore.js";
import { browseTasks, parseTaskQuery } from "./taskBrowser.js";
import { TaskActivityProbe } from "./taskActivityProbe.js";
import {
  formatLastTaskStillRunning,
  formatNewTaskReply,
  formatOpenReply,
  formatTasks,
  formatJobStatus,
  formatThreadStatus,
  formatUndeliveredResult,
  getThreadRuntimeState,
  hasCompletedUndeliveredResult,
  hasPendingUndeliveredResult
} from "./taskFormatter.js";

export class DeveloperRouter {
  constructor({ codexClient, sessionStore, projectStore = new DeveloperProjectStore(), jobManager = null, activityProbe = new TaskActivityProbe(), maxTasks = 50, taskPageSize = 8, taskProbeConcurrency = 4, allowCreateTask = false }) {
    this.codexClient = codexClient;
    this.sessionStore = sessionStore;
    this.projectStore = projectStore;
    this.jobManager = jobManager;
    this.activityProbe = activityProbe;
    this.maxTasks = maxTasks;
    this.taskPageSize = taskPageSize;
    this.taskProbeConcurrency = Math.max(1, Math.floor(taskProbeConcurrency || 1));
    this.allowCreateTask = allowCreateTask;
  }

  async handle(event) {
    const text = (event.text || "").trim();
    const command = text.toLowerCase();
    const key = developerSessionKey(event);

    const approvalMatch = text.match(/^(approve|批准|reject|拒绝)\s+([a-f0-9]{6})$/i);
    if (approvalMatch && this.jobManager) {
      const decision = /^(approve|批准)$/i.test(approvalMatch[1]) ? "accept" : "decline";
      return this.jobManager.resolveApproval({ sessionKey: key, code: approvalMatch[2], decision });
    }

    const flow = await this.sessionStore.getFlow?.(key);
    if (flow) return this.handleFlow(key, text, flow);

    if (/^tasks(?:\s|$)/i.test(text)) return this.handleTasks(key, text);
    if (command === "new") return this.handleNew(key);
    if (command === "exit") return this.handleExit(key);
    if (command === "open") return this.handleRefreshCurrentTask(key);
    if (command === "status" || command === "状态") return this.handleStatus(key);

    const openMatch = text.match(/^open\s+(\d+)$/i);
    if (openMatch) {
      return this.handleOpen(key, Number(openMatch[1]));
    }

    return this.handleChat(key, text, event);
  }

  async handleTasks(key, text = "tasks") {
    const allThreads = await this.codexClient.listThreads({ limit: this.maxTasks });
    const taskMetadata = await this.sessionStore.listTaskMetadata?.() || {};
    const allowedThreads = this.projectStore.filterThreads(allThreads, taskMetadata);
    const query = parseTaskQuery(text);
    const browser = browseTasks(allowedThreads, {
      ...query,
      pageSize: this.taskPageSize,
      taskMetadata,
      projectStore: this.projectStore
    });
    const runningThreadIds = this.jobManager?.runningThreadIds?.() || new Set();
    const taskActivities = await this.inspectTaskPage(browser.threads, runningThreadIds);
    await this.sessionStore.update?.(key, {
      taskBrowser: {
        threadIds: browser.threads.map((thread) => thread.id),
        query: browser.query,
        project: browser.project,
        page: browser.page,
        pageCount: browser.pageCount,
        total: browser.total
      }
    });
    return {
      ok: true,
      reply: formatTasks(browser.threads, {
        taskMetadata,
        projectStore: this.projectStore,
        runningThreadIds,
        taskActivities,
        ...browser
      }),
      data: { threads: browser.threads, browser }
    };
  }

  async inspectTaskPage(threads, runningThreadIds) {
    const activities = new Map();
    const candidates = threads.filter((thread) => !runningThreadIds.has(thread.id));
    let fullThreads = null;
    if (typeof this.codexClient.readThreads === "function") {
      try {
        fullThreads = await this.codexClient.readThreads(candidates.map((thread) => thread.id), { includeTurns: true });
      } catch {
        fullThreads = candidates.map(() => null);
      }
    }
    await mapWithConcurrency(candidates, this.taskProbeConcurrency, async (thread, index) => {
      try {
        const fullThread = fullThreads
          ? fullThreads[index]
          : await this.codexClient.readThread(thread.id, { includeTurns: true });
        activities.set(thread.id, await this.activityProbe.inspect(fullThread || thread));
      } catch {
        activities.set(thread.id, { kind: "unknown", evidence: "probe-failed" });
      }
    });
    return activities;
  }

  async handleNew(key) {
    if (!this.allowCreateTask) {
      return { ok: false, reply: "出于安全考虑，默认禁止从飞书新建 Task。可在本机配置 ALLOW_CREATE_TASK=true 后启用。" };
    }
    const allThreads = await this.codexClient.listThreads({ limit: this.maxTasks });
    const taskMetadata = await this.sessionStore.listTaskMetadata?.() || {};
    const projects = this.projectStore.listProjects({ threads: allThreads, metadata: taskMetadata });
    await this.sessionStore.setFlow?.(key, { type: "new:project", projects });
    return {
      ok: true,
      reply: this.projectStore.formatProjectList({ projects })
    };
  }

  async handleFlow(key, text, flow) {
    if (isCancelNewFlow(text)) {
      await this.sessionStore.clearFlow?.(key);
      return { ok: true, reply: "已退出新建 Task 流程。" };
    }

    if (flow.type === "new:project") {
      const projectId = Number(text);
      const projects = Array.isArray(flow.projects) ? flow.projects : [];
      const project = this.projectStore.getProject(projectId, { projects });
      if (!Number.isInteger(projectId) || !project || project.id !== projectId) {
        return { ok: false, reply: `未找到项目 ${text}。\n\n${this.projectStore.formatProjectList({ projects })}` };
      }
      await this.sessionStore.setFlow?.(key, { type: "new:title", project });
      return {
        ok: true,
        reply: ["已选择项目：", project.name, "", "请输入 Task 标题。"].join("\n")
      };
    }

    if (flow.type === "new:title") {
      const title = text.trim();
      if (!title) return { ok: false, reply: "Task 标题不能为空，请重新输入。" };
      const project = flow.project;
      if (!project) return { ok: false, reply: "未选择允许的项目，请重新输入 new。" };
      const thread = await this.codexClient.startThread({ name: title, cwd: project.cwd || undefined });
      if (!thread?.id) return { ok: false, reply: "创建 Codex Task 失败，请稍后重试。" };

      await this.sessionStore.setTaskMetadata?.(thread.id, {
        projectId: project.id,
        projectName: project.name,
        projectCwd: project.cwd || "",
        title
      });
      await this.sessionStore.set(key, {
        threadId: thread.id,
        title,
        projectId: project.id,
        projectName: project.name,
        projectCwd: project.cwd || "",
        cwd: thread.cwd || project.cwd || "",
        index: null
      });
      await this.sessionStore.clearFlow?.(key);

      const fullThread = await this.codexClient.readThread(thread.id, { includeTurns: true });
      return {
        ok: true,
        reply: formatNewTaskReply(fullThread || thread, { project }),
        data: { thread: fullThread || thread }
      };
    }

    await this.sessionStore.clearFlow?.(key);
    return { ok: false, reply: "新建 Task 流程状态异常，已退出。请重新输入 new。" };
  }

  async handleOpen(key, index) {
    if (!Number.isInteger(index) || index < 1) {
      return { ok: false, reply: "请输入正确的 Task 编号，例如：open 2" };
    }

    const allThreads = await this.codexClient.listThreads({ limit: this.maxTasks });
    const taskMetadata = await this.sessionStore.listTaskMetadata?.() || {};
    const threads = this.projectStore.filterThreads(allThreads, taskMetadata);
    const session = await this.sessionStore.get(key);
    const displayedIds = session?.taskBrowser?.threadIds || [];
    const selected = displayedIds.length
      ? threads.find((thread) => thread.id === displayedIds[index - 1])
      : threads[index - 1];
    if (!selected) {
      return { ok: false, reply: `未找到 Task #${index}，请先输入 tasks 查看列表。` };
    }

    const metadata = await this.sessionStore.getTaskMetadata?.(selected.id);
    const projects = this.projectStore.listProjects({ threads, metadata: taskMetadata });
    const project = this.projectStore.projectForThread(selected, { metadata: taskMetadata, projects });
    const thread = await this.codexClient.readThread(selected.id, { includeTurns: true });
    const activity = this.jobManager?.isRunning?.(selected.id)
      ? null
      : await this.activityProbe.inspect(thread || selected);
    await this.sessionStore.set(key, {
      threadId: selected.id,
      title: metadata?.title || selected.name || selected.preview || selected.id,
      projectId: project.id,
      projectName: project.name,
      projectCwd: project.cwd || "",
      cwd: selected.cwd || project.cwd || "",
      index,
      lastDelivery: null
    });

    return {
      ok: true,
      reply: formatOpenReply(thread || selected, {
        index,
        project,
        bridgeRunning: this.jobManager?.isRunning?.(selected.id) || false,
        activity
      }),
      data: { thread: thread || selected }
    };
  }

  async handleRefreshCurrentTask(key) {
    const session = await this.sessionStore.get(key);
    if (!session?.threadId) {
      return {
        ok: false,
        reply: "当前未进入任何 Task。\n\n请先输入：\ntasks\n\n然后输入：\nopen <编号>"
      };
    }

    if (!this.projectStore.isAllowed(session.cwd || session.projectCwd || "")) {
      await this.sessionStore.clear(key);
      return { ok: false, reply: "当前 Task 已不在允许目录中，会话已退出。" };
    }

    const thread = await this.codexClient.readThread(session.threadId, { includeTurns: true });

    if (hasPendingUndeliveredResult(thread, session.lastDelivery)) {
      return { ok: true, reply: formatLastTaskStillRunning() };
    }

    const project = {
      id: session.projectId ?? 0,
      name: session.projectName || "默认（未分类）",
      cwd: session.projectCwd || session.cwd || ""
    };
    const prefix = formatUndeliveredResult(thread, session.lastDelivery);
    const bridgeRunning = this.jobManager?.isRunning?.(session.threadId) || false;
    const activity = bridgeRunning ? null : await this.activityProbe.inspect(thread || session);
    if (hasCompletedUndeliveredResult(thread, session.lastDelivery)) {
      await this.sessionStore.update?.(key, {
        lastDelivery: {
          ...session.lastDelivery,
          status: "completed",
          deliveredAt: new Date().toISOString()
        }
      });
    }
    return {
      ok: true,
      reply: formatOpenReply(thread || session, {
        index: session.index,
        project,
        prefix,
        bridgeRunning,
        activity
      }),
      data: { thread: thread || session }
    };
  }

  async handleExit(key) {
    await this.sessionStore.clearFlow?.(key);
    const existing = await this.sessionStore.clear(key);
    if (!existing?.threadId) {
      return { ok: true, reply: "当前没有打开任何 Task。" };
    }
    return {
      ok: true,
      reply: `已退出 Task。\n\n标题：\n${existing.title || existing.threadId}\n\n当前没有打开任何 Task。`
    };
  }

  async handleStatus(key) {
    const session = await this.sessionStore.get(key);
    if (!session?.threadId) return { ok: false, reply: "当前未进入任何 Task。请先发送 tasks，再发送 open <编号>。" };
    const job = this.jobManager?.getJob?.(session.threadId) || null;
    if (job) return { ok: true, reply: formatJobStatus(job) };

    const thread = await this.codexClient.readThread(session.threadId, { includeTurns: true });
    const activity = await this.activityProbe.inspect(thread || session);
    return {
      ok: true,
      reply: formatThreadStatus(thread || session, { activity }),
      data: { thread: thread || null }
    };
  }

  async handleChat(key, text, event) {
    const session = await this.sessionStore.get(key);
    if (!session?.threadId) {
      return {
        ok: false,
        reply: "当前未进入任何 Task。\n\n请先输入：\ntasks\n\n然后输入：\nopen <编号>"
      };
    }

    if (!this.projectStore.isAllowed(session.cwd || session.projectCwd || "")) {
      await this.sessionStore.clear(key);
      return { ok: false, reply: "当前 Task 已不在允许目录中，会话已退出。" };
    }

    if (this.jobManager?.isRunning?.(session.threadId)) {
      return {
        ok: false,
        reply: "当前任务正在执行中。\n\n请等待本轮执行结束后继续发送消息。"
      };
    }

    const thread = await this.codexClient.readThread(session.threadId, { includeTurns: true });
    const activity = await this.activityProbe.inspect(thread || session);
    const runtime = getThreadRuntimeState(thread || {}, { activity });
    if (runtime.kind === "running") {
      return {
        ok: false,
        reply: "当前任务仍在执行中，暂不追加新消息。\n\n发送 status 刷新最新状态；发送 open 刷新完整进展。"
      };
    }
    if (runtime.kind === "unknown") {
      return {
        ok: false,
        reply: "当前 Task 最近仍可能由 Desktop/CLI 操作，暂不追加新消息。\n\n请稍后发送 status 或 open 重新确认。"
      };
    }

    if (this.jobManager) {
      const job = this.jobManager.start({
        event,
        sessionKey: key,
        threadId: session.threadId,
        text,
        cwd: session.cwd || null
      });

      if (!job.started) {
        return {
          ok: false,
          reply: "当前任务正在执行中。\n\n请等待本轮执行结束后继续发送消息。"
        };
      }

      return {
        ok: true,
        reply: "Codex 已收到任务，开始执行……",
        data: { async: true, threadId: session.threadId }
      };
    }

    const result = await this.codexClient.sendMessage(session.threadId, text, { cwd: session.cwd || null });
    await this.sessionStore.update?.(key, {
      lastDelivery: {
        threadId: session.threadId,
        userText: text,
        submittedAt: new Date().toISOString(),
        status: result.ok ? "completed" : "failed",
        turnId: result.turn?.id || null,
        error: result.error || null
      }
    });
    return {
      ok: result.ok,
      reply: result.text || `Codex 本轮未生成回复。${result.error ? `\n\n原因：${result.error}` : ""}`,
      data: result
    };
  }
}

function isCancelNewFlow(text = "") {
  const command = text.trim().toLowerCase();
  return command === "exit"
    || command === "cancel"
    || command === "取消"
    || command === "退出"
    || command === "退出新建";
}

async function mapWithConcurrency(values, limit, iteratee) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (index < values.length) {
      const currentIndex = index;
      const current = values[currentIndex];
      index += 1;
      await iteratee(current, currentIndex);
    }
  });
  await Promise.all(workers);
}

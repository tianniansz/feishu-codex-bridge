import { developerSessionKey } from "./sessionStore.js";
import { DeveloperProjectStore } from "./projectStore.js";
import {
  formatLastTaskStillRunning,
  formatNewTaskReply,
  formatOpenReply,
  formatTasks,
  formatUndeliveredResult,
  hasCompletedUndeliveredResult,
  hasPendingUndeliveredResult,
  isRunningStatus
} from "./taskFormatter.js";

export class DeveloperRouter {
  constructor({ codexClient, sessionStore, projectStore = new DeveloperProjectStore(), jobManager = null, maxTasks = 50, allowCreateTask = false }) {
    this.codexClient = codexClient;
    this.sessionStore = sessionStore;
    this.projectStore = projectStore;
    this.jobManager = jobManager;
    this.maxTasks = maxTasks;
    this.allowCreateTask = allowCreateTask;
  }

  async handle(event) {
    const text = (event.text || "").trim();
    const command = text.toLowerCase();
    const key = developerSessionKey(event);

    const flow = await this.sessionStore.getFlow?.(key);
    if (flow) return this.handleFlow(key, text, flow);

    if (command === "tasks") return this.handleTasks();
    if (command === "new") return this.handleNew(key);
    if (command === "exit") return this.handleExit(key);
    if (command === "open") return this.handleRefreshCurrentTask(key);

    const openMatch = text.match(/^open\s+(\d+)$/i);
    if (openMatch) {
      return this.handleOpen(key, Number(openMatch[1]));
    }

    return this.handleChat(key, text, event);
  }

  async handleTasks() {
    const allThreads = await this.codexClient.listThreads({ limit: this.maxTasks });
    const taskMetadata = await this.sessionStore.listTaskMetadata?.() || {};
    const threads = this.projectStore.filterThreads(allThreads, taskMetadata);
    return {
      ok: true,
      reply: formatTasks(threads, {
        taskMetadata,
        projectStore: this.projectStore,
        runningThreadIds: this.jobManager?.runningThreadIds?.() || new Set()
      }),
      data: { threads }
    };
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
    const selected = threads[index - 1];
    if (!selected) {
      return { ok: false, reply: `未找到 Task #${index}，请先输入 tasks 查看列表。` };
    }

    const metadata = await this.sessionStore.getTaskMetadata?.(selected.id);
    const projects = this.projectStore.listProjects({ threads, metadata: taskMetadata });
    const project = this.projectStore.projectForThread(selected, { metadata: taskMetadata, projects });
    const thread = await this.codexClient.readThread(selected.id, { includeTurns: true });
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
      reply: formatOpenReply(thread || selected, { index, project }),
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

    if (this.jobManager?.isRunning?.(session.threadId)) {
      return { ok: true, reply: formatLastTaskStillRunning() };
    }

    const thread = await this.codexClient.readThread(session.threadId, { includeTurns: true });
    if (isRunningStatus(thread?.status)) {
      return { ok: true, reply: formatLastTaskStillRunning() };
    }

    if (hasPendingUndeliveredResult(thread, session.lastDelivery)) {
      return { ok: true, reply: formatLastTaskStillRunning() };
    }

    const project = {
      id: session.projectId ?? 0,
      name: session.projectName || "默认（未分类）",
      cwd: session.projectCwd || session.cwd || ""
    };
    const prefix = formatUndeliveredResult(thread, session.lastDelivery);
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
      reply: formatOpenReply(thread || session, { index: session.index, project, prefix }),
      data: { thread: thread || session }
    };
  }

  async handleExit(key) {
    await this.sessionStore.clearFlow?.(key);
    const existing = await this.sessionStore.clear(key);
    if (!existing) {
      return { ok: true, reply: "当前没有打开任何 Task。" };
    }
    return {
      ok: true,
      reply: `已退出 Task。\n\n标题：\n${existing.title || existing.threadId}\n\n当前没有打开任何 Task。`
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

    const thread = await this.codexClient.readThread(session.threadId, { includeTurns: false });
    if (isRunningStatus(thread?.status)) {
      return {
        ok: false,
        reply: "当前任务正在执行中。\n\n请等待本轮执行结束后继续发送消息。"
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

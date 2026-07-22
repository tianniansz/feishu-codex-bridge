import fs from "node:fs/promises";
import path from "node:path";

export class DeveloperSessionStore {
  constructor(filePath = path.resolve(process.cwd(), ".runtime", "developer-sessions.json")) {
    this.filePath = filePath;
    this.queue = Promise.resolve();
  }

  async get(key) {
    const data = await this.read();
    return data.sessions?.[key] || null;
  }

  async set(key, session) {
    return this.mutate((data) => {
      data.sessions[key] = { ...session, updatedAt: new Date().toISOString() };
      return data.sessions[key];
    });
  }

  async update(key, patch) {
    return this.mutate((data) => {
      const existing = data.sessions[key] || {};
      const value = typeof patch === "function" ? patch(existing) : patch;
      data.sessions[key] = { ...existing, ...value, updatedAt: new Date().toISOString() };
      return data.sessions[key];
    });
  }

  async clear(key) {
    return this.mutate((data) => {
      const existing = data.sessions[key] || null;
      delete data.sessions[key];
      return existing;
    });
  }

  async getFlow(key) {
    const data = await this.read();
    return data.flows?.[key] || null;
  }

  async setFlow(key, flow) {
    return this.mutate((data) => {
      data.flows[key] = { ...flow, updatedAt: new Date().toISOString() };
      return data.flows[key];
    });
  }

  async clearFlow(key) {
    return this.mutate((data) => {
      const existing = data.flows[key] || null;
      delete data.flows[key];
      return existing;
    });
  }

  async getTaskMetadata(threadId) {
    const data = await this.read();
    return data.taskMetadata?.[threadId] || null;
  }

  async listTaskMetadata() {
    const data = await this.read();
    return data.taskMetadata || {};
  }

  async setTaskMetadata(threadId, metadata) {
    return this.mutate((data) => {
      data.taskMetadata[threadId] = {
        ...(data.taskMetadata[threadId] || {}),
        ...metadata,
        updatedAt: new Date().toISOString()
      };
      return data.taskMetadata[threadId];
    });
  }

  async read() {
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      return JSON.parse(content);
    } catch (error) {
      if (error.code === "ENOENT") {
        return emptyStore();
      }
      throw error;
    }
  }

  async write(data) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(normalizeStore(data), null, 2)}\n`, "utf8");
    await fs.rename(temporary, this.filePath);
  }

  async mutate(updater) {
    let result;
    const operation = this.queue.then(async () => {
      const data = await this.read();
      result = await updater(data);
      await this.write(data);
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}

export function developerSessionKey(event) {
  return [event.chatId || "chat", event.senderId || "user"].join(":");
}

function emptyStore() {
  return { sessions: {}, flows: {}, taskMetadata: {} };
}

function normalizeStore(data = {}) {
  return {
    sessions: data.sessions || {},
    flows: data.flows || {},
    taskMetadata: data.taskMetadata || {}
  };
}

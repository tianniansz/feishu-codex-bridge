import fs from "node:fs/promises";
import path from "node:path";

export class EventStore {
  constructor(filePath, { maxEntries = 2_000 } = {}) {
    this.filePath = filePath;
    this.maxEntries = maxEntries;
    this.queue = Promise.resolve();
  }

  async claim(eventIds) {
    const ids = [...new Set((Array.isArray(eventIds) ? eventIds : [eventIds]).filter(Boolean))];
    if (ids.length === 0) return true;
    const operation = this.queue.then(async () => {
      const data = await this.read();
      if (data.events.some((event) => ids.includes(event.id)
        || (Array.isArray(event.aliases) && event.aliases.some((id) => ids.includes(id))))) {
        return false;
      }
      data.events.push({ id: ids[0], aliases: ids.slice(1), receivedAt: new Date().toISOString() });
      data.events = data.events.slice(-this.maxEntries);
      await this.write(data);
      return true;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  async read() {
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      return { events: Array.isArray(data.events) ? data.events : [] };
    } catch (error) {
      if (error.code === "ENOENT") return { events: [] };
      throw error;
    }
  }

  async write(data) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await fs.rename(temporary, this.filePath);
  }
}

import fs from "node:fs/promises";
import path from "node:path";

export class RuntimeControl {
  constructor(runtimeDir, { pollIntervalMs = 500 } = {}) {
    this.runtimeDir = runtimeDir;
    this.readyFile = path.join(runtimeDir, "bridge.ready");
    this.stopFile = path.join(runtimeDir, "bridge.stop");
    this.pollIntervalMs = pollIntervalMs;
    this.timer = null;
    this.stopping = false;
  }

  async initialize() {
    await fs.mkdir(this.runtimeDir, { recursive: true });
    // start.ps1 clears stale stop requests before launch. Preserve a new stop
    // request that may arrive while Node.js is still initializing.
    await removeIfExists(this.readyFile);
  }

  async markReady() {
    await fs.writeFile(this.readyFile, `${process.pid}\n`, "utf8");
  }

  startStopMonitor(onStop, onError = () => {}) {
    this.timer = setInterval(() => {
      void this.checkForStop(onStop).catch(onError);
    }, this.pollIntervalMs);
    this.timer.unref?.();
  }

  async checkForStop(onStop) {
    if (this.stopping || !await exists(this.stopFile)) return;
    this.stopping = true;
    await removeIfExists(this.stopFile);
    onStop();
  }

  async cleanup() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.all([removeIfExists(this.readyFile), removeIfExists(this.stopFile)]);
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function removeIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

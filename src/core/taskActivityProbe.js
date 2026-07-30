import fs from "node:fs/promises";

const RUNNING_STATUS = new Set(["active", "running", "processing", "queued", "inprogress"]);
const WAITING_TURN_STATUS = new Set(["completed", "complete", "done", "failed", "error"]);
const INTERRUPTED_TURN_STATUS = new Set(["interrupted", "cancelled", "canceled"]);

export class TaskActivityProbe {
  constructor({ waitMs = 800, cacheMs = 3000, activityGraceMs = 300_000, maxCacheEntries = 100, stat = fs.stat, wait = delay, now = () => Date.now() } = {}) {
    this.waitMs = waitMs;
    this.cacheMs = cacheMs;
    this.activityGraceMs = activityGraceMs;
    this.maxCacheEntries = maxCacheEntries;
    this.stat = stat;
    this.wait = wait;
    this.now = now;
    this.cache = new Map();
    this.inflight = new Map();
  }

  async inspect(thread = {}) {
    const immediate = immediateActivity(thread);
    if (immediate) return immediate;

    const filePath = typeof thread.path === "string" ? thread.path.trim() : "";
    if (!filePath) return activity("unknown", "no-rollout-path");

    const key = String(thread.id || filePath);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    if (this.inflight.has(key)) return this.inflight.get(key);

    const pending = this.sample(thread, filePath)
      .then((value) => {
        this.pruneCache();
        this.cache.set(key, { value, expiresAt: this.now() + this.cacheMs });
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, pending);
    return pending;
  }

  pruneCache() {
    const now = this.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
    while (this.cache.size >= this.maxCacheEntries) {
      this.cache.delete(this.cache.keys().next().value);
    }
  }

  async sample(thread, filePath) {
    const first = await safeStat(this.stat, filePath);
    if (!first) return activity("unknown", "rollout-unavailable");

    await this.wait(this.waitMs);
    const second = await safeStat(this.stat, filePath);
    if (!second) return activity("unknown", "rollout-unavailable");
    if (changed(first, second)) return activity("running", "rollout-changing");

    const lastTurn = Array.isArray(thread.turns) ? thread.turns.at(-1) : null;
    const turnStatus = normalizeStatus(lastTurn?.status);
    if (WAITING_TURN_STATUS.has(turnStatus) || (!lastTurn && normalizeStatus(thread.status) === "idle")) {
      return activity("waiting", "rollout-stable");
    }
    if (INTERRUPTED_TURN_STATUS.has(turnStatus)) {
      const lastActivityAt = latestActivityAt(thread, second.mtimeMs);
      if (lastActivityAt && this.now() - lastActivityAt <= this.activityGraceMs) {
        return activity("unknown", "interrupted-recent");
      }
      return activity("waiting", "interrupted-stale");
    }
    return activity("unknown", "rollout-stable-ambiguous");
  }
}

function immediateActivity(thread) {
  const threadStatus = normalizeStatus(thread.status);
  const lastTurn = Array.isArray(thread.turns) ? thread.turns.at(-1) : null;
  const turnStatus = normalizeStatus(lastTurn?.status);
  if (RUNNING_STATUS.has(threadStatus) || RUNNING_STATUS.has(turnStatus)) {
    return activity("running", RUNNING_STATUS.has(threadStatus) ? "thread-active" : "turn-in-progress");
  }
  return null;
}

async function safeStat(stat, filePath) {
  try {
    const value = await stat(filePath);
    return { size: Number(value.size), mtimeMs: Number(value.mtimeMs) };
  } catch {
    return null;
  }
}

function changed(first, second) {
  return first.size !== second.size || first.mtimeMs !== second.mtimeMs;
}

function activity(kind, evidence) {
  return { kind, evidence };
}

function normalizeStatus(status) {
  const value = typeof status === "string" ? status : status?.type || status?.state || status?.status;
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function latestActivityAt(thread, rolloutMtimeMs) {
  const lastTurn = Array.isArray(thread.turns) ? thread.turns.at(-1) : null;
  const values = [Number(rolloutMtimeMs), ...[
    thread.updatedAt,
    thread.updated_at,
    thread.lastActivityAt,
    lastTurn?.updatedAt,
    lastTurn?.completedAt,
    lastTurn?.createdAt
  ].map(timestampMs)]
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.max(...values) : 0;
}

function timestampMs(value) {
  if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value;
  if (!value) return Number.NaN;
  return Date.parse(value);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

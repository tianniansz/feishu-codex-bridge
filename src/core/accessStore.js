import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export class AccessStore {
  constructor(filePath, { pairingTtlMs = 600_000, now = () => Date.now() } = {}) {
    this.filePath = filePath;
    this.pairingTtlMs = pairingTtlMs;
    this.now = now;
    this.queue = Promise.resolve();
  }

  async isAuthorized(event) {
    if (!event?.senderId) return false;
    const data = await this.read();
    return data.authorizedUsers.some((user) => user.senderId === event.senderId);
  }

  async hasAuthorizedUser() {
    const data = await this.read();
    return data.authorizedUsers.length > 0;
  }

  async createPairingCode() {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(this.now() + this.pairingTtlMs).toISOString();
    await this.mutate((data) => ({
      ...data,
      pairing: { codeHash: hash(code), expiresAt }
    }));
    return { code, expiresAt };
  }

  async tryPair(event, text) {
    const match = String(text || "").trim().match(/^pair\s+(\d{6})$/i);
    if (!match) return { matched: false, ok: false };
    if (!event?.senderId) return { matched: true, ok: false, reason: "无法识别飞书用户身份。" };

    let result = { matched: true, ok: false, reason: "配对码无效或已过期。" };
    await this.mutate((data) => {
      const pairing = data.pairing;
      if (!pairing?.codeHash || Date.parse(pairing.expiresAt || "") <= this.now()) return data;
      if (!safeEqual(pairing.codeHash, hash(match[1]))) return data;

      const authorizedUsers = data.authorizedUsers.filter((user) => user.senderId !== event.senderId);
      authorizedUsers.push({
        senderId: event.senderId,
        pairedAt: new Date(this.now()).toISOString()
      });
      result = { matched: true, ok: true };
      return { ...data, authorizedUsers, pairing: null };
    });
    return result;
  }

  async reset() {
    await this.write(emptyStore());
  }

  async read() {
    try {
      return normalize(JSON.parse(await fs.readFile(this.filePath, "utf8")));
    } catch (error) {
      if (error.code === "ENOENT") return emptyStore();
      throw error;
    }
  }

  async mutate(updater) {
    const operation = this.queue.then(async () => {
      const current = await this.read();
      const next = normalize(await updater(current));
      await this.write(next);
      return next;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  async write(data) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(normalize(data), null, 2)}\n`, "utf8");
    await fs.rename(temporary, this.filePath);
  }
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function emptyStore() {
  return { authorizedUsers: [], pairing: null };
}

function normalize(data = {}) {
  return {
    authorizedUsers: Array.isArray(data.authorizedUsers) ? data.authorizedUsers : [],
    pairing: data.pairing || null
  };
}

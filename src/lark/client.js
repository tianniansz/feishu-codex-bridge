import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../logger.js";

export class LarkClient {
  constructor({ bin, profile, replyAs = "bot", runtimeDir }, runner = runCommand) {
    this.bin = bin;
    this.profile = profile;
    this.replyAs = replyAs;
    this.runtimeDir = runtimeDir;
    this.runner = runner;
  }

  async replyText(messageId, text, idempotencyKey = "", options = {}) {
    if (!messageId && !options.chatId) return null;
    const chunks = splitMessage(String(text || ""));
    const responses = [];
    for (let index = 0; index < chunks.length; index += 1) {
      responses.push(await this.sendChunk({
        messageId,
        chatId: options.chatId || "",
        text: chunks[index],
        idempotencyKey: idempotencyKey ? normalizeIdempotencyKey(`${idempotencyKey}:${index}`) : ""
      }));
    }
    return responses.at(-1) || null;
  }

  async sendChunk({ messageId, chatId, text, idempotencyKey }) {
    const args = messageId
      ? ["im", "+messages-reply", "--as", this.replyAs, "--format", "json", "--message-id", messageId]
      : ["im", "+messages-send", "--as", this.replyAs, "--format", "json", "--chat-id", chatId];
    if (idempotencyKey) args.push("--idempotency-key", idempotencyKey);
    args.push("--text", text);

    const output = await this.runner(this.bin, this.withProfile(args));
    return parseJsonOutput(output.stdout);
  }

  withProfile(args) {
    return this.profile ? ["--profile", this.profile, ...args] : args;
  }

}

export function normalizeIdempotencyKey(value, maxLength = 50) {
  const candidate = String(value || "");
  if (candidate.length <= maxLength) return candidate;
  const prefix = "fcb-";
  const digest = createHash("sha256").update(candidate).digest("hex");
  return `${prefix}${digest.slice(0, maxLength - prefix.length)}`;
}

export function runCommand(bin, args, { stdin = "ignore" } = {}) {
  return new Promise((resolve, reject) => {
    const command = windowsCommand(bin, args);
    const child = spawn(command.bin, command.args, { windowsHide: true, stdio: [stdin, "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      const failure = parseCommandFailure(stderr);
      logger.error("command.failed", {
        bin: path.basename(bin),
        code,
        identity: failure.identity,
        errorType: failure.type,
        errorSubtype: failure.subtype,
        missingScopes: failure.missingScopes
      });
      const detail = failure.summary ? ` ${failure.summary}` : "";
      reject(new Error(`${path.basename(bin)} 执行失败，退出码 ${code}。${detail}`.trim()));
    });
  });
}

export function parseCommandFailure(stderr) {
  const envelope = parseErrorEnvelope(stderr);
  const error = envelope?.error;
  if (error && typeof error === "object") {
    const identity = String(envelope.identity || "");
    const missingScopes = Array.isArray(error.missing_scopes)
      ? error.missing_scopes.map(String)
      : [];
    const parts = [error.message, error.hint].filter((value) => typeof value === "string" && value.trim());
    if (missingScopes.length) {
      const identityLabel = identity === "bot" ? "机器人" : identity === "user" ? "用户" : "当前身份";
      parts.push(`缺少${identityLabel}权限：${missingScopes.join(", ")}`);
    }
    return {
      identity,
      type: String(error.type || ""),
      subtype: String(error.subtype || ""),
      missingScopes,
      summary: redactDiagnostic(parts.join(" "))
    };
  }

  return {
    identity: "",
    type: "",
    subtype: "",
    missingScopes: [],
    summary: redactDiagnostic(String(stderr || "").trim().split(/\r?\n/).filter(Boolean).at(-1) || "")
  };
}

function parseErrorEnvelope(stderr) {
  const value = String(stderr || "").trim();
  if (!value) return null;
  for (const candidate of [value, ...value.split(/\r?\n/).reverse()]) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed?.error) return parsed;
    } catch {
      // Continue looking for a structured lark-cli error line.
    }
  }
  return null;
}

function redactDiagnostic(value) {
  return String(value || "")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-***")
    .replace(/\b(access|refresh|tenant)_token\s*[:=]\s*[^\s,}]+/gi, "$1_token=***")
    .slice(0, 800);
}

export function windowsCommand(bin, args, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  if (platform !== "win32") return { bin, args };

  const larkEntry = resolveLarkCliEntry(bin, env);
  if (larkEntry) {
    return { bin: options.nodeBin || process.execPath, args: [larkEntry, ...args] };
  }

  return { bin: env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", bin, ...args] };
}

export function resolveLarkCliEntry(bin, env = process.env) {
  if (path.basename(String(bin)).toLowerCase() !== "lark-cli.cmd") return "";

  const candidates = path.isAbsolute(bin)
    ? [bin]
    : String(env.Path || env.PATH || "")
      .split(path.delimiter)
      .map((directory) => directory.trim().replace(/^"|"$/g, ""))
      .filter(Boolean)
      .map((directory) => path.join(directory, bin));

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const entry = path.join(path.dirname(candidate), "node_modules", "@larksuite", "cli", "scripts", "run.js");
    if (fs.existsSync(entry)) return entry;
  }
  return "";
}

function parseJsonOutput(stdout) {
  const trimmed = stdout.trim();
  return trimmed ? JSON.parse(trimmed) : {};
}

function splitMessage(text, limit = 3800) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    let index = remaining.lastIndexOf("\n", limit);
    if (index < limit / 2) index = limit;
    chunks.push(remaining.slice(0, index));
    remaining = remaining.slice(index).replace(/^\n/, "");
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

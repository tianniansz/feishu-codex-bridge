import { spawn } from "node:child_process";
import { logger } from "../logger.js";

export class CodexAppServerClient {
  constructor({ bin = "codex", cwd = process.cwd(), timeoutMs = 120000 } = {}, spawnImpl = spawn) {
    this.bin = bin;
    this.cwd = cwd;
    this.timeoutMs = timeoutMs;
    this.spawnImpl = spawnImpl;
  }

  async listThreads({ limit = 50, archived = false } = {}) {
    const maxThreads = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
    const threads = [];
    let cursor = null;

    do {
      const params = {
        limit: maxThreads - threads.length,
        archived,
        sortKey: "recency_at",
        sortDirection: "desc"
      };
      if (cursor) params.cursor = cursor;

      const result = await this.request([
        rpc(1, "thread/list", params)
      ], { waitForIds: [1] });
      const page = result[1] || {};
      threads.push(...(page.data || []));
      cursor = page.nextCursor || null;
    } while (cursor && threads.length < maxThreads);

    return threads.slice(0, maxThreads);
  }

  async readThread(threadId, { includeTurns = true } = {}) {
    const result = await this.request([
      rpc(1, "thread/read", {
        threadId,
        includeTurns
      })
    ], { waitForIds: [1] });

    return result[1]?.thread || null;
  }

  async resumeThread(threadId) {
    const result = await this.request([
      rpc(1, "thread/resume", { threadId })
    ], { waitForIds: [1] });

    return result[1]?.thread || null;
  }

  async startThread({
    cwd = this.cwd,
    name = "",
    developerInstructions = "",
    sandbox = null,
    approvalPolicy = null,
    model = null
  } = {}) {
    const params = {
      cwd,
      threadSource: "appServer"
    };
    if (developerInstructions) params.developerInstructions = developerInstructions;
    if (sandbox) params.sandbox = sandbox;
    if (approvalPolicy) params.approvalPolicy = approvalPolicy;
    if (model) params.model = model;

    const messages = [
      rpc(1, "thread/start", params)
    ];
    if (name) {
      messages.push(threadNameSetAfterStart(2, name));
    }

    const startResult = await this.request(messages, {
      waitForIds: name ? [1, 2] : [1]
    });

    const thread = startResult[1]?.thread || null;
    if (!thread?.id || !name) return thread;
    return {
      ...thread,
      name
    };
  }

  async setThreadName(threadId, name) {
    await this.request([
      rpc(1, "thread/name/set", { threadId, name })
    ], { waitForIds: [1] });
  }

  async forkThread(threadId, { ephemeral = false } = {}) {
    const result = await this.request([
      rpc(1, "thread/fork", { threadId, ephemeral })
    ], { waitForIds: [1] });

    return result[1]?.thread || null;
  }

  async archiveThread(threadId) {
    await this.request([
      rpc(1, "thread/archive", { threadId })
    ], { waitForIds: [1] });
  }

  async sendMessage(threadId, text, {
    cwd = null,
    timeoutMs = this.timeoutMs,
    onApproval = null,
    onProgress = null
  } = {}) {
    const deltas = [];
    let terminalTurn = null;
    let finalText = "";

    const messages = [
      rpc(1, "thread/resume", { threadId }),
      rpc(2, "turn/start", {
        threadId,
        cwd,
        input: [{ type: "text", text }]
      })
    ];

    const result = await this.request(messages, {
      waitForIds: [1, 2],
      timeoutMs,
      onNotification(message) {
        onProgress?.(message);
        if (message.method === "item/agentMessage/delta") {
          deltas.push(message.params?.delta || "");
        }
        if (message.method === "item/completed" && message.params?.item?.type === "agentMessage") {
          finalText = message.params.item.text || finalText;
        }
        if (message.method === "turn/completed") {
          terminalTurn = message.params?.turn || null;
        }
      },
      async onServerRequest(message) {
        if (["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(message.method)) {
          if (!onApproval) return { decision: "decline" };
          return onApproval({ method: message.method, ...(message.params || {}) });
        }
        throw new Error(`Unsupported Codex server request: ${message.method}`);
      },
      shouldStop() {
        return Boolean(terminalTurn);
      }
    });

    const startedTurn = result[2]?.turn || null;
    const turn = terminalTurn || startedTurn;
    let replyText = (finalText || deltas.join("")).trim();

    if (!replyText) {
      const persistedThread = await this.readThread(threadId, { includeTurns: true });
      const persistedTurn = findTurn(persistedThread, turn?.id);
      replyText = findAgentText(persistedTurn).trim();
    }

    const status = turn?.status || "unknown";
    const warning = result.__stderr || "";
    const error = buildTurnError({ status, turn, replyText, warning });

    return {
      ok: status === "completed" && Boolean(replyText),
      thread: result[1]?.thread || null,
      turn,
      status,
      error,
      warning,
      text: replyText
    };
  }

  request(messages, options = {}) {
    const waitForIds = new Set(options.waitForIds || []);
    const timeoutMs = options.timeoutMs || this.timeoutMs;
    const onNotification = options.onNotification || (() => {});
    const onServerRequest = options.onServerRequest || null;
    const shouldStop = options.shouldStop || (() => false);

    return new Promise((resolve, reject) => {
      const command = windowsCommand(this.bin, ["app-server", "--stdio"]);
      const child = this.spawnImpl(command.bin, command.args, {
        cwd: this.cwd,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });

      const results = {};
      const pendingMessages = [...messages];
      let stdoutBuffer = "";
      let stderr = "";
      let settled = false;
      let initialized = false;
      let inFlightId = null;

      const timer = setTimeout(() => {
        finish(new Error(`codex app-server timed out after ${timeoutMs}ms: ${stderr.trim()}`));
      }, timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", (chunk) => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() || "";
        for (const line of lines) {
          handleLine(line);
        }
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });

      child.on("error", finish);
      child.on("close", (code) => {
        if (settled) return;
        if (code && !allResponsesReceived()) {
          finish(new Error(`codex app-server exited with code ${code}: ${stderr.trim()}`));
          return;
        }
        finish(null, results);
      });

      write({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          clientInfo: {
            name: "feishu-codex-bridge",
            version: "0.1.0"
          }
        }
      });

      function handleLine(line) {
        const trimmed = line.trim();
        if (!trimmed) return;

        let message;
        try {
          message = JSON.parse(trimmed);
        } catch (error) {
          logger.error("codex_app_server.invalid_json", { error: error.message });
          return;
        }

        if (message.id !== undefined && message.method) {
          void handleServerRequest(message);
          return;
        }

        if (message.id !== undefined) {
          if (message.error) {
            finish(new Error(`codex app-server ${message.id} failed: ${JSON.stringify(message.error)}`));
            return;
          }
          results[message.id] = message.result;
          if (message.id === 0) {
            initialized = true;
          }
          if (message.id === inFlightId) {
            inFlightId = null;
          }
          writeNext();
        } else {
          onNotification(message);
        }

        if ((allResponsesReceived() && shouldStop()) || (allResponsesReceived() && !options.shouldStop)) {
          finish(null, results);
        }
      }

      async function handleServerRequest(message) {
        if (!onServerRequest) {
          write({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Unsupported server request: ${message.method}` } });
          return;
        }
        try {
          const result = await onServerRequest(message);
          if (!settled) write({ jsonrpc: "2.0", id: message.id, result });
        } catch (error) {
          if (!settled) write({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: error.message } });
        }
      }

      function allResponsesReceived() {
        for (const id of waitForIds) {
          if (!Object.hasOwn(results, id)) return false;
        }
        return true;
      }

      function write(message) {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      }

      function writeNext() {
        if (settled || !initialized || inFlightId !== null || pendingMessages.length === 0) return;
        const message = resolveMessage(pendingMessages.shift(), results);
        inFlightId = message.id;
        write(message);
      }

      function finish(error, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill();
        if (error) {
          reject(error);
          return;
        }
        results.__stderr = stderr.trim();
        resolve(value);
      }
    });
  }
}

function findTurn(thread, turnId) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  if (turnId) return turns.find((turn) => turn.id === turnId) || null;
  return turns.at(-1) || null;
}

function findAgentText(turn) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.type === "agentMessage" && item.text) return item.text;
  }
  return "";
}

function buildTurnError({ status, turn, replyText, warning }) {
  if (status === "failed") return turn?.error?.message || "Codex turn failed.";
  if (status === "interrupted") return "Codex turn was interrupted.";
  if (!replyText) {
    if (/unknown model/i.test(warning)) return "Codex App Server does not recognize the Task model.";
    return "Codex turn completed without an agent message.";
  }
  return null;
}

function rpc(id, method, params) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params
  };
}

function threadNameSetAfterStart(id, name) {
  return {
    jsonrpc: "2.0",
    id,
    method: "thread/name/set",
    params: ({ results }) => ({
      threadId: results[1]?.thread?.id,
      name
    })
  };
}

function resolveMessage(message, results) {
  if (typeof message.params !== "function") return message;
  return {
    ...message,
    params: message.params({ results })
  };
}

function windowsCommand(bin, args) {
  if (process.platform !== "win32") {
    return { bin, args };
  }
  return {
    bin: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", bin, ...args]
  };
}

import path from "node:path";
import { loadDotEnv } from "./env.js";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { CodexAppServerClient } from "./codex/appServerClient.js";
import { AccessStore } from "./core/accessStore.js";
import { DeveloperJobManager } from "./core/jobManager.js";
import { EventStore } from "./core/eventStore.js";
import { DeveloperProjectStore } from "./core/projectStore.js";
import { DeveloperRouter } from "./core/router.js";
import { DeveloperSessionStore } from "./core/sessionStore.js";
import { LarkClient } from "./lark/client.js";
import { LarkEventRunner } from "./lark/eventRunner.js";
import { RuntimeControl } from "./runtimeControl.js";

loadDotEnv();

const config = loadConfig();
const runtimeControl = new RuntimeControl(config.runtimeDir);
await runtimeControl.initialize();
const sessionStore = new DeveloperSessionStore(path.join(config.runtimeDir, "sessions.json"));
const accessStore = new AccessStore(path.join(config.runtimeDir, "access.json"), {
  pairingTtlMs: config.bridge.pairingTtlMs
});
const eventStore = new EventStore(path.join(config.runtimeDir, "events.json"));
const larkClient = new LarkClient({ ...config.lark, runtimeDir: config.runtimeDir });
const codexClient = new CodexAppServerClient(config.codex);
const projectStore = new DeveloperProjectStore({ allowedRoots: config.bridge.allowedWorkspaceRoots });
const jobManager = new DeveloperJobManager({
  codexClient,
  feishuClient: larkClient,
  sessionStore,
  runningNoticeDelayMs: config.bridge.runningNoticeDelayMs,
  progressNoticeIntervalMs: config.bridge.progressNoticeIntervalMs
});
const router = new DeveloperRouter({
  codexClient,
  sessionStore,
  projectStore,
  jobManager,
  maxTasks: config.bridge.taskLimit,
  taskPageSize: config.bridge.taskPageSize,
  allowCreateTask: config.bridge.allowCreateTask
});
const runner = new LarkEventRunner({
  config: config.lark,
  client: larkClient,
  router,
  accessStore,
  eventStore,
  onReady: () => runtimeControl.markReady()
});

logger.info("bridge.starting", {
  profile: config.lark.profile,
  workspaceCount: config.bridge.allowedWorkspaceRoots.length
});

let stopping = false;
function requestStop(reason) {
  if (stopping) return;
  stopping = true;
  logger.info("bridge.stopping", { reason });
  runner.stop();
}

runtimeControl.startStopMonitor(
  () => requestStop("stop-file"),
  (error) => {
    logger.error("bridge.runtime_control_failed", { error: error.message });
    requestStop("runtime-control-error");
  }
);
process.on("SIGINT", () => requestStop("SIGINT"));
process.on("SIGTERM", () => requestStop("SIGTERM"));

try {
  await runner.start();
} catch (error) {
  logger.error("bridge.stopped", { error: error.message });
  process.exitCode = 1;
} finally {
  await runtimeControl.cleanup();
}

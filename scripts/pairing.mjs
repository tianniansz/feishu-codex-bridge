import path from "node:path";
import { loadDotEnv } from "../src/env.js";
import { loadConfig } from "../src/config.js";
import { AccessStore } from "../src/core/accessStore.js";

loadDotEnv();

try {
  const config = loadConfig();
  const store = new AccessStore(path.join(config.runtimeDir, "access.json"), {
    pairingTtlMs: config.bridge.pairingTtlMs
  });
  if (process.argv.includes("--reset")) await store.reset();
  const pairing = await store.createPairingCode();

  console.log("");
  console.log("请向你的飞书机器人发送：");
  console.log("");
  console.log(`  pair ${pairing.code}`);
  console.log("");
  console.log(`配对码有效期至：${new Date(pairing.expiresAt).toLocaleString("zh-CN")}`);
  console.log("配对完成后，发送 tasks 查看 Codex Task。");
} catch (error) {
  console.error(`生成配对码失败：${error.message}`);
  process.exitCode = 1;
}

import fs from "node:fs/promises";
import path from "node:path";
import { loadDotEnv } from "../src/env.js";
import { loadConfig } from "../src/config.js";
import { AccessStore } from "../src/core/accessStore.js";
import { runCommand } from "../src/lark/client.js";

loadDotEnv();

const checks = [];
let config;

await check("Node.js >= 20", async () => {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) throw new Error(`当前版本 ${process.version}`);
  return process.version;
});

await check("配置文件", async () => {
  config = loadConfig();
  return `${config.bridge.allowedWorkspaceRoots.length} 个允许目录`;
});

if (config) {
  await check("Codex CLI", async () => (await runCommand(config.codex.bin, ["--version"])).stdout.trim());
  await check("Codex 登录", async () => {
    await runCommand(config.codex.bin, ["login", "status"]);
    return "已登录";
  });
  await check("Codex App Server", async () => {
    await runCommand(config.codex.bin, ["app-server", "--help"]);
    return "可用";
  });
  await check("lark-cli", async () => (await runCommand(config.lark.bin, ["--version"])).stdout.trim());
  await check("飞书 Profile", async () => {
    const output = await runCommand(config.lark.bin, ["--profile", config.lark.profile, "whoami"]);
    const identity = JSON.parse(output.stdout.trim());
    if (identity.ok === false || identity.available === false) throw new Error("Profile 不可用");
    return config.lark.profile;
  });
  for (const root of config.bridge.allowedWorkspaceRoots) {
    await check(`工作目录 ${path.basename(root)}`, async () => {
      const stat = await fs.stat(root);
      if (!stat.isDirectory()) throw new Error("不是目录");
      return "可访问";
    });
  }
  await check("飞书配对", async () => {
    const store = new AccessStore(path.join(config.runtimeDir, "access.json"));
    return await store.hasAuthorizedUser() ? "已配对" : "待配对（运行 feishu-codex-bridge pairing）";
  }, { warningOnly: true });
}

console.log("");
for (const item of checks) {
  const icon = item.ok ? (item.warning ? "⚠️" : "✅") : "❌";
  console.log(`${icon} ${item.name}：${item.message}`);
}

const failed = checks.filter((item) => !item.ok);
console.log("");
if (failed.length) {
  console.log(`自检未通过：${failed.length} 项需要处理。详见 docs/TROUBLESHOOTING.md。`);
  process.exitCode = 1;
} else {
  console.log("系统已准备完成。");
}

async function check(name, action, { warningOnly = false } = {}) {
  try {
    const message = await action();
    checks.push({ name, ok: true, warning: warningOnly && String(message).startsWith("待"), message });
  } catch (error) {
    checks.push({ name, ok: warningOnly, warning: warningOnly, message: error.message });
  }
}

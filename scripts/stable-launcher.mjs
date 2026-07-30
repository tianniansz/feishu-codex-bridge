#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const installRoot = path.dirname(fileURLToPath(import.meta.url));
const currentFile = path.join(installRoot, "current.json");

try {
  const current = JSON.parse(fs.readFileSync(currentFile, "utf8"));
  const packageRoot = path.resolve(String(current.packageRoot || ""));
  const versionsRoot = `${path.resolve(installRoot, "versions")}${path.sep}`;
  if (!packageRoot.startsWith(versionsRoot)) {
    throw new Error("current.json 中的 packageRoot 不在 versions 目录内");
  }

  const cliPath = path.join(packageRoot, "bin", "cli.js");
  if (!fs.existsSync(cliPath)) throw new Error(`CLI 不存在：${cliPath}`);
  const result = spawnSync(process.execPath, [cliPath, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    windowsHide: false
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
} catch (error) {
  console.error(`Feishu Codex Bridge 启动器失败：${error.message}`);
  process.exit(1);
}

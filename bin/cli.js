#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCliPaths } from "../src/cliPaths.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const parsed = parseArguments(process.argv.slice(2));
const command = parsed.args[0] || "help";
const commandArgs = parsed.args.slice(1);
const cliEnv = { ...process.env };
if (parsed.home) cliEnv.FEISHU_CODEX_HOME = parsed.home;
const paths = getCliPaths(cliEnv);
cliEnv.FEISHU_CODEX_HOME = paths.dataDir;
cliEnv.FEISHU_CODEX_ENV_FILE = paths.configFile;
cliEnv.FEISHU_CODEX_SETUP_CWD = process.cwd();

if (["help", "--help", "-h"].includes(command)) {
  printHelp();
  process.exit(0);
}
if (["version", "--version", "-v"].includes(command)) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  console.log(packageJson.version);
  process.exit(0);
}
if (process.platform !== "win32") {
  fail("当前版本仅支持 Windows。", 1);
}

let exitCode;
switch (command) {
  case "setup":
    exitCode = runPowerShell("setup.ps1");
    break;
  case "start":
    exitCode = runPowerShell("start.ps1", commandArgs.includes("--foreground") ? ["-Foreground"] : []);
    break;
  case "status":
    exitCode = runPowerShell("status.ps1");
    break;
  case "stop":
    exitCode = runPowerShell("stop.ps1");
    break;
  case "restart":
    exitCode = runPowerShell("stop.ps1");
    if (exitCode === 0) exitCode = runPowerShell("start.ps1");
    break;
  case "doctor":
    exitCode = runNodeScript("scripts/doctor.mjs");
    break;
  case "pairing":
    exitCode = runNodeScript("scripts/pairing.mjs", commandArgs.includes("--reset") ? ["--reset"] : []);
    break;
  case "logs":
    exitCode = showLogs(commandArgs);
    break;
  case "config":
    exitCode = showConfig(commandArgs);
    break;
  case "service":
    exitCode = manageService(commandArgs[0]);
    break;
  default:
    fail(`未知命令：${command}\n运行 feishu-codex-bridge help 查看帮助。`, 1);
}

process.exit(exitCode ?? 1);

function runPowerShell(scriptName, args = []) {
  return run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", path.join(packageRoot, scriptName),
    ...args
  ]);
}

function runNodeScript(relativePath, args = []) {
  return run(process.execPath, [path.join(packageRoot, relativePath), ...args]);
}

function run(bin, args, options = {}) {
  const result = spawnSync(bin, args, {
    cwd: packageRoot,
    env: cliEnv,
    stdio: "inherit",
    windowsHide: false,
    ...options
  });
  if (result.error) {
    console.error(`命令启动失败：${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function showLogs(args) {
  const requestedLines = Number(args.find((value) => /^\d+$/.test(value)) || 100);
  const lineCount = Math.max(1, Math.min(requestedLines, 1000));
  const files = ["bridge.log", "bridge.error.log"];
  let found = false;
  for (const fileName of files) {
    const filePath = path.join(paths.runtimeDir, fileName);
    if (!fs.existsSync(filePath)) continue;
    found = true;
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
    console.log(`\n--- ${filePath} ---`);
    console.log(lines.slice(-lineCount).join("\n"));
  }
  if (!found) {
    console.log(`尚无日志。日志目录：${paths.runtimeDir}`);
    return 1;
  }
  return 0;
}

function showConfig(args) {
  console.log(`配置文件：${paths.configFile}`);
  console.log(`运行目录：${paths.runtimeDir}`);
  if (args[0] === "edit") {
    if (!fs.existsSync(paths.configFile)) {
      console.error("配置尚未生成，请先运行 feishu-codex-bridge setup。")
      return 1;
    }
    return run("notepad.exe", [paths.configFile]);
  }
  return fs.existsSync(paths.configFile) ? 0 : 1;
}

function manageService(action) {
  const taskName = `FeishuCodexBridge-${process.env.USERNAME || "CurrentUser"}`;
  if (action === "install") {
    if (!fs.existsSync(paths.configFile)) {
      console.error("配置尚未生成，请先运行 feishu-codex-bridge setup。")
      return 1;
    }
    const cliPath = fileURLToPath(import.meta.url);
    const taskCommand = `"${process.execPath}" "${cliPath}" --home "${paths.dataDir}" start`;
    const code = run("schtasks.exe", [
      "/Create", "/SC", "ONLOGON", "/TN", taskName,
      "/TR", taskCommand, "/F"
    ]);
    if (code === 0) console.log("已注册当前用户登录时自动启动。使用 service uninstall 可移除。");
    return code;
  }
  if (action === "uninstall") {
    runPowerShell("stop.ps1");
    return run("schtasks.exe", ["/Delete", "/TN", taskName, "/F"]);
  }
  if (action === "status") {
    return run("schtasks.exe", ["/Query", "/TN", taskName, "/V", "/FO", "LIST"]);
  }
  console.error("用法：feishu-codex-bridge service <install|status|uninstall>");
  return 1;
}

function parseArguments(args) {
  const remaining = [];
  let home;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--home") {
      home = args[index + 1];
      index += 1;
    } else {
      remaining.push(args[index]);
    }
  }
  return { args: remaining, home };
}

function printHelp() {
  console.log(`Feishu Codex Bridge

用法：feishu-codex-bridge <命令>

  setup                 配置环境、飞书机器人和工作目录
  doctor                运行环境自检
  start [--foreground]  启动后台服务或前台调试
  status                查看运行状态
  logs [行数]           查看最近日志，默认 100 行
  stop                  停止服务
  restart               重启服务
  pairing [--reset]     生成配对码或撤销全部配对
  config [edit]         显示配置路径或用记事本编辑
  service install       注册当前用户登录时自动启动
  service status        查看自动启动任务
  service uninstall     停止服务并移除自动启动任务
  version               显示版本
`);
}

function fail(message, code) {
  console.error(message);
  process.exit(code);
}

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { RuntimeControl } from "../src/runtimeControl.js";
import { LarkEventRunner } from "../src/lark/eventRunner.js";

test("运行控制写入 ready 状态并响应 stop 请求", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "feishu-codex-runtime-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const control = new RuntimeControl(directory, { pollIntervalMs: 10 });
  await fs.writeFile(control.stopFile, "requested-during-startup\n", "utf8");
  await control.initialize();
  await control.markReady();
  assert.equal(await fileExists(control.readyFile), true);

  let stopped = false;
  control.startStopMonitor(() => { stopped = true; });
  await waitFor(() => stopped);
  await control.cleanup();

  assert.equal(await fileExists(control.readyFile), false);
  assert.equal(await fileExists(control.stopFile), false);
});

test("事件监听等待 ready marker 并通过 stdin EOF 优雅停止", async () => {
  const harness = fakeEventProcess();
  let readyCount = 0;
  const runner = new LarkEventRunner({
    config: { bin: "lark-cli", profile: "test", eventAs: "bot", allowGroupChats: false },
    client: {},
    router: {},
    accessStore: {},
    eventStore: {},
    spawnImpl: harness.spawn,
    onReady() { readyCount += 1; }
  });

  const lifecycle = runner.start();
  harness.child.stderr.write("[event] ready event_key=im.message.receive_v1\n");
  harness.child.stderr.write("[event] ready event_key=im.message.receive_v1\n");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(readyCount, 1);
  assert.deepEqual(harness.options.stdio, ["pipe", "pipe", "pipe"]);
  assert.equal(harness.args.includes("--quiet"), false);

  runner.stop();
  await lifecycle;
  assert.equal(harness.child.stdin.writableEnded, true);
});

test("Windows 助手可识别 Profile 状态并规范化启动环境", { skip: process.platform !== "win32" }, () => {
  const helperPath = path.resolve("scripts", "windows-helpers.ps1").replaceAll("'", "''");
  const script = [
    `. '${helperPath}'`,
    `if (-not (Test-LarkWhoamiOutput '{"available":true}')) { exit 11 }`,
    `if (Test-LarkWhoamiOutput '{"available":false}') { exit 12 }`,
    `if (Test-LarkWhoamiOutput 'not-json') { exit 13 }`,
    "Normalize-BridgeProcessPath",
    "$p = Start-Process -FilePath 'node' -ArgumentList '--version' -WindowStyle Hidden -PassThru -Wait",
    "exit $p.ExitCode"
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    windowsHide: true
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("Windows 安装向导按 package.json 计算 npm 包路径", { skip: process.platform !== "win32" }, () => {
  const helperPath = path.resolve("scripts", "windows-helpers.ps1").replaceAll("'", "''");
  const projectRoot = path.resolve(".").replaceAll("'", "''");
  const destination = path.resolve(os.tmpdir()).replaceAll("'", "''");
  const script = [
    `. '${helperPath}'`,
    `$archive = Get-BridgePackageArchivePath -ProjectRoot '${projectRoot}' -Destination '${destination}'`,
    `if ([IO.Path]::GetFileName($archive) -ne 'feishu-codex-bridge-0.2.0-beta.1.tgz') { Write-Error $archive; exit 41 }`
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    windowsHide: true
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("Windows 登录检查忽略 Codex 写入 stderr 的成功信息", { skip: process.platform !== "win32" }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "feishu-codex-login-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const fakeCodex = path.join(directory, "codex.cmd");
  await fs.writeFile(fakeCodex, "@echo Logged in using a masked key 1>&2\r\n@exit /b 0\r\n", "utf8");

  const helperPath = path.resolve("scripts", "windows-helpers.ps1").replaceAll("'", "''");
  const script = [
    `. '${helperPath}'`,
    `if (-not (Test-CodexLoginStatus)) { exit 42 }`
  ].join("; ");
  const childEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path")
  );
  childEnv.Path = `${directory};${process.env.Path || process.env.PATH || ""}`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    env: childEnv
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout + result.stderr, /masked key/);
});

test("Windows 源码向导保留 CLI stdin 并关闭 lark-cli 二次确认", { skip: process.platform !== "win32" }, async () => {
  const setupScript = await fs.readFile(path.resolve("setup.ps1"), "utf8");
  assert.match(setupScript, /& \$CliCommand setup\s*\r?\n/);
  assert.doesNotMatch(setupScript, /& \$CliCommand setup\s*\|/);
  assert.match(setupScript, /npx\.cmd --yes @larksuite\/cli@latest install/);
  assert.doesNotMatch(setupScript, /Install-And-RunBridgeCli\)\)/);
});

test("Windows 启动脚本在缺少 Node.js 时返回配置向导提示", { skip: process.platform !== "win32" }, () => {
  const startPath = path.resolve("start.ps1").replaceAll("'", "''");
  const powershellPath = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = `$env:Path = 'C:\\__feishu_codex_bridge_missing__'; & '${startPath}'`;
  const result = spawnSync(powershellPath, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    windowsHide: true
  });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /setup\.ps1/);
  assert.doesNotMatch(result.stderr, /Start-Process/);
});

function fakeEventProcess() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => queueMicrotask(() => child.emit("close", 0));
  child.stdin.on("finish", () => queueMicrotask(() => child.emit("close", 0)));
  const harness = { child, args: null, options: null };
  harness.spawn = (bin, args, options) => {
    harness.bin = bin;
    harness.args = args;
    harness.options = options;
    return child;
  };
  return harness;
}

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("等待条件超时");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

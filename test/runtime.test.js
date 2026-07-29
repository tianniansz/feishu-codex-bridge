import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
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

test("单条飞书消息回复失败不会退出事件服务", async () => {
  const runner = new LarkEventRunner({
    config: { bin: "lark-cli", profile: "test", eventAs: "bot", allowGroupChats: false },
    client: { async replyText() { throw new Error("reply failed"); } },
    router: {},
    accessStore: {
      async tryPair() { return { matched: true, ok: true }; }
    },
    eventStore: { async claim() { return true; } }
  });

  await assert.doesNotReject(() => runner.handleLineSafely(JSON.stringify({
    type: "im.message.receive_v1",
    event_id: "evt_test",
    message_id: "om_test",
    chat_id: "oc_test",
    sender_id: "ou_test",
    sender_type: "user",
    chat_type: "p2p",
    message_type: "text",
    content: "pair 123456"
  })));
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

test("Windows 助手可读取 active Profile、现有配置和配对状态", { skip: process.platform !== "win32" }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "feishu-codex-profile-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const fakeLark = path.join(directory, "fake-lark.cmd");
  const configFile = path.join(directory, "config.env");
  const runtimeDir = path.join(directory, "runtime");
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(fakeLark, [
    '@echo status message 1>&2',
    '@if "%1"=="config" echo [{"name":"active-profile","active":true}]',
    '@if not "%1"=="config" echo {"available":true}',
    '@exit /b 0',
    ''
  ].join("\r\n"), "utf8");
  await fs.writeFile(configFile, "LARK_CLI_PROFILE=existing-profile\r\n", "utf8");
  await fs.writeFile(path.join(runtimeDir, "access.json"), JSON.stringify({
    authorizedUsers: [{ senderId: "ou_test" }],
    pairing: null
  }), "utf8");

  const helperPath = path.resolve("scripts", "windows-helpers.ps1").replaceAll("'", "''");
  const script = [
    `$ErrorActionPreference = 'Stop'`,
    `. '${helperPath}'`,
    `$profile = Get-ActiveLarkProfile -LarkCli '${fakeLark.replaceAll("'", "''")}'`,
    `if ($profile -ne 'active-profile') { Write-Error $profile; exit 51 }`,
    `if (-not (Test-LarkProfile -Profile 'active-profile' -LarkCli '${fakeLark.replaceAll("'", "''")}')) { exit 54 }`,
    `$configured = Get-BridgeConfigValue -ConfigFile '${configFile.replaceAll("'", "''")}' -Name 'LARK_CLI_PROFILE'`,
    `if ($configured -ne 'existing-profile') { Write-Error $configured; exit 52 }`,
    `if (-not (Test-BridgeHasPairedUser -RuntimeDir '${runtimeDir.replaceAll("'", "''")}')) { exit 53 }`
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
  const packageVersion = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")).version;
  const script = [
    `. '${helperPath}'`,
    `$archive = Get-BridgePackageArchivePath -ProjectRoot '${projectRoot}' -Destination '${destination}'`,
    `if ([IO.Path]::GetFileName($archive) -ne 'feishu-codex-bridge-${packageVersion}.tgz') { Write-Error $archive; exit 41 }`
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
  assert.match(setupScript, /npm\.cmd install -g @larksuite\/cli@latest/);
  assert.doesNotMatch(setupScript, /npx\.cmd --yes @larksuite\/cli@latest install/);
  assert.doesNotMatch(setupScript, /Install-And-RunBridgeCli\)\)/);
});

test("Windows 升级先停止旧服务并隐藏成功打包的原始输出", { skip: process.platform !== "win32" }, async () => {
  const setupScript = await fs.readFile(path.resolve("setup.ps1"), "utf8");
  const stopIndex = setupScript.indexOf("& $ExistingCli.Source stop");
  const installIndex = setupScript.indexOf("Install-BridgeCliPackageWithRetry -PackageFile $PackageFile", stopIndex);

  assert.ok(stopIndex >= 0);
  assert.ok(installIndex > stopIndex);
  assert.match(setupScript, /\$PackOutput = & npm\.cmd pack --silent/);
  assert.match(setupScript, /CLI 安装包生成完成/);
  assert.doesNotMatch(setupScript, /npm\.cmd pack --silent[^\r\n]*\| Out-Host/);
});

test("Windows CLI installer retries a transient global install failure three times", { skip: process.platform !== "win32" }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "feishu-codex-npm-retry-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const counterPath = path.join(directory, "attempts.txt");
  const fakeNpmPath = path.join(directory, "npm.cmd");
  await fs.writeFile(counterPath, "0\n", "ascii");
  await fs.writeFile(fakeNpmPath, [
    "@echo off",
    `set /p attempts=<\"${counterPath}\"`,
    "set /a attempts+=1",
    `>\"${counterPath}\" echo %attempts%`,
    "if %attempts% LSS 3 exit /b 1",
    "exit /b 0"
  ].join("\r\n"), "ascii");

  const helperPath = path.resolve("scripts", "windows-helpers.ps1").replaceAll("'", "''");
  const quotedNpmPath = fakeNpmPath.replaceAll("'", "''");
  const script = [
    `. '${helperPath}'`,
    `Install-BridgeCliPackageWithRetry -PackageFile 'test.tgz' -NpmCommand '${quotedNpmPath}' -RetryDelayMilliseconds 1`
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    windowsHide: true
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal((await fs.readFile(counterPath, "ascii")).trim(), "3");
});

test("Windows 配置向导复用 active Profile、工作目录和配对状态", { skip: process.platform !== "win32" }, async () => {
  const setupScript = await fs.readFile(path.resolve("setup.ps1"), "utf8");

  assert.match(setupScript, /Get-ActiveLarkProfile/);
  assert.match(setupScript, /已自动选择 active 飞书 Profile/);
  assert.match(setupScript, /已复用现有 Codex 工作目录/);
  assert.match(setupScript, /Test-BridgeHasPairedUser/);
  assert.match(setupScript, /可以直接发送 tasks/);
});

test("Windows 配置向导等待服务 ready 后才生成配对码", { skip: process.platform !== "win32" }, async () => {
  const setupScript = await fs.readFile(path.resolve("setup.ps1"), "utf8");
  const doctorIndex = setupScript.indexOf("& node scripts/doctor.mjs");
  const startIndex = setupScript.indexOf("Restart-BridgeAfterSetup", doctorIndex);
  const pairingIndex = setupScript.indexOf("& node scripts/pairing.mjs", startIndex);

  assert.ok(doctorIndex >= 0);
  assert.ok(startIndex > doctorIndex);
  assert.ok(pairingIndex > startIndex);
  assert.match(setupScript, /服务已启动并就绪。现在可以向机器人发送上方配对命令/);
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

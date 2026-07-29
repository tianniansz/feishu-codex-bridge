import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getCliPaths } from "../src/cliPaths.js";

test("CLI 使用独立的 Windows 用户数据目录", () => {
  const paths = getCliPaths({ LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" }, "win32");
  assert.equal(paths.dataDir, path.resolve("C:\\Users\\tester\\AppData\\Local", "FeishuCodexBridge"));
  assert.equal(paths.configFile, path.join(paths.dataDir, "config.env"));
  assert.equal(paths.runtimeDir, path.join(paths.dataDir, "runtime"));
});

test("CLI 允许用 FEISHU_CODEX_HOME 覆盖用户数据目录", () => {
  const customHome = path.join(os.tmpdir(), "feishu-codex-custom-home");
  const paths = getCliPaths({ FEISHU_CODEX_HOME: customHome }, process.platform);
  assert.equal(paths.dataDir, path.resolve(customHome));
});

test("CLI help 和 version 无需配置即可运行", () => {
  const cliPath = path.resolve("bin", "cli.js");
  const help = spawnSync(process.execPath, [cliPath, "help"], { encoding: "utf8" });
  const version = spawnSync(process.execPath, [cliPath, "version"], { encoding: "utf8" });

  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /用法：feishu-codex-bridge <命令>/);
  assert.match(help.stdout, /^  setup\s+/m);
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /^0\.2\.0-beta\.4\s*$/);
});

test("CLI config 在未配置时给出用户目录且返回非零状态", () => {
  const cliPath = path.resolve("bin", "cli.js");
  const home = path.join(os.tmpdir(), `feishu-codex-missing-${process.pid}-${Date.now()}`);
  const result = spawnSync(process.execPath, [cliPath, "--home", home, "config"], { encoding: "utf8" });

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /config\.env/);
  assert.match(result.stdout, /runtime/);
});

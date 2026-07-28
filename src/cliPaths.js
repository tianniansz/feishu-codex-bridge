import os from "node:os";
import path from "node:path";

export function getCliPaths(env = process.env, platform = process.platform) {
  const baseDir = env.FEISHU_CODEX_HOME || defaultDataDir(env, platform);
  const dataDir = path.resolve(baseDir);
  return {
    dataDir,
    configFile: path.join(dataDir, "config.env"),
    runtimeDir: path.join(dataDir, "runtime")
  };
}

function defaultDataDir(env, platform) {
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA || env.APPDATA;
    if (localAppData) return path.join(localAppData, "FeishuCodexBridge");
  }
  return path.join(os.homedir(), ".feishu-codex-bridge");
}

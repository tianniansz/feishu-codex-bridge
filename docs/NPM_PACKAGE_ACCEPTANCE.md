# npm 包本地验收

## 目标

在公开发布 npm 包前，验证打包内容、全局命令、用户数据隔离和卸载行为。测试不会发布到 npm Registry。

## 生成安装包

```powershell
npm.cmd pack
```

命令会生成类似 `feishu-codex-bridge-0.2.0-beta.1.tgz` 的文件。

## 全局安装

```powershell
npm.cmd install -g .\feishu-codex-bridge-0.2.0-beta.1.tgz
feishu-codex-bridge version
feishu-codex-bridge help
feishu-codex-bridge setup
```

配置完成后验证：

```powershell
feishu-codex-bridge doctor
feishu-codex-bridge start
feishu-codex-bridge status
feishu-codex-bridge logs
feishu-codex-bridge stop
```

配置应位于 `%LOCALAPPDATA%\FeishuCodexBridge`，而不是 npm 全局包目录。

## 自动启动

```powershell
feishu-codex-bridge service install
feishu-codex-bridge service status
feishu-codex-bridge service uninstall
```

计划任务应属于当前登录并已完成 Codex 登录的 Windows 用户，不应使用 `SYSTEM`。

## 卸载

```powershell
feishu-codex-bridge stop
npm.cmd uninstall -g feishu-codex-bridge
```

卸载 npm 包后，用户数据目录默认保留，避免误删配对和配置；如需清理，应由用户单独确认后手动删除。

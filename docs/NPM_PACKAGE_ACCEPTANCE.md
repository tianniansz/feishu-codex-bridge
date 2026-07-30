# npm 包本地验收

## 目标

在公开发布 npm 包前，验证打包内容、全局命令、用户数据隔离和卸载行为。测试不会发布到 npm Registry。

## 生成安装包

```powershell
npm.cmd pack
```

命令会生成类似 `feishu-codex-bridge-0.2.0.tgz` 的文件。

## 全局安装

```powershell
npm.cmd install -g .\feishu-codex-bridge-0.2.0.tgz
feishu-codex-bridge version
feishu-codex-bridge help
feishu-codex-bridge setup
```

配置完成后验证：

```powershell
feishu-codex-bridge doctor
feishu-codex-bridge doctor --tasks
feishu-codex-bridge start
feishu-codex-bridge status
feishu-codex-bridge logs
feishu-codex-bridge stop
```

配置应位于 `%LOCALAPPDATA%\FeishuCodexBridge`，而不是 npm 全局包目录。

飞书侧还需确认：

- `tasks` 标题为“本机 Codex Task”。
- `tasks` 在一个 App Server 中批量读取当前页，并以最多 4 路并行执行约 800ms 采样；不探测其他页。
- 完成记录稳定时显示 `Waiting User`；`inProgress` 或文件变化时显示 `Running（Desktop/CLI）` 并阻止续聊。
- `Interrupted` 最近 5 分钟有活动时显示 `需确认（Desktop/CLI）` 并阻止续聊；稳定且超过宽限期后显示 `Waiting User`。
- 飞书发起执行后显示 `Running（Bridge）`，重复消息会被拒绝。
- `Interrupted`、`Completed`、`In Progress` 只出现在“最后记录”，不冒充当前状态。
- 长任务进度通知使用的 `--idempotency-key` 不超过 50 字符；即使通知发送失败，服务也保持 ready。

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

## 发布前包内容审计

```powershell
npm.cmd pack --dry-run --json
```

确认清单不包含 `.env`、`config.env`、`.runtime`、日志、访问令牌、配对数据、测试临时文件或本机绝对路径配置。

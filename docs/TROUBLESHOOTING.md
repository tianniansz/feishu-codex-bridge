# 故障排查

首先运行：

```powershell
feishu-codex-bridge doctor
```

## 找不到 Node.js

从源码首次安装时重新运行引导入口：

```powershell
.\setup.ps1
```

向导会优先使用 `winget` 安装 Node.js LTS。没有 `winget` 时，按提示从 [Node.js 官网](https://nodejs.org/en/download) 安装；完成后可回到原窗口继续检测。CLI 已安装后使用 `feishu-codex-bridge setup` 重新配置。

## 找不到 Codex CLI

```powershell
npm install -g @openai/codex
codex login
codex --version
```

## 找不到 lark-cli

```powershell
npm install -g @larksuite/cli@latest
lark-cli --version
```

这里只安装 CLI，不运行 `lark-cli auth login`。Bridge 使用机器人身份，不需要用户 OAuth；不要为此项目授予邮件、云盘或 `im:message.send_as_user` 权限。

安装方式变化时，以[飞书官方 CLI 仓库](https://github.com/larksuite/cli)为准。

## 飞书 Profile 不可用

重新运行配置向导，或创建新的 Profile：

```powershell
lark-cli config init --new --name codex-bridge --lang zh_cn
lark-cli --profile codex-bridge whoami
```

Bridge 使用 bot 身份接收和回复消息，请确认以下命令返回 `available: true`：

```powershell
lark-cli --profile codex-bridge whoami --as bot
```

## 机器人收不到消息

检查：

- 飞书应用已开启机器人能力
- 应用已经发布
- 消息事件和权限已经配置
- `lark-cli event consume im.message.receive_v1 --as bot` 可以收到事件
- `feishu-codex-bridge config` 指向的配置中 `LARK_CLI_PROFILE` 正确

## `tasks` 返回空列表

先运行：

```powershell
feishu-codex-bridge doctor --tasks
```

- Codex Desktop 或 Codex CLI 中需要存在已保存 Task
- Task 工作目录必须位于 `ALLOWED_WORKSPACE_ROOTS` 内
- Codex 托管 worktree 只有在其 Git 原始仓库位于允许目录内时才会显示
- 已归档 Task 默认不会出现在飞书 `tasks` 中
- Windows 路径必须真实存在
- 修改配置后需要运行 `feishu-codex-bridge restart`

## Desktop 显示执行中，但飞书状态不同

进入对应 Task 后发送：

```text
status
```

`tasks` 列表只包含线程摘要；`open` 和 `status` 会读取最新完整快照。其他 Codex 入口发起的任务不会自动向飞书推送进展，需要主动刷新。`Unknown` 表示当前 App Server 无法确认实时状态，不等同于等待用户输入。

本机可查看原始状态：

```powershell
feishu-codex-bridge doctor --tasks
```

## 升级时出现 npm `EBUSY`

安装向导会在停止旧服务后等待文件句柄释放，并最多自动尝试三次。三次仍失败时，先检查是否仍有 Bridge 进程：

```powershell
Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq "node.exe" -and
    $_.CommandLine -match "feishu-codex-bridge"
  } |
  Select-Object ProcessId, ParentProcessId, CommandLine
```

不要使用 `Stop-Process -Name node -Force`，它可能终止电脑上的其他 Node.js 服务。

## 配对码失效

```powershell
feishu-codex-bridge pairing
```

如果需要撤销旧用户：

```powershell
feishu-codex-bridge pairing --reset
```

## 服务启动失败

```powershell
feishu-codex-bridge logs
feishu-codex-bridge start --foreground
```

不要将日志原样公开提交；日志可能包含本机环境信息。

启动命令会等待最多 30 秒，只有收到 lark-cli ready marker 才报告成功。停止命令默认等待最多 15 秒完成订阅清理，再进行兜底强制停止。

## Codex 升级后协议不兼容

`codex app-server` 仍属于实验命令。先执行：

```powershell
codex --version
feishu-codex-bridge doctor
npm test
```

提交 Issue 时附上版本和经过脱敏的错误，不要提交 `config.env`、用户数据目录或运行日志。

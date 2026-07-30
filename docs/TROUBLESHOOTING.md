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

## Desktop/CLI 显示执行中，但飞书显示 Unknown

进入对应 Task 后发送：

```text
status
```

飞书状态包括 `Waiting User`、`Running（Bridge）`、`Running（Desktop/CLI）` 和 `需确认（Desktop/CLI）`。`tasks` 在一个 App Server 中批量读取当前页 Task，再以最多 4 路并行执行约 800ms 的 rollout 文件活动采样；`open`、外部状态 `status` 和续聊前只探测选中的单个 Task。`Interrupted`、`Completed` 或 `In Progress` 仍会单独显示为“最后记录”。

`inProgress` 或采样期间文件变化会显示 `Running（Desktop/CLI）`；完成/失败记录稳定时显示 `Waiting User`；稳定的 `Interrupted` 最近 5 分钟仍有活动时显示 `需确认（Desktop/CLI）`，超过宽限期后显示 `Waiting User`。运行中和需确认状态均阻止续聊。路径不可用或证据矛盾时保持需确认。本机验证确认两个 App Server 可以同时接受同一 Task 的 `turn/start`，所以无法提供强互斥保证。SSH 连接到本机后执行 Codex 也属于同一本机入口，不是远程 Task。

本机可查看原始状态：

```powershell
feishu-codex-bridge doctor --tasks
```

## 日志提示 idempotency-key 超过 50 字符

如果日志包含：

```text
--idempotency-key exceeds the maximum of 50 characters
```

说明安装包仍是修复前的 RC6。修复后的包会把超长完整键稳定压缩为 50 字符，且后台通知失败不会再终止 Bridge。重新安装修复包后执行：

```powershell
feishu-codex-bridge restart
feishu-codex-bridge status
```

预期服务保持“运行中（飞书事件监听已就绪）”。

## 升级时出现 npm `EBUSY`

`0.2.1` 及更早版本使用 npm 原地替换全局包，旧目录被终端、资源管理器或安全软件占用时可能出现 `EBUSY`。不要继续重复执行 `npm install -g`；从仓库运行一次新版 `setup.ps1`，迁移到版本目录与稳定启动器：

```powershell
cd "D:\Documents\开源项目\feishu-codex-bridge"
Set-ExecutionPolicy -Scope Process Bypass
.\setup.ps1
```

迁移后统一使用 `feishu-codex-bridge upgrade`。新版本安装到独立目录，旧 npm 包即使仍被占用，也只会记录为延迟清理，不影响新版本启用。不要使用 `Stop-Process -Name node -Force`，它可能终止电脑上的其他 Node.js 服务。

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

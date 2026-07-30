# 安装指南

## 1. 环境要求

- Windows 10 或 Windows 11
- Node.js 20 或更高版本（未安装时由向导引导安装）
- Codex Desktop 或 Codex CLI（CLI 缺失或未登录时由向导引导处理）
- 飞书账号，以及创建企业自建应用的权限

配置向导会检查 Node.js。未安装或版本过低时，会优先询问是否通过 `winget` 安装 Node.js LTS；系统没有 `winget` 时会提供并可打开官方下载页面。向导也可以安装 Codex CLI 和飞书官方 `lark-cli`。

## 2. 下载项目

```powershell
git clone https://github.com/tianniansz/feishu-codex-bridge.git
cd feishu-codex-bridge
```

首次运行可临时允许当前 PowerShell 窗口执行脚本：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

## 3. 运行配置向导

```powershell
.\setup.ps1
```

源码入口默认执行 `npm pack`，把当前版本安装为全局 `feishu-codex-bridge` 命令，然后自动继续统一配置向导。npm 公共包发布后，已安装 Node.js 的用户可直接使用 `npm install -g <包名>`，无需克隆仓库。

向导会依次检查：

1. Node.js 版本。
2. Codex CLI 是否已安装。
3. Codex CLI 是否已登录。
4. 飞书官方 `lark-cli` 是否已安装。
5. `lark-cli` Profile 是否可用。
6. 允许远程操作的项目根目录。

请等待向导自动完成自检、启动服务并确认飞书事件监听 ready。CLI 模式的配置保存在 `%LOCALAPPDATA%\FeishuCodexBridge\config.env`，日志和状态保存在其 `runtime` 子目录。

如果指定的 Profile 不存在，向导会运行：

```powershell
lark-cli config init --new --name codex-bridge --lang zh_cn
```

Bridge 只使用应用机器人身份，不需要运行 `lark-cli auth login`。请在飞书开发者后台为应用配置：

- 开启机器人能力。
- 应用身份权限：`im:message.p2p_msg:readonly`。
- 应用身份权限：`im:message:send_as_bot`。
- 事件订阅：`im.message.receive_v1`。
- 发布应用版本，并确保当前测试用户位于应用可用范围。

不要为 Bridge 选择用户身份权限、邮件业务域、云盘业务域或 `im:message.send_as_user`。如果此前已经完成了用户 OAuth，可在验收结束后运行 `lark-cli auth logout --json` 清除本机用户登录，并在飞书授权管理页面撤销服务端用户授权；这不会删除机器人应用 Profile。

向导会立即用 bot 身份验证 Profile 的 `available` 状态。不可用时不会提前写入 `.env`，避免到最后一步才失败。

按照终端给出的飞书页面完成以下操作：

- 创建企业自建应用
- 开启机器人能力
- 授予消息收发和事件订阅所需权限
- 发布应用

`lark-cli` 的最新安装与配置方式以[官方仓库](https://github.com/larksuite/cli)为准。

## 4. 自检

向导会自动运行，也可以手动执行：

```powershell
feishu-codex-bridge doctor
```

如果桌面端看到的 Task 数量与飞书不一致，运行本机诊断：

```powershell
feishu-codex-bridge doctor --tasks
```

该命令会在本机显示允许目录、Codex worktree、归档及被白名单排除的原因，不会把诊断内容发送到飞书。

预期结果：

```text
✅ Node.js >= 20
✅ 配置文件
✅ Codex CLI
✅ Codex App Server
✅ lark-cli
✅ 飞书 Profile
✅ 工作目录
⚠️ 飞书配对：待配对
```

## 5. 启动并配对

向导会自动启动服务，等待飞书事件监听就绪后才显示六位配对码。可以先确认状态：

```powershell
feishu-codex-bridge status
```

向自己的飞书机器人发送：

```text
pair 123456
```

收到“配对成功”后发送：

```text
tasks
```

自动启动会等待飞书事件监听真正就绪，最长等待 30 秒：

```text
服务已启动并就绪
```

需要随当前 Windows 用户登录后自动运行时：

```powershell
feishu-codex-bridge service install
```

计划任务必须运行在登录 Codex 的同一 Windows 用户下，不能改为 `SYSTEM`。

## 6. 验收

1. Codex Desktop 或 Codex CLI 中至少存在一个位于允许目录内的 Task。
2. 飞书发送 `tasks` 能看到“本机 Codex Task”，且状态为 `Waiting User`、`Running（Bridge）` 或 `Unknown（Desktop/CLI）`。
3. 发送 `open 1` 能进入该 Task，并将当前状态与最后记录分开显示。
4. 发送普通文本后能收到 Codex 最终回复。
5. 从飞书发起续聊后，执行期间发送 `status` 能看到 `Running（Bridge）` 和 Bridge 管理的当前阶段。
6. 本机 Codex 要求批准时，飞书能用 `approve <审批码>` 或 `reject <审批码>` 完成单次处理。
7. 从旧版本重新运行 `setup.ps1` 时，全局 CLI 能停止旧服务并完成升级；Windows 文件锁会自动退避重试，最多三次。

若失败，请查看[故障排查](TROUBLESHOOTING.md)。准备邀请他人体验前，再完成[发布前体验验收](EXPERIENCE_CHECKLIST.md)。

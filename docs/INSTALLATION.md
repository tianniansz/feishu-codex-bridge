# 安装指南

## 1. 环境要求

- Windows 10 或 Windows 11
- Node.js 20 或更高版本
- 可以正常使用的 Codex Desktop 或 Codex CLI
- 飞书账号，以及创建企业自建应用的权限

配置向导可以安装 Codex CLI 和飞书官方 `lark-cli`，但不会自动安装 Node.js。

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

向导会依次检查：

1. Node.js 版本。
2. Codex CLI 是否已安装。
3. 飞书官方 `lark-cli` 是否已安装。
4. `lark-cli` Profile 是否可用。
5. 允许远程操作的项目根目录。

如果指定的 Profile 不存在，向导会运行：

```powershell
lark-cli config init --new --name codex-bridge --lang zh_cn
```

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
npm run doctor
```

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

向导最后会显示六位配对码。启动服务：

```powershell
.\start.ps1
```

向自己的飞书机器人发送：

```text
pair 123456
```

收到“配对成功”后发送：

```text
tasks
```

后台启动会等待飞书事件监听真正就绪，最长等待 30 秒：

```text
服务已启动并就绪
```

## 6. 验收

1. Codex Desktop 中至少存在一个位于允许目录内的 Task。
2. 飞书发送 `tasks` 能看到该 Task。
3. 发送 `open 1` 能进入该 Task。
4. 发送普通文本后能收到 Codex 最终回复。
5. 执行期间发送 `status` 能看到当前阶段。
6. 本机 Codex 要求批准时，飞书能用 `approve <审批码>` 或 `reject <审批码>` 完成单次处理。

若失败，请查看[故障排查](TROUBLESHOOTING.md)。准备邀请他人体验前，再完成[发布前体验验收](EXPERIENCE_CHECKLIST.md)。

# 故障排查

首先运行：

```powershell
npm run doctor
```

## 找不到 Codex CLI

```powershell
npm install -g @openai/codex
codex login
codex --version
```

## 找不到 lark-cli

```powershell
npx @larksuite/cli@latest install
lark-cli --version
```

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
- `.env` 中的 `LARK_CLI_PROFILE` 正确

## `tasks` 返回空列表

- Codex Desktop 中需要存在已保存 Task
- Task 工作目录必须位于 `ALLOWED_WORKSPACE_ROOTS` 内
- Windows 路径必须真实存在
- 修改 `.env` 后需要重启 Bridge

## 配对码失效

```powershell
npm run pairing
```

如果需要撤销旧用户：

```powershell
npm run pairing:reset
```

## 服务启动失败

```powershell
Get-Content .runtime\bridge.error.log -Tail 100
.\start.ps1 -Foreground
```

不要将日志原样公开提交；日志可能包含本机环境信息。

`start.ps1` 会等待最多 30 秒，只有收到 lark-cli ready marker 才报告成功。若超时，进程会自动停止。`stop.ps1` 默认等待最多 15 秒完成订阅清理，再进行兜底强制停止。

## Codex 升级后协议不兼容

`codex app-server` 仍属于实验命令。先执行：

```powershell
codex --version
npm run doctor
npm test
```

提交 Issue 时附上版本和经过脱敏的错误，不要提交 `.env` 或 `.runtime`。

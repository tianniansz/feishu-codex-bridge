# 配置说明

配置保存在项目根目录的 `.env`，该文件默认被 Git 忽略。

## 必填配置

```env
LARK_CLI_PROFILE=codex-bridge
ALLOWED_WORKSPACE_ROOTS=D:\Projects
```

多个允许目录使用英文分号分隔：

```env
ALLOWED_WORKSPACE_ROOTS=D:\Work;D:\OpenSource
```

## 安全配置

| 配置 | 默认值 | 说明 |
|---|---:|---|
| `ALLOW_CREATE_TASK` | `false` | 是否允许从飞书新建 Codex Task |
| `ALLOW_GROUP_CHATS` | `false` | 是否允许在群聊中操作 |
| `PAIRING_TTL_MINUTES` | `10` | 一次性配对码有效分钟数 |

## 高级配置

| 配置 | 默认值 | 说明 |
|---|---:|---|
| `CODEX_BIN` | `codex` | Codex CLI 命令 |
| `LARK_CLI_BIN` | `lark-cli.cmd` | Windows 下的 lark-cli 命令 |
| `CODEX_APP_SERVER_TIMEOUT_MS` | `3600000` | 单轮最长等待时间 |
| `TASK_LIMIT` | `50` | 最多读取的 Task 数量 |
| `RUNNING_NOTICE_DELAY_MS` | `180000` | 长时间运行提示延迟 |
| `RUNTIME_DIR` | `.runtime` | 本地状态和日志目录 |

修改配置后需要重启服务：

```powershell
.\stop.ps1
.\start.ps1
```

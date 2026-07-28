# 首次安装验收报告（2026-07-29）

## 结论

**有条件不通过。** 项目源码、依赖安装、配置生成和自动化测试正常，但当前版本存在一个会阻断部分 Windows 用户后台启动的兼容性问题；同时，本次验收机器没有可用的 lark-cli Profile，因此真实飞书消息收发尚未完成。

## 验收环境

| 项目 | 结果 |
|---|---|
| 操作系统 | Windows 10/11 环境 |
| Node.js | `v24.18.0` |
| npm | `11.16.0` |
| Codex CLI | `0.144.3` |
| lark-cli | `1.0.74`（检测到 `1.0.77` 可更新） |
| 源码提交 | `d8ec2fe` |
| 干净副本 | 不含 `.env`、`.runtime`、`.git` |

## 已通过

- `npm ci --ignore-scripts` 成功，审计结果为 0 个已知漏洞。
- `npm run check` 通过，共检查 21 个 JavaScript 文件。
- `npm test` 通过，共 12 项测试。
- `setup.ps1` 能检查 Node.js、Codex CLI、Codex App Server、lark-cli 和工作目录。
- 向导能生成包含安全默认值的 `.env`：默认禁用群聊和飞书新建 Task。
- Profile 不可用时，`doctor` 能返回非零退出码并阻止生成配对码。
- 前台启动能输出结构化日志，lark-cli 认证失败后 Bridge 会退出。

## 阻塞问题

### P0：后台启动受 `Path` / `PATH` 重复环境变量影响

**现象：** `start.ps1` 调用 `Start-Process` 时失败：

```text
Item has already been added. Key in dictionary: 'Path' Key being added: 'PATH'
```

**影响：** 在同时包含 `Path` 和 `PATH` 的 Windows 进程环境中，README 推荐的后台启动方式完全不可用。

**已验证的修复方向：** 在当前 PowerShell 进程中合并并规范化 Path 键后，`Start-Process` 可正常启动 Node.js。修复必须只影响 Bridge 启动进程，不能修改用户级或系统级环境变量。

### P0（外部配置）：没有可用的 lark-cli Profile

本机存在两个 Profile，但 `whoami` 均返回：

```text
available: false
tokenStatus: not_configured
```

因此无法继续验证机器人事件接收、配对、Task 列表、续聊、状态和审批的真实链路。需要先完成一个飞书企业自建应用的配置和发布。

## 高优先级体验问题

### P1：安装向导过晚识别不可用 Profile

`setup.ps1` 只检查 `lark-cli ... whoami` 的退出码。该命令在 `available:false` 时仍可能退出 0，导致向导先询问工作目录并写入 `.env`，最后才由 `doctor` 报错。

建议在选择 Profile 后立即解析 `whoami` JSON，同时检查：

- 命令退出码为 0；
- `ok` 不为 `false`；
- `available` 不为 `false`。

失败时直接给出“修复现有 Profile”或“创建新 Profile”的明确选择。

### P1：后台启动只等待固定 1 秒

当前 `start.ps1` 只确认 Node.js 进程在 1 秒后仍存在，没有等待 lark-cli 的：

```text
[event] ready event_key=im.message.receive_v1
```

网络较慢时可能显示“服务已启动”，但机器人尚未就绪或随后立即退出。建议让 Bridge 写入 ready 状态文件，启动脚本等待该状态或明确超时。

## 建议修复顺序

1. 修复 `start.ps1` 的重复 Path 兼容性。
2. 将 lark-cli Profile 有效性检查前移到安装向导。
3. 增加基于 ready marker 的后台启动确认和优雅停止。
4. 配置并发布可用的飞书测试机器人。
5. 重新执行真实消息端到端验收，再邀请外部体验者。

## 尚未验证

- 飞书机器人接收 `pair` 与 `tasks`。
- 搜索、分页、`open` 和普通文本续聊。
- `status` 阶段状态与最终结果推送。
- Codex 命令/文件修改的 `approve`、`reject`。
- 服务重启后的配对和 Task 恢复。

以上项目必须在有效 lark-cli Profile 配置完成后补测，不能仅凭单元测试判定通过。

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

## 修复复验

同日完成 P0/P1 修复后，使用模拟 lark-cli ready/EOF 契约的本地进程复验：

- `Path` / `PATH` 重复环境下后台启动成功；
- `status.ps1` 显示“飞书事件监听已就绪”；
- `stop.ps1` 触发 stdin EOF，监听以 `reason: signal` 退出；
- PID、ready、stop 控制文件全部清理；
- 不可用 Profile 在生成 `.env` 前被拦截；
- 自动化测试从 12 项增加至 15 项并全部通过。

代码级 P0/P1 已解除。真实飞书消息链路仍需有效 bot Profile 才能完成最终补测。

## RC4 远程升级复验

### 结论

**不通过。** 阿里云 Windows 验收机从全局安装的 `0.2.0-rc.3` 升级 `0.2.0-rc.4` 时，旧 Bridge 主进程 PID `7544` 已停止，但 npm 连续三次因 `EBUSY` 无法重命名旧全局包目录。RC4 未安装成功，因此 `open`、`status` 与 `doctor --tasks` 的状态一致性验收未能开始。

### 只读诊断结果

- 失败后三次 npm 日志均指向同一旧包目录和同一 rename 阶段；
- PID `7544`、`bridge.pid`、`bridge.ready`、`bridge.stop` 均已不存在；
- 未发现残留的 Bridge、`src\\index.js`、`lark-cli event consume` 进程；
- 未发现 `FeishuCodexBridge-Administrator` 或相近名称的计划任务；
- 全局安装仍为 `0.2.0-rc.3`，未产生残留的 `.feishu-codex-bridge-*` 目录；
- 系统 `openfiles` 未启用本地对象列表，无法追溯失败发生时的唯一持锁进程。

该问题由 `0.2.0-rc.5` 接续修复并重新验收；RC4 不进入正式版发布流程。

## RC5 远程复验

### 升级结论

**通过。** 阿里云 Windows 验收机按普通用户流程从全局 `0.2.0-rc.3` 升级到 `0.2.0-rc.5`，未再次出现 `EBUSY`。安装向导成功复用现有飞书 Profile、工作目录和配对状态，服务启动并在 30 秒内进入 ready；`doctor --tasks` 成功解释白名单、worktree 和归档过滤。

### 状态一致性结论

**不通过。** 实际正在其他 Codex 入口执行的 Task，在 Bridge 的独立 App Server 中显示为 `thread.status = notLoaded`、最后 turn `interrupted`。飞书 `tasks` 全部显示 `Unknown`，`open` / `status` 显示 `Interrupted`。这证明持久化 turn 不能作为另一个 App Server 实时运行状态的可靠依据。

RC6 将实时状态与最后持久化记录分离，停止承诺外部任务实时同步；RC5 不进入正式版发布流程。

## RC6 本机最小并发验证（2026-07-30）

**结论：Codex 不提供跨 App Server 并发保护。** 在 Windows、Codex CLI 0.144.3 上，第一个 App Server 已收到 `turn/started` 后，第二个 App Server 仍成功对同一 Task 执行 `turn/start`，两轮最终都返回完成。第二个入口加载 Task 时将第一轮记录为 `interrupted`，但第一轮实际仍继续执行并返回结果。

因此首版 RC6 不再直接把 `idle`、`notLoaded` 或最后 turn 当作其他入口的实时状态，只确定显示 `Running（Bridge）`，其余证据不足时显示 `Unknown（Desktop/CLI）`；历史 turn 仅作为“最后记录”。测试 Task 已在验证结束后归档。后续活动探测优化与复验见下一节。

## RC6 首轮人工验收与活动探测优化（2026-07-30）

阿里云验收机完成 RC6 人工升级，`tasks`、`open`、`status`、Bridge 执行状态和重复提交保护通过。首轮体验确认普通已有 Task 在 `tasks` 与初次 `open` 时均显示 `Unknown（Desktop/CLI）`，虽然符合保守能力边界，但不够直观。

后续优化改为只探测 `tasks` 当前页：在一个 App Server 中批量读取完整 Task，再以最多 4 路并行对 rollout 文件执行约 800ms 的大小与修改时间采样。`open`、外部状态 `status` 和续聊前只探测选中的 Task。`inProgress` 或文件变化收敛为 `Running（Desktop/CLI）`，稳定的完成/失败记录收敛为 `Waiting User`；稳定的 `Interrupted` 最近 5 分钟有活动时显示 `需确认（Desktop/CLI）` 并阻止续聊，超过宽限期后显示 `Waiting User`。结果缓存 3 秒并合并同一 Task 的并发请求。该优化仍需用新包在阿里云验收机复验。

本地相关测试覆盖当前页范围、4 路并发上限、批量 `thread/read`、近期/过期 `Interrupted` 和续聊阻止逻辑，core + codex 33/33 通过。

## RC6 长任务通知修复（2026-07-30）

阿里云验收发现长任务进度通知生成的幂等键长度为 60，超过 lark-cli 的 50 字符限制；发送 Promise 的异常未隔离，Node.js 服务随之退出。修复后，超长完整分段键固定转换为 50 字符的 `fcb-` 加 SHA-256 摘要，不同通知和分段保持唯一；进度、运行中、完成及错误通知失败只记录日志，不再使 Job Promise 拒绝或终止 Bridge。

本地相关测试结果：lark client 5/5、core 26/26。该修复仍需用重新生成的 RC6 包在阿里云验收机复验长任务进度和服务 ready 状态。

## RC6 最终验收结论（2026-07-30）

**通过。** 阿里云 Windows 验收机完成最终 RC6 升级与人工验证。安装向导、服务 ready、`tasks/open/status/doctor --tasks`、当前页活动探测、`Interrupted` 五分钟宽限规则、Bridge/Desktop/CLI 状态区分、并发续聊保护和长任务进度通知符合正式版发布要求。用户明确确认进入首个正式版本发布流程。

正式版版本号更新为 `0.2.0` 后，本地完整测试 58/58、语法检查 28 个文件、npm 包内容审计 43 个文件通过。

npm 上无作用域的 `feishu-codex-bridge` 已属于其他维护者；正式包改用用户自有 scope：`@tianniansz/feishu-codex-bridge`。全局 CLI 命令仍为 `feishu-codex-bridge`。

## 0.2.0 正式发布（2026-07-30）

`@tianniansz/feishu-codex-bridge@0.2.0` 已发布到 npm，`latest` 指向 `0.2.0`，公开下载运行返回 `0.2.0`。GitHub 仓库已设为 Public，并创建非草稿、非预发布的 [`v0.2.0` Release](https://github.com/tianniansz/feishu-codex-bridge/releases/tag/v0.2.0)。Release 附件 `tianniansz-feishu-codex-bridge-0.2.0.tgz` 大小为 58,168 字节，SHA-256 为 `D5A03D7295E88EF5F327CFB60B56ED71D23F2B45F4D6E427FC5E9EC5F6B003CA`。

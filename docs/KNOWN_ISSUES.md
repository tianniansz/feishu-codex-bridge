# 已知问题

## P1-20260730-07：单次 `tasks` 偶发返回两条回复

- 状态：已修复并发布，待正式包 UAT 复验
- 发现版本：`0.2.0`
- 修复版本：`0.2.1`（已发布）
- 环境：Windows、lark-cli 1.0.79、飞书私聊

### 原因与修复

同一条可见的飞书用户消息被事件流以不同的 `event_id` 和 `message_id` 再次交付，原实现仅优先使用 `event_id`，因此两次事件都通过去重并分别回复。修复后同时记录事件 ID、消息 ID，以及由会话、发送者、原始创建时间和文本生成的 SHA-256 消息指纹；任一标识重复即拒绝再次处理。

### 验收标准

- 单次发送 `tasks` 只返回一条任务列表。
- 同一原始消息即使以不同 `event_id` / `message_id` 重投，也只处理一次。
- 用户在不同时间主动再次发送 `tasks` 仍可正常刷新列表。

## P0-20260730-06：长任务进度幂等键超过 50 字符导致服务退出

- 状态：已修复并通过 RC6 验收机复验
- 发现版本：`0.2.0-rc.6`
- 修复版本：`0.2.0-rc.6`
- 环境：Windows、lark-cli 1.0.79、较长飞书消息 ID、长任务进度通知

### 原因与修复

Bridge 原先直接拼接 `<messageId>:progress:<timestamp>:<chunk>` 作为幂等键，实际长度达到 60，而 lark-cli 要求 `--idempotency-key` 最多 50 字符。进度通知 Promise 未完全隔离，参数校验失败后异常上抛并终止 Node.js 服务。

RC6 对超过限制的完整分段键使用稳定的 `fcb-` 加 SHA-256 摘要，总长度固定为 50；不同通知和分段仍保持唯一。进度、长时间运行、完成和错误通知均捕获发送失败，只记录 `job.background_failed`，不影响 Job 清理和 Bridge 事件监听。

## P0-20260729-05：同机独立 App Server 无法互认 Task 实时状态

- 状态：已完成最小并发验证、按能力边界修正展示并通过 RC6 验收机复验
- 发现版本：`0.2.0-rc.5`
- 修复版本：`0.2.0-rc.6`
- 环境：同一主机、同一用户、同一 `CODEX_HOME`，Desktop/CLI 与 Bridge 使用不同 App Server 操作同一 Task

### 原因与修复

RC4 假设其他入口执行时，持久化的最新 turn 会保持 `inProgress`。阿里云验收发现，实际运行任务在发起方 App Server 中处于执行状态时，Bridge 的独立 App Server 仍可能读取到 `thread.status = notLoaded` 和最后 turn `interrupted`。App Server 的 `active` 及状态事件属于加载该线程的进程，不能通过另一个独立进程可靠推断。参见 [Codex App Server 文档](https://learn.chatgpt.com/docs/app-server.md)。

2026-07-30 在 Windows、Codex CLI 0.144.3 上完成最小验证：第一个 App Server 的 turn 已启动时，第二个 App Server 对同一 Task 的 `turn/start` 仍被接受并完成；第二个入口读取到第一轮为 `interrupted`，但第一轮随后也正常返回结果。Codex 没有提供可供 Bridge 使用的跨 App Server 互斥或可靠冲突响应。

RC6 保留“最后记录”并增加最佳努力活动探测：`tasks` 在一个 App Server 中批量读取当前页 Task，再以最多 4 路并行采样 rollout；`open`、外部状态 `status` 和续聊前只探测选中的 Task。`inProgress` 或文件变化显示 `Running（Desktop/CLI）`，稳定的完成/失败记录显示 `Waiting User`；稳定的 `Interrupted` 最近 5 分钟仍有活动时显示 `需确认（Desktop/CLI）`，超过宽限期后显示 `Waiting User`。运行中和需确认状态均阻止续聊。采样缓存 3 秒且有 100 项上限。共享 App Server 或跨入口互斥协议仍作为后续研究，不作为当前正式版承诺。

## P0-20260729-03：外部运行中的 Task 被误显示为 `Waiting User`

- 状态：修复不完整，已由 P0-20260729-05 接续
- 发现版本：`0.2.0-rc.3`
- 修复版本：`0.2.0-rc.4`
- 环境：本机 Codex Task 由 Desktop/CLI 执行，飞书端随后查看同一 Task；操作入口可以来自本机或 SSH

### 原因与修复

`thread.status = notLoaded` 只表示当前 App Server 实例未加载该线程，不能据此判断任务正在等待用户。RC4 消除了 `Waiting User` 误报，但将持久化 `inProgress` 推断为实时 `Running（外部发起）` 的方案未通过远程验收，后续由 RC6 按 P0-20260729-05 修正。

## P0-20260729-04：停止旧服务后 npm 全局升级仍持续 `EBUSY`

- 状态：已修复并通过 RC5 远程升级复验
- 发现版本：`0.2.0-rc.4`
- 修复版本：`0.2.0-rc.5`
- 环境：Windows PowerShell 5.1、Node.js 24、npm 11

### 原因与修复

阿里云 Windows 验收机从 RC3 升级 RC4 时，主服务 PID 已停止，但 npm 连续三次无法重命名旧全局包目录。事后只读诊断未发现残留 Bridge 进程，且系统未启用本地句柄跟踪，因此无法唯一确认当时的持锁者。RC4 只等待主进程并做短退避，没有在停止前记录完整子进程树，无法确认并清理可能已经脱离主进程的事件监听子进程。

RC5 在停止前递归记录 Bridge 进程树，优雅停止后等待所有已记录进程退出；仍残留时只终止已确认属于 Bridge 的进程，并增加确定性的句柄释放等待。npm 退避间隔延长；如果 Bridge 进程树已释放后仍然失败，会明确提示检查工作目录位于全局包内的终端、文件管理工具或安全软件，不再笼统归因于 Bridge。

## P0-20260729-02：停止旧服务后 npm 全局升级偶发 `EBUSY`

- 状态：修复不完整，已由 P0-20260729-04 接续
- 发现版本：`0.2.0-beta.6`
- 修复版本：`0.2.0-rc.3`
- 环境：Windows PowerShell 5.1、Node.js 24、npm 11

### 原因与修复

旧升级流程通过待替换的全局 CLI 执行 `stop`，停止动作本身会加载旧包目录。即使进程已经退出，Windows 仍可能继续持有相关句柄。RC.2 开始改用当前源码副本停止现有服务；RC.3 进一步确保停止状态文本不会与数字退出码混合。安装前不再加载旧全局包，同时保留等待和最多三次退避重试作为兜底。

## P1-20260729-01：PowerShell 5.1 显示 `npm pack` 中文输出乱码

- 状态：已修复
- 发现版本：`0.2.0-beta.2`
- 修复版本：`0.2.0-beta.4`
- 环境：Windows PowerShell 5.1、Node.js 24、npm 11

### 现象

源码安装向导执行以下步骤时：

```text
是否安装统一管理命令 feishu-codex-bridge？输入 y 或 n [y]: y
```

`npm pack` 的 `prepack` 中文输出显示为乱码，随后仍能正确显示并生成：

```text
feishu-codex-bridge-0.2.0-beta.2.tgz
```

乱码原文为：

```text
语法检查通过：27 个文件。
```

### 影响

- 仅影响安装过程中的终端显示。
- 不影响语法检查结果、npm 安装包生成或后续全局安装。
- 容易让新用户误以为安装包损坏，因此按 P1 安装体验问题处理。

### 临时处理

看到 `.tgz` 包名且向导继续执行时，无需中断或重新安装。

### 计划修复

- 成功打包时不透传 `npm prepack` 的原始管道输出。
- 由安装向导输出稳定的中文成功提示。
- 打包失败时保留必要诊断，并确保 PowerShell 5.1 按 UTF-8 显示。

### 验收标准

- Windows PowerShell 5.1 中执行 `setup.ps1`，打包阶段无乱码。
- 仍能准确定位并安装当前 `package.json` 版本对应的 `.tgz` 文件。
- `npm pack` 或 `prepack` 失败时，向导返回非零状态并显示可读错误。

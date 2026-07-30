# Changelog

## Unreleased

## 0.2.1 - 2026-07-30

- 修复同一飞书消息被事件流以不同 `event_id` / `message_id` 重投时重复执行并回复的问题；现在同时按事件 ID、消息 ID 和原始消息指纹去重。

## 0.2.0 - 2026-07-30

- 正式 npm 包使用 `@tianniansz/feishu-codex-bridge`，避免与其他维护者的无作用域同名包冲突；全局 CLI 命令保持不变。
- 安装向导明确使用产品名“Feishu Codex Bridge 命令行工具”，不再以“统一管理命令”代指产品。
- Windows 全局升级会在停止前记录 Bridge 子进程树，等待或终止确认属于 Bridge 的残留进程后再替换 npm 包目录。
- Windows npm 升级重试延长释放等待；持续 `EBUSY` 时明确提示终端工作目录或安全软件等外部占用。
- 本机 Codex Task 状态统一为 `Waiting User`、`Running（Bridge）`、`Running（Desktop/CLI）` 和 `需确认（Desktop/CLI）`，不再把 SSH 作为独立任务类型。
- `open` 和 `status` 分离“当前状态”与“最后记录”，不再把其他 App Server 写入的 `idle`、`inProgress`、`Interrupted` 或 `Completed` 推断为全局实时状态。
- 最小并发验证确认 Codex 不会拒绝两个 App Server 同时向同一 Task 发起 `turn/start`；只有 Bridge 自己管理的 Job 显示确定的 `Running（Bridge）`，其他入口状态未知时明确提示并发风险。
- `open`、外部状态 `status` 和续聊前对单个 rollout 文件执行 800ms 轻量活动采样：变化或 `inProgress` 显示 `Running（Desktop/CLI）`，稳定的完成/失败记录显示 `Waiting User`。
- 稳定的 `Interrupted` 在最近 5 分钟有活动时显示 `需确认（Desktop/CLI）`，超过宽限期后显示 `Waiting User`；运行中和需确认状态均阻止并发续聊。
- `tasks` 在一个 App Server 中批量读取当前页 Task，并以最多 4 路并行采样 rollout；采样按 Task 合并并发请求、缓存 3 秒且最多保留 100 项。
- 超过 lark-cli 50 字符限制的幂等键会稳定压缩为 `fcb-` 加 SHA-256 摘要，长任务进度和分段回复不再因参数校验失败。
- 后台进度、长时间运行、完成和错误通知发送失败只记录日志，不再导致 Bridge 服务退出。
- `doctor --tasks` 增加原始 thread/turn 状态和 Bridge 判定输出。
- 修复源码停止脚本的状态文本与退出码混合后被误判为升级失败的问题。
- 源码升级时使用当前源码副本停止现有服务，不再加载即将被 npm 替换的旧全局 CLI 目录。
- 升级全局 CLI 时等待 Windows 文件句柄释放，安装失败后最多退避重试三次。
- 增加 `feishu-codex-bridge doctor --tasks`，在本机解释 Task 白名单、worktree 和归档过滤原因。
- 修复 Codex 托管 worktree 位于允许目录外时被 `tasks` 错误过滤的问题；仅在其 Git 原始仓库位于允许目录内时放行。
- 修复 PowerShell 5.1 将 lark-cli 非致命 stderr 状态输出误判为 `NativeCommandError` 并中断配置的问题。
- 升级全局 CLI 前自动停止旧服务，避免 Windows 文件锁导致 npm `EBUSY`。
- 安装向导复用 active Profile、工作目录与配对状态，并改用纯 npm 安装 lark-cli，避免不必要的用户 OAuth 引导。
- 修复 PowerShell 5.1 显示 npm 打包中文输出乱码的问题。
- 修复 Windows 下多行 Task 回复经过 `lark-cli.cmd` 时可能丢失 `--as bot`、错误回退为用户身份的问题。
- 增加统一的 `feishu-codex-bridge` CLI 和 npm 本地打包安装流程。
- 全局安装模式将配置、状态和日志迁移到 `%LOCALAPPDATA%\FeishuCodexBridge`。
- 支持通过 Windows 计划任务为当前 Codex 用户配置登录后自动启动。
- 配置向导和自检会验证 Codex CLI 登录状态。
- 修复 Windows 向导将 `npm pack` 的中文检查输出误识别为安装包路径的问题。
- 修复 PowerShell 5.1 将 Codex 登录状态的 stderr 输出误判为失败并显示凭证片段的问题。
- 外层安装入口不再吞掉统一 CLI 配置向导的原始输出。
- 修复源码入口通过管道调用 CLI 时无法向 `npx` 传递键盘输入的问题，并取消 lark-cli 的重复安装确认。
- 首次配置会自动重启 Bridge、等待飞书事件监听 ready，再生成配对码。
- 支持 Task 搜索、项目过滤和分页。
- 增加 `status` 执行阶段查询与节流进度通知。
- 支持在原飞书会话中单次批准或拒绝 Codex 命令/文件修改请求。
- 修正 lark-cli 长期事件监听的就绪与优雅退出约定。
- 修复 Windows `Path` / `PATH` 重复时后台启动失败的问题。
- 安装向导会在写入配置前验证 bot Profile 是否真正可用。
- 后台启动等待飞书事件 ready marker，停止时优先通过 stdin EOF 优雅退出。
- 配置向导可通过 `winget` 安装 Node.js LTS，并在手动安装后自动刷新环境变量继续检测。
- 启动脚本在 Node.js 缺失或配置未完成时返回明确的向导提示。
- 增加产品定位、竞品对比和发布前体验验收文档。

本项目遵循 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

### Added

- 飞书远程查看和续聊本机 Codex Task
- Windows 配置向导和后台启停脚本
- 环境自检命令
- 一次性用户配对
- 工作目录白名单
- 开源安装、安全和贡献文档

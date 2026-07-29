# Changelog

## Unreleased

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

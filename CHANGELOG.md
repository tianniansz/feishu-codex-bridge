# Changelog

## Unreleased

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

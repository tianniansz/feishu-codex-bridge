# 发布前体验验收

## 目标

让一位没有参与开发的 Windows 用户，在 15 分钟内完成安装、配对并成功续聊一个已有 Codex Task。

## 干净机器验收

- [ ] Windows 10/11，Node.js 20+，Codex Desktop 或 Codex CLI 已可正常使用。
- [ ] 只阅读 README 即能找到安装入口。
- [ ] `setup.ps1` 能引导安装 Node.js，并转入统一 CLI 配置向导。
- [ ] `feishu-codex-bridge` 能统一完成配置、自检、启停、日志和配对。
- [ ] 首次配置会先自动启动并等待事件监听 ready，再生成和展示配对码。
- [ ] Codex CLI 未登录时，向导能启动登录并在完成后复检。
- [ ] 向导明确指出需要在飞书开放平台完成的步骤和权限。
- [ ] `config.env` 写入用户数据目录，升级 npm 包后仍保留。
- [ ] `feishu-codex-bridge doctor` 给出可执行的错误提示。
- [ ] `feishu-codex-bridge doctor --tasks` 能解释允许目录、worktree、归档和白名单过滤原因。
- [ ] 配对码过期、错误用户、群聊默认拒绝均符合预期。

## 核心路径验收

- [ ] `tasks` 能看到 Codex Desktop 或 CLI 已有 Task，且看不到白名单外目录。
- [ ] 原始仓库在白名单内的 Codex worktree Task 可见，其他仓库的 worktree 不可见。
- [ ] `tasks <关键词>`、`project:<项目>`、`page:<页码>` 可组合使用。
- [ ] `open <编号>` 打开的 Task 与最近一页展示一致。
- [ ] 普通文本能续接 Task，最终回复能回到原飞书会话。
- [ ] `status` 能显示执行阶段和耗时。
- [ ] `tasks` 标题为“本机 Codex Task”，只包含同一用户和 `CODEX_HOME` 中允许访问的 Task。
- [ ] 状态使用 `Waiting User`、`Running（Bridge）`、`Running（Desktop/CLI）`、`Unknown（Desktop/CLI）`，不把 SSH 作为 Task 类型。
- [ ] `open` / `status` 分开显示当前状态和最后记录。
- [ ] `tasks` 不执行逐 Task 活动探测，列表响应时间不随 800ms 采样成倍增加。
- [ ] 最新 turn 为 `inProgress` 或 rollout 采样发生变化时显示 `Running（Desktop/CLI）` 并阻止续聊。
- [ ] 最新 turn 完成且 rollout 稳定时显示 `Waiting User`；`Interrupted` 稳定时保持 `Unknown（Desktop/CLI）`。
- [ ] `Unknown（Desktop/CLI）` 会明确提示先确认本机其他入口没有执行同一 Task，再发送普通文本。
- [ ] 命令或文件修改触发审批时，只有原会话能 `approve` / `reject`。
- [ ] 桥接器重启后，配对关系和当前 Task 仍可恢复。

## 异常路径验收

- [ ] 关闭飞书网络、退出 lark-cli、Codex 未登录时提示可诊断。
- [ ] Codex 执行超时后不会伪报成功，可用 `open` 刷新结果。
- [ ] 重复事件不会重复触发 Codex。
- [ ] 长回复能够分段，阶段通知不会刷屏。
- [ ] 使用较长飞书消息 ID 触发进度和分段回复时，所有幂等键不超过 50 字符且互不冲突。
- [ ] 模拟进度或完成通知发送失败时，Bridge 保持运行并完成 Job 清理。
- [ ] `feishu-codex-bridge stop` 能让长期事件监听优雅退出，不遗留订阅进程。
- [ ] 从上一版本升级时，停止服务后的短暂 npm `EBUSY` 能自动重试并成功安装。
- [ ] `npm.cmd pack --dry-run --json` 清单不包含凭证、用户配置、运行数据或日志。

## 邀请体验者时收集

- 操作系统、Node/Codex/lark-cli 版本；
- 从 clone 到首次成功续聊的耗时；
- 卡住的具体步骤和截图；
- 是否理解白名单、配对和审批的安全含义；
- 最希望减少的一个步骤。

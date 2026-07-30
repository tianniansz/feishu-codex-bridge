# 正式发布清单

## 候选版本

- [x] 版本号为 `0.2.0-rc.6`，工作树无无关改动。
- [x] 相关单元测试、Windows 安装升级测试和语法检查通过。
- [x] `npm.cmd pack --dry-run --json` 不包含凭证、配置、日志或运行数据。
- [x] 从上一 beta 升级到 RC 成功，配置、Profile 和配对关系保留。
- [x] 干净 Windows 用户完成安装、自动启动、配对、`tasks`、`open` 和续聊。
- [x] 普通目录、允许仓库 worktree、白名单外目录和归档 Task 的过滤结果符合预期。
- [x] 验收机确认 `Waiting User`、`Running（Bridge）`、`Running/需确认（Desktop/CLI）` 和“最后记录”的显示符合能力边界。
- [x] `tasks` 只探测当前页、批量读取且最多 4 路并行；`open/status` 单 Task 探测增加不超过约 1 秒，3 秒缓存和并发合并生效。
- [x] `Interrupted` 最近 5 分钟有活动时阻止续聊，稳定且超过宽限期后显示 `Waiting User`。
- [x] 验收机确认其他本机入口执行时不会被误报为 `Waiting User`；用户确认后可从飞书续聊。
- [x] 验收机长任务进度通知未出现超过 50 字符的幂等键，通知失败不会终止 Bridge。

## 正式版本

- [x] 将版本号从 `0.2.0-rc.6` 更新为 `0.2.0`。
- [x] 再次执行包内容审计和相关测试。
- [x] 确认 npm 账号、包名、双因素认证和发布权限。
- [x] 获得仓库公开和 `npm publish` 的明确确认。
- [x] 发布 npm 包并验证全新全局安装。
- [x] 创建带变更摘要和校验信息的 GitHub Release。
- [x] 将仓库设为公开并检查 README、License、Security、贡献指南和 Issue 模板。

正式发布属于外部状态变更。候选版本准备完成不代表自动执行 npm 发布或仓库公开。

# Feishu Codex Bridge

通过自己的飞书机器人，远程查看并续聊自己电脑上已经存在的 Codex Desktop Task。

项目刻意聚焦于一个场景：**离开电脑后，从飞书安全地接着聊现有 Codex Task**。它不是通用 Coding Agent 网关，也不接管 Codex 账号和凭证。

> 当前版本面向 Windows 10/11。项目运行在用户自己的电脑上，不托管 Codex 凭证，也不暴露 Codex App Server 网络端口。

## 功能

- 搜索、按项目过滤并分页查看允许目录内的 Codex Desktop Task
- 选择并继续已有 Task
- 查询执行状态、接收节流后的进度和最终结果
- 在飞书中批准或拒绝 Codex 的命令/文件修改请求
- 可选地从飞书新建 Task
- 一次性配对码绑定飞书用户
- 工作目录白名单
- 长消息自动分段
- 一键配置、自检、后台启停

## 快速开始

准备一台已能正常使用 Codex Desktop 或 Codex CLI 的 Windows 电脑，然后运行：

```powershell
git clone https://github.com/tianniansz/feishu-codex-bridge.git
cd feishu-codex-bridge
Set-ExecutionPolicy -Scope Process Bypass
.\setup.ps1
.\start.ps1
```

配置向导会：

1. 检查 Node.js 版本，并优先通过 `winget` 引导安装 Node.js LTS。
2. 检查并按需安装 Codex CLI 和飞书官方 `lark-cli`。
3. 引导创建或选择自己的飞书机器人。
4. 选择允许远程操作的本地项目目录。
5. 生成仅保存在本机的 `.env`。
6. 执行环境自检并生成一次性配对码。

请等待 `setup.ps1` 显示“配置完成”后再运行 `start.ps1`。如果误在配置完成前启动，脚本会提示返回配置向导。

向机器人发送配对命令后，再发送：

```text
tasks
open 1
继续完成这个任务，并运行相关测试
```

完整步骤见 [安装指南](docs/INSTALLATION.md)。

## 飞书命令

| 命令 | 作用 |
|---|---|
| `pair 123456` | 使用一次性配对码绑定用户 |
| `tasks` | 查看可续聊的 Codex Task |
| `tasks 登录` | 按标题、摘要或项目搜索 Task |
| `tasks project:demo page:2` | 按项目过滤并翻页 |
| `open 2` | 进入指定 Task |
| `open` | 刷新当前 Task 状态 |
| `status` | 查看当前执行阶段和耗时 |
| `approve A1B2C3` | 单次批准当前会话中的 Codex 请求 |
| `reject A1B2C3` | 拒绝当前会话中的 Codex 请求 |
| 普通文本 | 发送给当前 Codex Task |
| `exit` | 退出当前 Task |
| `new` | 新建 Task，默认关闭 |

## 本地管理

```powershell
.\start.ps1              # 后台启动
.\start.ps1 -Foreground  # 前台启动，方便调试
.\status.ps1             # 查看状态
.\stop.ps1               # 停止服务
npm run doctor            # 环境自检
npm run pairing           # 增加一个配对用户
npm run pairing:reset     # 撤销全部用户并重新配对
```

## 安全默认值

- 未配对用户不能查看或操作 Task。
- 默认只允许私聊。
- 默认禁止从飞书新建 Task。
- 只展示 `ALLOWED_WORKSPACE_ROOTS` 内的 Task。
- `.env`、运行状态和日志不会进入 Git。
- App Server 仅通过本机 stdio 启动，不监听网络端口。
- 审批码只对原飞书会话和单次请求有效，不提供远程永久放行。

飞书消息会以本机登录用户的 Codex 权限执行。请只允许可信用户配对，并合理配置 Codex 的沙箱和批准策略。详见 [安全策略](SECURITY.md)。

## 兼容性

- Windows 10/11
- Node.js 20+
- Codex CLI
- [飞书官方 lark-cli](https://github.com/larksuite/cli)

Codex App Server 提供会话历史、`thread/resume` 和流式事件等深度集成能力，但 `codex app-server` 命令目前仍标记为 experimental，升级 Codex CLI 后建议先运行 `npm run doctor`。[Codex App Server 文档](https://learn.chatgpt.com/docs/app-server)

## 文档

- [安装指南](docs/INSTALLATION.md)
- [配置说明](docs/CONFIGURATION.md)
- [使用指南](docs/USAGE.md)
- [架构说明](docs/ARCHITECTURE.md)
- [故障排查](docs/TROUBLESHOOTING.md)
- [产品定位与竞品对比](docs/PRODUCT_POSITIONING.md)
- [发布前体验验收](docs/EXPERIENCE_CHECKLIST.md)
- [首次安装验收报告（2026-07-29）](docs/ACCEPTANCE_REPORT_2026-07-29.md)
- [贡献指南](CONTRIBUTING.md)

## 开发

```powershell
npm run check
npm test
```

## License

[MIT](LICENSE)

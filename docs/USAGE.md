# 使用指南

## 首次配对

在电脑上运行：

```powershell
feishu-codex-bridge pairing
```

将显示的 `pair 123456` 发送给机器人。配对码仅在有限时间内有效。

撤销全部已配对用户：

```powershell
feishu-codex-bridge pairing --reset
```

## 续聊 Task

```text
你：tasks
机器人：返回允许目录内的 Task 列表

你：tasks 登录 project:my-app page:2
机器人：搜索标题、摘要和项目名，并返回指定页

你：open 1
机器人：返回 Task 摘要和最近状态

你：继续修复登录失败的问题，并运行相关测试
机器人：确认已开始，完成后推送结果

你：status
机器人：返回运行时长、当前阶段和待审批状态
```

同一个飞书会话会记住当前打开的 Task。发送 `exit` 只退出当前选择，不会删除或归档 Codex Task。

## 搜索与分页

```text
tasks                         # 第一页
tasks 2                       # 第二页
tasks 登录                    # 搜索关键词
tasks project:my-app          # 按项目名过滤
tasks 登录 project:my-app page:2
```

`open <编号>` 始终对应机器人最近一次展示的那一页，不是全部 Task 的全局编号。

## 执行状态与审批

任务执行期间发送 `status`，可查看当前阶段，例如“正在执行命令”“正在修改文件”或“等待你的批准”。进度通知有最短间隔，避免刷屏；纯文本消息在所有飞书客户端均可用。

当本机 Codex 策略要求批准时，机器人会发送六位审批码和操作摘要：

```text
approve A1B2C3   # 仅批准这一次
reject A1B2C3    # 拒绝这一次
```

审批码只能由收到请求的同一飞书会话使用。项目不会提供“飞书中永久允许此类命令”，如需调整长期策略，应回到电脑上修改 Codex 配置。

## 新建 Task

为了避免误操作，默认关闭。确认需要后，运行 `feishu-codex-bridge config edit` 并配置：

```env
ALLOW_CREATE_TASK=true
```

重启服务后发送 `new`，按提示选择允许目录并输入标题。

## 注意事项

- Codex 正在执行时，同一 Task 不接受第二条普通消息。
- 执行较久时机器人会发送节流后的阶段提示，也可主动发送 `status`。
- 飞书长消息会自动拆分发送。
- Task 的文件和命令权限由本机 Codex 配置决定。

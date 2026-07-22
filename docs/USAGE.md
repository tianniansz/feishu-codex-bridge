# 使用指南

## 首次配对

在电脑上运行：

```powershell
npm run pairing
```

将显示的 `pair 123456` 发送给机器人。配对码仅在有限时间内有效。

撤销全部已配对用户：

```powershell
npm run pairing:reset
```

## 续聊 Task

```text
你：tasks
机器人：返回允许目录内的 Task 列表

你：open 1
机器人：返回 Task 摘要和最近状态

你：继续修复登录失败的问题，并运行相关测试
机器人：确认已开始，完成后推送结果
```

同一个飞书会话会记住当前打开的 Task。发送 `exit` 只退出当前选择，不会删除或归档 Codex Task。

## 新建 Task

为了避免误操作，默认关闭。确认需要后，在 `.env` 中配置：

```env
ALLOW_CREATE_TASK=true
```

重启服务后发送 `new`，按提示选择允许目录并输入标题。

## 注意事项

- Codex 正在执行时，同一 Task 不接受第二条普通消息。
- 执行较久时机器人会发送运行提示。
- 飞书长消息会自动拆分发送。
- Task 的文件和命令权限由本机 Codex 配置决定。

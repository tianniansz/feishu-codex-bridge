# 贡献指南

感谢参与 Feishu Codex Bridge。

## 开发环境

- Node.js 20+
- Windows 10/11
- Codex CLI
- 飞书官方 `lark-cli`

```powershell
git clone https://github.com/tianniansz/feishu-codex-bridge.git
cd feishu-codex-bridge
npm run check
npm test
```

单元测试不应访问真实飞书或执行真实 Codex Task。真实联调应由贡献者在自己的账号和电脑上手动进行。

## 提交要求

- 每个 Pull Request 聚焦一个问题。
- 新功能需要对应测试和文档。
- 不得提交凭证、用户 ID、绝对路径和运行日志。
- 错误信息应给用户明确的解决方法。
- 保持零 npm 运行时依赖，新增依赖需要说明必要性。
- 涉及权限范围、配对或目录过滤的改动必须说明安全影响。

## Commit 建议

建议使用 Conventional Commits：

```text
feat: add pairing reset command
fix: filter tasks outside allowed roots
docs: clarify lark-cli setup
test: cover expired pairing code
```

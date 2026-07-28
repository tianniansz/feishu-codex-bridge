# Security Policy

## 安全模型

Feishu Codex Bridge 会将飞书消息交给本机 Codex 执行。获得授权的飞书用户，实际拥有接近本机 Codex 用户的操作能力。

请遵守以下原则：

- 只给可信用户配对。
- 保持 `ALLOW_GROUP_CHATS=false`。
- 只配置必要的 `ALLOWED_WORKSPACE_ROOTS`。
- 保持 `ALLOW_CREATE_TASK=false`，除非明确需要。
- 使用 Codex 沙箱和批准策略限制文件、命令及网络权限。
- 在飞书中审批前检查操作摘要；审批码只做单次授权，不等于永久放行。
- 不要把 App Server 暴露到公网。
- 不要提交 `config.env`、用户数据目录、日志或 Codex 凭证。

审批消息会对常见的 Token、Secret、Password 和 API Key 参数做基础脱敏，但无法识别所有自定义敏感值。不要让 Codex 把真实密钥直接拼入命令行；优先使用本机安全环境变量或凭证存储。

## 支持版本

安全修复只应用于最新发布版本。项目依赖实验状态的 Codex App Server，升级 Codex CLI 后应重新运行自检和测试。

## 报告漏洞

请不要为可利用漏洞创建公开 Issue。仓库创建后，请通过 GitHub Security Advisories 的“Report a vulnerability”私密报告，并包含：

- 受影响版本
- 复现步骤
- 影响范围
- 建议修复方式（如有）

请勿附带真实 Token、App Secret、用户 ID 或本机敏感路径。

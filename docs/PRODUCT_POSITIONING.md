# 产品定位与竞品对比

## 一句话定位

Feishu Codex Bridge 是面向个人电脑的轻量桥接器：让用户通过自己的飞书机器人，继续自己 Codex Desktop 中已有的 Task。

## 能力边界

项目负责：

- 发现、搜索和打开允许目录内的 Codex Desktop Task；
- 将飞书文本续接到选中的 Task；
- 返回阶段状态、审批请求和最终结果；
- 用配对、私聊默认值、工作区白名单和单次审批降低远程控制风险。

项目不负责：

- 替代 Codex Desktop 或提供独立 Coding Agent；
- 托管 OpenAI/Codex 凭证；
- 暴露公网控制端口；
- 聚合 Claude Code、Gemini CLI 等多种 Agent；
- 在飞书端永久放宽 Codex 的本机权限策略。

## 同类项目

| 项目 | 主要方向 | 与本项目的差异 |
|---|---|---|
| [lark-channel-bridge](https://github.com/zarazhangrui/lark-coding-agent-bridge) | 飞书接入多种 Coding Agent，含流式卡片、多工作区、附件等 | 功能更宽；本项目更聚焦 Codex Desktop 已有 Task 和低依赖安装 |
| [VicLuoV5/lark-codex-bridge](https://github.com/VicLuoV5/lark-codex-bridge) | 飞书远程使用 Codex，支持会话恢复和凭证配置 | 场景高度接近；本项目强调官方 lark-cli、目录白名单和 Desktop Task 映射 |
| [agents-to-im](https://github.com/francize/agents-to-im) | 将多个 Coding Agent 连接到 IM | 通用多 Agent 网关；本项目不做统一代理层 |
| [cc-connect](https://github.com/chenhg5/cc-connect) | 多平台远程控制 Coding Agent | 支持平台更广；本项目优先优化飞书与 Windows 的傻瓜式体验 |
| [OpenAI Codex Remote](https://learn.chatgpt.com/docs/remote-connections) | OpenAI 官方远程连接能力 | 官方产品路径；本项目适合希望使用自有飞书机器人和本地边界控制的用户 |

竞品信息会随版本变化。发布对外宣传前，应重新核对各项目 README，避免使用“首个”“唯一”等无法持续证明的表述。

## 推荐对外描述

> 用自己的飞书机器人，安全续聊本机 Codex Desktop 已有 Task。Windows 优先、低依赖、无公网端口。

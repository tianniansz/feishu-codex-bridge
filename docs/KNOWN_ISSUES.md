# 已知问题

## P1-20260729-01：PowerShell 5.1 显示 `npm pack` 中文输出乱码

- 状态：已修复
- 发现版本：`0.2.0-beta.2`
- 修复版本：`0.2.0-beta.4`
- 环境：Windows PowerShell 5.1、Node.js 24、npm 11

### 现象

源码安装向导执行以下步骤时：

```text
是否安装统一管理命令 feishu-codex-bridge？输入 y 或 n [y]: y
```

`npm pack` 的 `prepack` 中文输出显示为乱码，随后仍能正确显示并生成：

```text
feishu-codex-bridge-0.2.0-beta.2.tgz
```

乱码原文为：

```text
语法检查通过：27 个文件。
```

### 影响

- 仅影响安装过程中的终端显示。
- 不影响语法检查结果、npm 安装包生成或后续全局安装。
- 容易让新用户误以为安装包损坏，因此按 P1 安装体验问题处理。

### 临时处理

看到 `.tgz` 包名且向导继续执行时，无需中断或重新安装。

### 计划修复

- 成功打包时不透传 `npm prepack` 的原始管道输出。
- 由安装向导输出稳定的中文成功提示。
- 打包失败时保留必要诊断，并确保 PowerShell 5.1 按 UTF-8 显示。

### 验收标准

- Windows PowerShell 5.1 中执行 `setup.ps1`，打包阶段无乱码。
- 仍能准确定位并安装当前 `package.json` 版本对应的 `.tgz` 文件。
- `npm pack` 或 `prepack` 失败时，向导返回非零状态并显示可读错误。

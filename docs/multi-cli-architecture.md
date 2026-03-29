# HelloLoop 多 CLI 原生架构

本文定义 `HelloLoop` 同时支持 `Codex CLI`、`Claude Code`、`Gemini CLI` 的正式架构。

## 目标

- 三家 CLI 都能安装
- 三家 CLI 都能原生使用
- 三家 CLI 都按各自 agent 逻辑执行开发
- `.helloloop/` 工作流、状态目录、backlog 结构保持统一
- `Codex CLI` 仍然是首发平台、参考实现和最佳体验路径

## 分层

### 1. 工作流规范层

跨宿主共享：

- 仓库与开发文档自动识别规则
- `.helloloop/` 状态目录结构
- backlog 颗粒度要求
- 执行确认单字段
- 自动执行停止条件
- 验证与风险门控

### 2. Codex 原生层

继续保留当前 `Codex CLI` 的强实现：

- `npx helloloop`
- `npx helloloop <PATH>`
- `.codex-plugin`
- `skills/helloloop`
- Node CLI 安装器与运行器

这是当前最完整、最可验证的实现路径。

### 3. Claude 原生层

通过 Claude 插件与 marketplace 提供：

- Claude plugin manifest
- `/helloloop` 命令
- `helloloop` skill
- 用户级 settings 自动接入

执行开发时使用 Claude Code 自身的原生 agent 与工具。

### 4. Gemini 原生层

通过 Gemini extension 提供：

- `gemini-extension.json`
- `GEMINI.md`
- `/helloloop` 自定义命令

执行开发时使用 Gemini CLI 自身的原生 agent 与工具。

## 安装策略

`helloloop install` 新增多宿主安装能力：

- `--host codex`
- `--host claude`
- `--host gemini`
- `--host all`

默认仍为 `codex`，保证 Codex 路径最稳。

## 当前实施范围

本轮已完成：

- 多宿主安装器
- Claude marketplace/plugin 运行时资产
- Gemini extension 运行时资产
- 多 CLI 中文文档

后续可继续增强：

- 宿主能力矩阵
- Claude / Gemini 专项验证样例仓库
- Codex alpha 能力专项适配

# HelloLoop 多 CLI 原生架构

本文定义 `HelloLoop` 同时支持 `Codex CLI`、`Claude Code`、`Gemini CLI` 的正式架构。

## 目标

- 三家 CLI 都能安装
- 三家 CLI 都能原生使用
- 三家 CLI 都按各自 agent 逻辑执行开发
- `.helloloop/` 工作流、状态目录、backlog 结构保持统一
- `Codex CLI` 仍然是首发平台、参考实现和最佳体验路径

## 关键概念

`HelloLoop` 区分两个角色：

- **宿主**：从哪里进入，例如终端、`Codex`、`Claude`、`Gemini`
- **执行引擎**：真正负责本轮分析 / 开发 / 测试推进的 CLI

这两个概念必须分离：

- 在终端里，不再静默默认 `Codex`
- 在各宿主内部，当前宿主只影响推荐项，不会自动选中对应引擎
- 如果用户在某个宿主里显式要求改用别的引擎，必须先确认
- 如果当前引擎运行中遇到 400、鉴权、余额、429、5xx、网络抖动等问题，必须先做同引擎健康探测；只有探测恢复后才继续主线，不允许自动切换引擎

## 分层

### 1. 工作流规范层

跨宿主共享：

- 仓库与开发文档自动识别规则
- `.helloloop/` 状态目录结构
- backlog 颗粒度要求
- 任务完成复核
- 主线终态复核
- 执行确认单字段
- 自动执行停止条件
- 验证与风险门控

### 2. Node CLI 协调层

统一入口：

- `npx helloloop`
- `npx helloloop <PATH>`
- `npx helloloop codex`
- `npx helloloop claude <PATH>`
- `npx helloloop gemini <PATH> <自然语言要求>`

这一层负责：

- 路径发现
- 需求意图归并
- 执行引擎选择
- 中文确认单输出
- `.helloloop/` 状态持久化

### 3. Codex 原生层

- `.codex-plugin`
- `skills/helloloop`
- `$helloloop`
- `helloloop:helloloop`

这是当前最完整、最可验证的实现路径。

### 4. Claude 原生层

- Claude plugin manifest
- 本地 marketplace 运行时资产
- `/helloloop`
- `helloloop` skill

执行开发时使用 Claude Code 自身的原生 agent 与工具。

### 5. Gemini 原生层

- `gemini-extension.json`
- `GEMINI.md`
- `/helloloop`

执行开发时使用 Gemini CLI 自身的原生 agent 与工具。

## 执行引擎选择策略

默认优先级：

1. 命令首参数显式引擎
2. 自然语言中明确且不歧义地指定了引擎
3. 当前宿主、项目历史、用户历史只作为推荐依据
4. 无论可用引擎数量多少，只要用户未明确指定，都先询问一次

补充规则：

- 首个裸词 `codex` / `claude` / `gemini` 才解释为引擎
- 命令后的自然语言如果明确提到某个引擎，也会作为意图信号
- 如果用户真要把 `claude` 当目录名，应写成 `./claude`、`.\claude` 或绝对路径
- 当前唯一可用引擎也不能被自动选中，只能作为确认单中的推荐项

## 安装策略

`helloloop install` 继续负责宿主安装：

- `--host codex`
- `--host claude`
- `--host gemini`
- `--host all`

默认安装宿主仍为 `codex`，但这不代表执行时会静默固定用 `Codex`。

## 当前实施范围

本轮已完成：

- 多宿主安装器
- 多执行引擎选择层
- 运行中硬阻塞 / 软阻塞的探测式自动恢复与最终告警
- 执行阶段的任务完成复核
- backlog 清空后的主线终态复核与自动复分析
- Claude marketplace / plugin 运行时资产
- Gemini extension 运行时资产
- 多 CLI 中文文档与测试

后续可继续增强：

- 更多引擎专项验证样例仓库
- 宿主能力矩阵可视化
- 更细粒度的项目 / 用户引擎偏好配置入口

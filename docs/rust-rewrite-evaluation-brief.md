# HelloLoop Rust 重写评估输入

本文档用于沉淀当前阶段的核心方案输入，作为后续架构评估、技术选型与重构实施的正式资料之一。

## 背景

`HelloLoop` 的真实目标已经从“多宿主插件 + 状态看板”扩大为：

- 面向 `Codex CLI`、`Claude Code`、`Gemini CLI` 的跨宿主开发编排控制面
- 能够读取自然语言开发需求、开发文档、开发文档目录与现有代码仓库
- 自动分析项目现状、推导最佳开发主线、进行中央调度与合理并行开发
- 严格遵循“分层角色导向的敏捷多代理 SDLC 工作流”
- 最终具备长期运行、自动恢复、可观察、可调度、可扩展的工程级能力

## 当前评估问题

需要围绕以下问题做系统性判断：

1. `Rust` 是否是 `HelloLoop` 的最佳技术栈。
2. 如果是，是否应当对 `HelloLoop` 进行全量重写 / 重构。
3. 如果要重构，最优的项目架构、模块边界、文件结构应该是什么。
4. `HelloLoop` 是否应演进为独立的 `hello CLI`。
5. `hello CLI` 是否应直接具备完整 CLI 能力，同时兼容调用系统已安装的 `Codex CLI`、`Claude Code`、`Gemini CLI`。
6. 是否可以参考或借鉴 `C:\Users\hellowind\Downloads\cc-recovered-main` 的源码实现。
7. 是否应支持托盘菜单、后台守护进程、WebSocket 事件总线，以及飞书 / QQ / 微信等后续连接能力。

## 目标能力

重构后的 `HelloLoop / hello CLI` 目标能力包括但不限于：

- Windows / macOS / Linux 三端运行
- 单机控制面 + 后台守护 + 可视化看板 + TUI
- 多会话并行执行与统一调度
- 面向仓库 / 文档 / 文档目录的流程自动推导
- 严格区分需求澄清、架构规划、实现、测试、评审、验证、发布、维护等角色与阶段
- 支持失败恢复、重试、依赖等待、人工接管与长周期运行
- 具备长期可扩展的插件化 / 宿主适配层能力

## 参考方向

本轮评估明确要求综合考虑以下方向：

- `ALMAS`
- `MetaGPT`
- `LangGraph`
- `SWE-agent`
- `OpenHands`
- `Agentless`
- `MegaAgent`
- `opencode`
- `openai/codex-plugin-cc`
- `cc-recovered-main`

## 评估输出要求

本轮后续产出至少应覆盖：

- 技术栈结论
- 是否全量 Rust 重写的结论
- 推荐的最终架构与仓库结构
- 对 `cc-recovered-main` 的可借鉴性判断
- `hello CLI` 与 `HelloLoop` 的关系设计
- 阶段化迁移路径与风险说明

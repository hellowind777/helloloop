# HelloLoop：Hello App 与 Hello CLI 的阶段性比较记录

> 注意：本文档保留为中途比较记录。当前最终方向以 `docs/app-first-product-strategy.md` 与后续 `Hello App` 蓝图文档为准。

## 结论

本文记录的是一次“是否应立即转向单一 App 路线”的阶段性比较。

当前收敛后的最终判断已经调整为：

- 对外主产品应转向 `Hello App`
- `hello-daemon` 仍然是唯一控制面中枢
- `hello-cli` 保留为薄维护入口，而不再承担主产品角色
- Web 不再作为独立主产品，但仍保留为 App 内视图技术与浏览器 fallback

因此，本文可用于理解取舍过程，但**不再代表当前最终产品决策**。

## 为什么会有这个结论

你提出的担忧非常合理：

- 如果多会话 TUI 很难做到像现代 GUI 一样自然
- 如果最终还是需要复杂的可视化、多任务监督、任务编排、看板、列表、详情、Diff、依赖关系、自动化
- 那么是否直接做一个像 `Codex App` 那样的 GUI，会不会更先进、更合理

我的结论是：**GUI 很重要，但 GUI 不应该替代 CLI。**

## 对 Codex App 的观察

根据 OpenAI 官方在 `2026-02-02` 发布、并于 `2026-03-04` 更新的产品文章：

- `Codex app` 首发是 `macOS`
- `2026-03-04` 更新后支持 `Windows`
- 官方把它定义为“a command center for agents”
- 它强调：
  - 多 agent 并行
  - 线程/项目组织
  - worktree 隔离
  - review diff
  - skills
  - automations
  - 与 CLI / IDE / cloud 共享配置与历史

来源：

- `https://openai.com/index/introducing-the-codex-app/`

这篇官方文章最关键的信息不是“GUI 比 CLI 高级”，而是：

> 当 agent 工作变成多线程、长周期、并行监督问题时，需要一个新的“指挥中心”。

这个结论你完全应该借鉴。

## 但不能机械照搬 Codex App 的原因

### 1. 你的目标平台比 Codex App 更广

截至 OpenAI `2026-03-04` 的官方更新：

- Codex App 已支持 `macOS`
- Codex App 已支持 `Windows`
- 官方文章**没有宣布 Linux 桌面 App**

而你的目标是：

- `Windows`
- `macOS`
- `Linux`

这意味着：

- 如果把 GUI App 作为唯一主入口，Linux 体验很容易掉队
- 如果把 `CLI + daemon + Web` 作为基础，Linux 就不会被边缘化

### 2. 你的产品需要 headless / background / server-like 能力

`HelloLoop` 不只是一个“坐在桌面前盯着点点点”的工具，它还需要：

- 后台守护
- 自动重试
- 长任务持续运行
- 仓库调度
- 文档分析
- 多会话协调
- 后续连接外部消息系统

这些能力的天然核心是：

- `daemon`
- `CLI`
- `API`

而不是 GUI。

### 3. GUI 解决的是“观察与调度体验”，不是“编排内核”

真正难的是：

- 任务图
- 状态机
- 依赖关系
- 恢复语义
- 会话监管
- 宿主 CLI 适配

这些都属于控制面内核问题。  
即使你先做 GUI，如果内核没重构好，GUI 也只是更漂亮地展示混乱。

## 该如何正确理解 “Codex App 路线”

应该学的是它的**产品架构原则**，不是简单复制它的壳：

### Codex App 给你的真正启发

1. **多 surface 共享一套底层引擎**
2. **GUI 是 agent 指挥中心，不只是聊天窗口**
3. **并行 agent 需要项目化、线程化、工作区隔离**
4. **自动化和技能系统必须成为一等能力**
5. **CLI / IDE / App / Cloud 应该共享状态与配置**

这非常适合 `HelloLoop`。

## HelloLoop 的最佳产品组合

### 必须保留的

- `hello-daemon`
- `Hello CLI`
- `Web Dashboard`

### 强烈建议保留的

- `Tray`

### 可以后置的

- `Hello App` 原生桌面壳层

## 为什么我现在更推荐 Web Dashboard，而不是立刻重押原生 GUI App

因为你现在最需要的，是一个：

- 真正动态刷新
- 多会话固定布局
- 任务列表 / 依赖 / 阻塞 / 即将进行 / 已完成
- 可点击 drill-down
- 可以很快迭代
- Windows / macOS / Linux 一致

的控制中心。

这件事用 `Web Dashboard + daemon event stream` 最合适。

优点是：

- 三端一致
- 开发效率高
- 视觉自由度高
- 交互能力强
- 比 TUI 更适合复杂项目看板
- 比原生 GUI 更快进入成熟状态

## 那 TUI 还要不要继续做

**要做，但角色要重新定义。**

TUI 不应该背负“完整替代现代 GUI 看板”的压力。

它更适合：

- SSH / 远程 / 服务器场景
- 快速查看运行状态
- 快速暂停 / 恢复 / 重试
- 查看焦点会话日志
- 简洁的列表 / 详情 / 操作

而不是强行承担：

- 最复杂的多仓库调度总览
- 大量卡片式看板
- 丰富图形交互

这些应该主要由 Web 看板承担。

## Hello App 还要不要做

**可以做，但不应当作为当前第一优先级。**

最合理的定义是：

- `Hello App = Web Dashboard + Tray + local shell` 的桌面封装层

也就是说：

- App 是“壳”
- 核心不是 App
- 核心是 `daemon + API + scheduler + host adapters`

这样未来即使做桌面壳：

- Windows / macOS 可以先上
- Linux 可以继续优先使用 `CLI + TUI + Web`

不会把产品路线绑死在原生 GUI 上。

## 是否应该“直接改为和 Codex App 一样的 Hello App”

我的判断是：**不应该直接改成单一 Hello App 路线。**

应该改成：

### 产品分层

1. **Core**
   - 调度器
   - 状态机
   - 守护进程
   - Host adapters
   - 持久化与事件流

2. **Primary surfaces**
   - CLI
   - Web Dashboard
   - Tray

3. **Secondary surfaces**
   - TUI
   - Hello App 桌面壳层

## 最终建议

最终建议很明确：

- 不放弃 `CLI`
- 不把 `Hello App` 设为唯一主产品
- 继续把核心做成 `daemon-first`
- 让 `Web Dashboard` 承担主要复杂可视化
- 让 `CLI/TUI` 承担控制、自动化、远程与运维
- 让 `Hello App` 成为后续增强层，而不是架构前提

## 一句话总结

如果借鉴 `Codex App`，正确学法不是：

- “既然 GUI 更强，那就抛弃 CLI”

而是：

- **“像 Codex 一样，做一个多 surface 共享同一底层引擎的 agent command center。”**

# Hello CLI 产品定位与可行性判断

## 结论摘要

在当前补充约束下，`HelloLoop` 完全可以演进为一个独立的 `Hello CLI` 工具，并同时满足：

- Windows / macOS / Linux 三端使用
- 自动拉起后台守护进程
- 自动启用系统托盘与菜单
- 通过托盘一键打开 Web 看板
- 在终端内提供动态 TUI 观察与调度
- 按任务主线自动编排多个会话视图
- 调度系统已安装的 `Codex CLI` / `Claude Code` / `Gemini CLI`

但最优实现方式不是“基于某一个现有 CLI 整体改壳”，而是：

- 自建 `Hello CLI` 控制面
- 复用外部 CLI 作为宿主执行器
- 选择性借鉴开源 CLI 的架构思路与少量可复用模块
- 不把任何单一外部 CLI 当作产品底座

## 关于三端支持

三端支持是 `Hello CLI` 的硬要求，且从产品定位看必须一开始就按跨平台设计：

- `Windows`
- `macOS`
- `Linux`

这进一步强化了 `Rust + daemon + PTY + local API` 的方向，因为：

- 要统一后台守护
- 要统一托盘
- 要统一会话监管
- 要统一事件流
- 要统一状态恢复

## 是否可以基于已有 CLI 源码创建独立 Hello CLI

### 可以借鉴，但不建议“基于其中一个源码整体派生”

这是本次补充后的最重要判断。

原因有三类：

1. **产品主权问题**  
   `Hello CLI` 的目标是统一编排多个宿主，而不是成为 `Codex`、`Gemini` 或 `Claude` 的某个分支版本。

2. **维护耦合问题**  
   一旦以某个上游 CLI 为底座，后续版本升级、协议变化、能力边界变化都会把 `Hello CLI` 锁死在该上游的演进节奏上。

3. **合法性与可分发问题**  
   `Codex`、`Gemini CLI`、`OpenCode` 属于开源可借鉴对象；但 `Claude Code` 官方并不是以“你当前这份 recovered 仓库”为稳定开源底座对外提供的，因此不能把 `C:\Users\hellowind\Downloads\cc-recovered-main` 当作安全可靠的产品基础。

## 对各个候选上游的判断

### `openai/codex`

可高度借鉴，但不建议直接 fork 成 `Hello CLI`。

可借鉴点：

- 它已经是成熟的本地 coding agent
- 仓库本身明确包含 `codex-rs`，说明 Rust 作为核心运行时是成立的
- 仓库是 `Apache-2.0`
- 截至 `2026-03-31`，GitHub 页面显示最新 release 为 `0.118.0`

参考：

- `https://github.com/openai/codex`

### `google-gemini/gemini-cli`

可借鉴其开放生态和 MCP 扩展方式，但不建议作为总控底座。

官方页面显示它是 open-source terminal agent，且为 `Apache-2.0`。

参考：

- `https://github.com/google-gemini/gemini-cli`

### `anomalyco/opencode`

是本次最值得借鉴的“产品形态”参考之一。

官方 README 公开强调两点，非常贴近 `Hello CLI` 目标：

- 强调 `TUI`
- 强调 `client/server architecture`

这说明它更接近“前端只是客户端，后台是持久控制面”的思路，而这正是 `Hello CLI` 最应该吸收的部分。

参考：

- `https://github.com/anomalyco/opencode`

### `Claude Code`

应分开看：

- **官方产品能力与交互形态**：强烈值得研究
- **你本地 recovered 源码**：不适合作为产品底座

官方文档已经表明 Claude Code 现在覆盖 terminal、desktop、web 等多表面，并强调它们连接到同一 underlying engine。这个产品方向是值得参考的。  
但你本地的 `cc-recovered-main` 仍然只是 recovered project，不适合作为稳定基础。

参考：

- 官方概览：`https://code.claude.com/docs/en/overview`
- 本地 recovered 说明：`C:\Users\hellowind\Downloads\cc-recovered-main\README.md:25`

## 最佳产品形态

补充你的新约束后，我认为最佳产品形态已经更清晰：

- 一个独立的 `hello` 可执行程序
- 启动时自动探测 / 拉起 `hello-daemon`
- `hello-daemon` 自动管理托盘与本地 API
- `hello` 本身提供命令行入口与 TUI
- Web 看板由本地 daemon 提供并在浏览器打开
- 宿主执行器通过 adapter 调用系统已安装的 `codex` / `claude` / `gemini`

换句话说：

- **可以没有“单独的原生 GUI 客户端”**
- **但不能没有后台 daemon**
- **也不能没有 Web 看板与 TUI 这两个观察/操作面**

## 是否可以不做 GUI 客户端

**可以。**

如果按你的倾向，我建议：

### 保留

- CLI
- TUI
- Tray
- Web Dashboard

### 暂缓

- 独立 Desktop GUI 客户端

这会更聚焦，也更符合 `HelloLoop` 当前定位。

注意：

- 托盘本身已经属于桌面交互面
- Web 看板本身也是 GUI，只是不是单独桌面壳

所以更准确的说法不是“完全不要 GUI”，而是：

> 不必优先做独立桌面 GUI 客户端，先用 `TUI + Tray + Web Dashboard` 完成绝大多数能力。

## 多个 TUI 窗口/列表能否自动编排

**能，但要谨慎定义“窗口”。**

最佳实现不是弹多个系统终端，而是：

- 一个主 TUI
- 左侧会话/仓库列表
- 中间任务状态与依赖图
- 右侧当前焦点会话日志/终端流
- 支持 tab / split / focus / pin
- 超过阈值后自动折叠为列表或分组

也就是说：

- 默认是**一个主 TUI 内的多窗格**
- 不默认创建多个系统控制台窗口
- 需要时可“弹出查看某个会话”，但这是例外，不是常态

这样既能避免闪烁，也最利于统一调度。

## 对源码复用策略的最终判断

### 推荐

- 参考 `Codex` 的 Rust 核心与发布/分发方式
- 参考 `OpenCode` 的 client/server + TUI 产品形态
- 参考 `Gemini CLI` 的开放扩展、MCP、跨平台分发
- 参考 `codex-plugin-cc` 的跨宿主委派与后台任务管理方式
- 参考 `Claude Code` 官方“多 surface 同一引擎”的产品原则

### 不推荐

- 直接 fork `Codex` 然后硬改成多宿主总控
- 直接 fork `OpenCode` 然后强塞调度器
- 直接把 `cc-recovered-main` 改造成 `Hello CLI`
- 用多个原生终端窗口替代真正的 session pane architecture

## 最佳实施顺序

1. 先把 `HelloLoop` 重新定义为 `Hello control plane`
2. 建立 Rust workspace 与 `hello-daemon`
3. 建立 host adapter：`codex` / `claude` / `gemini`
4. 建立统一会话状态模型、重试模型、依赖模型
5. 建立 TUI 主界面
6. 建立 Web 看板
7. 最后补 tray、自启动、消息连接器

## 最终结论

补充这两个条件后，我的结论更明确了：

- `Hello CLI` 应该做
- 应该是独立产品，而不是任何单一 CLI 的壳
- 应该支持 Windows / macOS / Linux
- 应该默认带 daemon + tray + web dashboard + TUI
- 不必优先做独立 GUI 客户端
- 应以 Rust 为核心
- 可借鉴 `Codex` / `OpenCode` / `Gemini CLI` / `codex-plugin-cc`
- 不应以 `cc-recovered-main` 为产品基础

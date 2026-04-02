# HelloLoop Rust 核心重构建议

## 一句话结论

`Rust` 是 `HelloLoop` 下一阶段的最佳核心技术栈，但“最佳方案”不是把所有层都机械地改写成纯 Rust，而是采用 **Rust-first control plane**：

- 以 `Rust` 重写编排内核、守护进程、调度器、状态机、PTY/进程监管、事件总线、TUI、系统托盘与本地 API
- 以 Web 技术承载复杂可视化界面，并由 `Tauri 2` 封装为桌面壳层
- 把 `Codex CLI` / `Claude Code` / `Gemini CLI` 作为可插拔宿主执行器，而不是把任何一个外部 CLI 的源码直接当成基础底座

这意味着：**建议对 HelloLoop 进行 Rust 主导的全量架构重构，但不建议做“所有可见层全部纯 Rust 渲染”的教条式重写。**

## 为什么是 Rust

从 `HelloLoop` 的真实目标看，它已经不是一个普通 Node CLI：

- 需要长期运行的中央调度器
- 需要跨平台守护进程与心跳
- 需要对子会话进行可靠的进程/PTY 管控
- 需要本地事件总线、WebSocket/SSE 推送、状态持久化
- 需要系统托盘、桌面壳层、后台自恢复
- 需要避免 Windows 下 PowerShell 窗口闪烁、弹窗、僵尸子进程

这一类“本地控制面 + 多进程编排 + 长期驻留 + 跨平台系统集成”的问题，`Rust` 相比当前 `Node.js` 方案更合适，原因是：

1. **跨平台单二进制能力更强**  
   更适合把守护进程、CLI、TUI、托盘、API 服务打成统一分发物。

2. **并发与可靠性更适合编排器**  
   `Tokio` 非常适合承载调度、重试、超时、取消、背压、事件流等控制面语义。

3. **进程/PTY/系统集成更稳**  
   `portable_pty`、原生子进程控制、Windows 无窗口启动策略，都更适合在 Rust 核心内统一治理。

4. **常驻后台开销更低**  
   对比脚本型运行时，更适合做长期活跃的 supervisor / daemon。

5. **更利于状态机和领域模型固化**  
   对调度状态、任务依赖、错误类型、恢复策略等复杂模型更容易做成严格类型系统。

## 为什么不是继续以 Node.js 作为唯一核心

当前仓库已经具备一些正确方向，但它仍是明显的“插件脚本型架构”：

- 运行入口仍是 Node 包：`D:\GitHub\dev\helloloop\package.json:1`
- 当前核心发布物仍是 `bin/helloloop.js`：`D:\GitHub\dev\helloloop\package.json:15`
- 当前唯一原生辅助只覆盖 Windows 隐藏 shell：`D:\GitHub\dev\helloloop\native\windows-hidden-shell-proxy\Program.cs:1`

说明当前版本已经感知到“原生控制问题”，但还没有形成真正的跨平台原生控制面。

继续把 `Node.js` 作为唯一核心，会越来越难承载：

- 稳定后台守护
- 无闪烁会话监管
- 高密度并发 CLI 进程治理
- 精准的状态持久化与恢复
- 本地服务化、托盘化、桌面化

## 对当前 HelloLoop 的判断

当前 `HelloLoop` 在**方法论层**已经走对了方向：

- 已内置文档画像分析：`D:\GitHub\dev\helloloop\src\workflow_model.mjs:314`
- 已能生成主线蓝图：`D:\GitHub\dev\helloloop\src\workflow_model.mjs:389`
- 已明确声明方法论为 `hierarchical_role_based_agile_multi_agent_sdlc`：`D:\GitHub\dev\helloloop\src\workflow_model.mjs:421`
- 已明确声明中心调度模式 `central_supervisor`：`D:\GitHub\dev\helloloop\src\workflow_model.mjs:424`
- 已存在结构化状态语义与错误映射（如 400/429/500/503）：`D:\GitHub\dev\helloloop\src\status_model.mjs:35`

因此，不应该推倒重来所有产品语义；真正需要重构的是：

- **运行时内核**
- **状态存储与恢复机制**
- **多宿主执行器适配层**
- **持续运行的控制面**

## 最佳总体架构

推荐将项目重构为 **Rust 工作区 + Web/Tauri 可视化层**。

### 1. Rust 领域内核

由 Rust 负责唯一真实状态源（single source of truth）：

- 工作流图 / 阶段门禁 / 依赖 DAG
- 会话生命周期
- 调度、重试、回退、熔断
- 结构化错误分类
- 持久化状态与事件溯源
- 记忆、摘要、工件索引

### 2. Rust 执行控制层

负责：

- 启动 / 恢复 / 终止各宿主 CLI 会话
- 统一 PTY 或隐藏子进程策略
- 采集 stdout/stderr/事件
- 解析会话状态与错误类型
- 驱动自动重试、依赖等待、人工接管

### 3. Rust 本地服务层

负责：

- 本地 HTTP / WebSocket / SSE API
- TUI / Web / Desktop 的统一订阅接口
- 多客户端同时观察同一编排状态
- 守护进程心跳、自恢复、watchdog

### 4. 交互层

分成三类：

- `hello` 终端 CLI：命令入口与非交互控制
- `hello-tui`：运维 / 观察 / 调度视图
- `hello-desktop`：`Tauri 2` 桌面壳层 + 系统托盘 + Web 看板

### 5. 宿主适配层

把三类外部 CLI 当作 **Host Adapter**：

- `Codex`
- `Claude Code`
- `Gemini CLI`

每个适配器只负责：

- 探测安装状态
- 生成启动参数
- 建立权限/恢复/日志桥接
- 解释宿主特有错误与能力差异

而不是把宿主本身变成系统主控。

## `hello CLI` 是否应该做

**应该做。**

但应把它定义为：

- `HelloLoop` 的旗舰控制台产品
- 基于同一 Rust 内核的一个前端入口
- 既能自己作为完整 CLI 使用
- 也能调度系统已安装的 `Codex CLI` / `Claude Code` / `Gemini CLI`

最合理的产品关系是：

- `HelloLoop`：项目名 / 编排引擎 / 宿主生态名
- `hello`：面向用户的主 CLI / Desktop / TUI 入口

## 是否可以基于 `cc-recovered-main` 直接改造

**不建议。**

原因很明确：

1. 它自己已经声明不是官方上游源码：`C:\Users\hellowind\Downloads\cc-recovered-main\README.md:25`
2. 它包含兼容层、shims、stubs：`C:\Users\hellowind\Downloads\cc-recovered-main\README.md:27`
3. 它明确不保证与正式发布 bundle 行为一致：`C:\Users\hellowind\Downloads\cc-recovered-main\README.md:30`
4. 它可能仍缺失私有集成与原生路径恢复：`C:\Users\hellowind\Downloads\cc-recovered-main\README.md:31`

这类恢复工程可以用于研究，但不适合作为 `HelloLoop / hello CLI` 的产品底座。

### 可以借鉴什么

可以借鉴以下实现思路：

- 大规模命令注册表：`C:\Users\hellowind\Downloads\cc-recovered-main\src\commands.ts:2`
- 会话桥接与权限转发：`C:\Users\hellowind\Downloads\cc-recovered-main\src\bridge\sessionRunner.ts:29`
- 子进程会话生成：`C:\Users\hellowind\Downloads\cc-recovered-main\src\bridge\sessionRunner.ts:250`
- 子进程启动与日志 ring buffer：`C:\Users\hellowind\Downloads\cc-recovered-main\src\bridge\sessionRunner.ts:335`
- WebSocket 自动重连、缓存重放、keepalive：`C:\Users\hellowind\Downloads\cc-recovered-main\src\cli\transports\WebSocketTransport.ts:74`

### 不应借鉴什么

- 不应直接继承其整体架构
- 不应复制其 monolithic CLI 主入口风格
- 不应把 Anthropic/私有依赖耦合带入新系统

## 是否应该在 Hello CLI 中“打开多个小终端窗口”

**应该显示多个会话窗格，但不应该打开原生系统控制台窗口。**

最佳方案不是把 PowerShell / Terminal / iTerm 原生窗口塞进应用里，而是：

- `Rust` 使用 `PTY` 监管真实子进程
- Desktop/Web 中用 `xterm.js` 渲染终端窗格
- TUI 中用 `Ratatui` 做列表、详情、焦点切换、任务状态

这比“弹出很多系统控制台窗口”更专业，也更稳定。

## 为什么这套方式更好

`xterm.js` 已被用于 VS Code 等项目，适合浏览器/桌面内终端渲染；它明确支持把真实终端进程通过 PTY 接进来。  
`Ratatui` 则适合高性能本地 TUI 观测与调度界面。  
`portable_pty` 提供跨平台 PTY 抽象。  
这三者组合，正好覆盖：

- 桌面多窗格
- Web 终端视图
- TUI 运维视图
- 无原生控制台闪烁

## 推荐仓库结构

```text
helloloop/
├── Cargo.toml
├── Cargo.lock
├── apps/
│   ├── hello-cli/
│   ├── hello-daemon/
│   ├── hello-tui/
│   ├── hello-desktop/
│   └── hello-web/
├── crates/
│   ├── helloloop-domain/
│   ├── helloloop-workflow/
│   ├── helloloop-planner/
│   ├── helloloop-scheduler/
│   ├── helloloop-runtime/
│   ├── helloloop-pty/
│   ├── helloloop-store/
│   ├── helloloop-memory/
│   ├── helloloop-api/
│   ├── helloloop-observability/
│   ├── helloloop-host-codex/
│   ├── helloloop-host-claude/
│   ├── helloloop-host-gemini/
│   └── helloloop-connectors/
├── plugins/
│   ├── codex/
│   ├── claude/
│   └── gemini/
├── docs/
├── fixtures/
└── scripts/
```

## 与“分层角色导向的敏捷多代理 SDLC 工作流”的映射

建议把工作流做成真正的领域状态机，而不是一组松散 prompt：

1. **Intake / Product 层**  
   需求澄清、用户故事、验收标准、任务拆解

2. **Architecture / Context 层**  
   Summary、Control、Architect 三类工件生成与上下文定位

3. **Execution 层**  
   Developer / Tester 会话并行，支持 lane 级调度与 stage gate

4. **Review / Supervisor 层**  
   Review、Consistency Check、Risk Gate、CI Gate

5. **Delivery / Ops 层**  
   Release、Runbook、Deploy、Watch、Rollback

6. **Memory / Evolution 层**  
   长期记忆、失败模式库、项目摘要、恢复快照、自优化策略

## 推荐的状态模型

新的统一状态模型建议至少区分：

- `ready`
- `running`
- `waiting_dependency`
- `waiting_external_signal`
- `rate_limited`
- `retry_scheduled`
- `human_input_required`
- `blocked_policy`
- `failed_recoverable`
- `failed_terminal`
- `completed`

并在结构体内显式保留：

- `reason_code`
- `reason_label`
- `http_status`
- `retry_at`
- `depends_on`
- `current_task`
- `next_task`
- `owner_role`
- `host`
- `session_started_at`
- `last_heartbeat_at`

这会让 JSON / TUI / Web 三端显示真正一致。

## 推荐的持久化模型

建议采用：

- `SQLite` 作为本地主状态库
- `events` 表记录会话与调度事件
- `sessions` / `tasks` / `repos` / `artifacts` / `dependencies` 作为查询模型
- 文档切片、摘要、向量索引作为独立 memory 层

这样可以同时满足：

- 看板查询
- 会话恢复
- 调度回放
- 审计追踪
- 多客户端订阅

## 分阶段迁移路径

### Phase 1：先建立 Rust 控制面

- 建 Rust workspace
- 建状态域模型、调度器、daemon、local API
- 保留现有 JS 分析器逻辑，通过桥接方式接入

### Phase 2：迁移会话执行层

- 用 Rust 接管进程监管、PTY、隐藏窗口策略
- 把 `Codex / Claude / Gemini` 启动与恢复逻辑迁到 Host Adapter

### Phase 3：迁移观察与交互层

- 新建 `hello-tui`
- 新建 `hello-desktop` + tray
- Web 看板改为订阅 daemon 的事件流

### Phase 4：迁移规划与记忆层

- 将文档分析、主线推导、任务图构建逐步 Rust 化
- 保留 prompt 模板，但把 workflow graph 与 artifacts schema 收归 Rust 域模型

## 最终建议

最终建议非常明确：

- **Rust：是最佳核心技术栈**
- **全量重构：建议，但应是 Rust-first 架构重构，而不是纯 UI 层面的机械改写**
- **hello CLI：应该做，且应成为旗舰入口**
- **cc-recovered-main：只做参考，不做底座**
- **会话展示：使用 PTY 窗格，不再弹原生控制台**
- **桌面形态：使用 Tauri 2**
- **TUI：使用 Ratatui**
- **会话/终端渲染：使用 xterm.js + PTY 桥接**
- **守护进程：Rust daemon + 本地 API + event stream**

## 研究依据

- `ALMAS`：面向敏捷 SDLC 的角色对齐多代理框架  
  https://arxiv.org/abs/2510.03463
- `MegaAgent`：动态任务分解、并行执行、监控与大规模 agent 扩展  
  https://aclanthology.org/2025.findings-acl.259/
- `MetaGPT`：SOP 编码、多角色装配线式协作  
  https://arxiv.org/abs/2308.00352
- `LangGraph`：durable execution、human-in-the-loop、memory  
  https://docs.langchain.com/oss/python/langgraph/overview
- `SWE-agent`：工具驱动的软件工程代理基线  
  https://github.com/SWE-agent/SWE-agent
- `OpenHands`：AI-driven development 产品化方向  
  https://github.com/OpenHands/OpenHands
- `Agentless`：说明复杂 agent 之外，定位-修复-验证的简化路径仍然非常重要  
  https://arxiv.org/abs/2407.01489
- `OpenCode`：终端 / 桌面双形态与轻量多代理交互可借鉴  
  https://github.com/anomalyco/opencode
- `codex-plugin-cc`：跨宿主委派与后台任务管理方式可借鉴  
  https://github.com/openai/codex-plugin-cc
- `Tauri 2`：跨平台桌面与托盘能力  
  https://tauri.app/
- `portable_pty`：跨平台 PTY 抽象  
  https://docs.rs/portable-pty
- `xterm.js`：浏览器/桌面内终端渲染基线  
  https://github.com/xtermjs/xterm.js
- `Ratatui`：高性能 Rust TUI 基线  
  https://ratatui.rs/

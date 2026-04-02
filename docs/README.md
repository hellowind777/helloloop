# HelloLoop Docs Index

本目录保存 `HelloLoop` 当前 **App-first** 重构的正式方案资料。

当前主产品方向：

- `Hello App`：主体验与监督控制面
- `hello-daemon`：唯一控制中枢
- `hello-cli`：维护入口

## 推荐阅读顺序

### 1. 产品方向

- `app-first-product-strategy.md`  
  为什么最终选择 Hello App，而不是继续把 CLI / Web 看板作为主产品。

- `hello-app-vs-cli-decision.md`  
  中途方案比较记录，保留用于追溯关键判断过程。

### 2. 最终蓝图

- `hello-app-blueprint.md`  
  Hello App 的信息架构、状态模型、主窗口布局、托盘边界、daemon 职责。

- `hello-app-phase1-implementation.md`  
  第一期实施范围、模块拆分、里程碑、验收标准。

### 3. 方法论基线

- `hierarchical-role-based-agile-multi-agent-sdlc.md`  
  项目级方法论基线，定义“分层角色导向的敏捷多代理 SDLC 工作流”如何落地到 HelloLoop。

### 4. 技术与重构判断

- `rust-rewrite-evaluation-brief.md`
- `rust-core-rewrite-recommendation.md`
- `hello-cli-positioning-and-feasibility.md`

这些文档回答：

- 为什么核心控制面选择 Rust
- 为什么主产品不是纯 CLI
- 为什么需要 daemon / App / CLI 分层
- 多宿主接入边界应该如何划分

### 5. 历史与兼容资料

- `multi-cli-architecture.md`
- `multi-cli-tasks.md`
- `plugin-standard.md`
- `install.md`

这些文档主要用于回顾旧阶段的多宿主插件设计与安装边界，不再代表最终主产品形态。

## 读完这些文档后应得到的结论

你应该能明确知道：

- HelloLoop 的主产品是 Hello App
- hello-daemon 是唯一真实控制面
- hello-cli 是维护入口，不是主展示层
- Web 页面只是 Hello App 的共享前端与浏览器 fallback
- 整个系统必须围绕结构化状态、持续调度、自动恢复、人工接管点来设计

## 对应源码位置

- `apps/hello-app/`：Hello App Web UI 与 Tauri 壳
- `apps/hello-daemon/`：本地 daemon
- `apps/hello-cli/`：CLI 维护入口
- `crates/`：领域、API、运行时、调度、宿主适配
- `legacy/`：旧 Node 语义桥接与迁移期资产

## 当前阶段最值得关注的实现点

- 工作区 onboarding / 分析 / 主线继续
- pause-mainline / continue-mainline / recover-first 控制语义
- 结构化状态模型在 JSON / App / tray 的统一表达
- daemon 自动端口回退与活动地址发现
- Windows / macOS / Linux 三端后台静默运行体验
- `zh-CN` / `en-US` 双语界面能力

# Hello App 最终蓝图

## 1. 产品定义

`Hello App` 是 `HelloLoop` 的主产品形态。

它不是一个单纯聊天窗口，也不是传统终端壳，而是一个面向多代理软件工程的 **Agent Command Center**：

- 接收开发需求 / 文档 / 文档目录
- 自动分析当前仓库与开发主线
- 基于“分层角色导向的敏捷多代理 SDLC 工作流”生成任务图
- 中央调度多个宿主 CLI 会话并行或有序执行
- 实时展示当前任务、后续任务、阻塞、依赖、风险、重试与人工接管点

## 2. 最终产品边界

### 主产品

- `Hello App`

### 核心后台

- `hello-daemon`

### 附属入口

- `hello-cli`

### 视图技术

- App 内主界面使用 Web UI
- 浏览器 fallback 复用同一套前端
- 不再单独宣传“Web 看板”产品线

## 3. 运行架构

```text
Hello App (Tauri 2 shell)
        │
        ├── Web UI
        │     ├── Command Center
        │     ├── Sessions
        │     ├── Tasks
        │     ├── Dependencies
        │     ├── Review / Diff
        │     └── Settings
        │
        └── Local IPC / HTTP / WebSocket
                     │
               hello-daemon
                     │
        ┌────────────┼────────────┐
        │            │            │
   Codex adapter  Claude adapter Gemini adapter
        │            │            │
     codex CLI    claude code   gemini CLI
```

## 4. 核心信息架构

`Hello App` 顶层信息架构建议固定为 6 个一级域：

### 4.1 Command Center

用于总览：

- 当前主线
- 各仓库健康度
- 正在运行的会话
- 阻塞与等待原因
- 即将续跑的任务
- 重试与人工介入队列

### 4.2 Workspaces

用于管理：

- 项目 / 代码仓
- 开发文档 / 文档目录
- 当前 sprint / 主线
- 关联宿主引擎

### 4.3 Sessions

用于查看：

- 每个宿主会话的实时状态
- 当前执行任务
- 最近输出
- 错误类型
- 重试计划
- 焦点终端流

### 4.4 Tasks

用于查看：

- 未开始任务
- 进行中任务
- 等待依赖任务
- 已完成任务
- 已阻塞任务
- 验收项与责任角色

### 4.5 Review

用于查看：

- diff
- 测试结果
- 风险
- 失败模式
- 需要人工接管的节点

### 4.6 Settings

用于配置：

- 默认宿主策略
- 调度策略
- 自动重试策略
- 通知
- i18n
- tray 行为
- daemon 行为

## 5. 主窗口布局

默认主窗口建议采用四区布局：

### 左侧导航栏

- Command Center
- Workspaces
- Sessions
- Tasks
- Review
- Settings

### 左中仓库/任务树

- 仓库列表
- 当前 sprint
- lane / stage
- 任务树
- 过滤器

### 中央主内容区

根据当前模块切换：

- 总览卡片
- 依赖图
- 会话矩阵
- 任务看板
- 时间线
- diff / review

### 右侧焦点面板

- 当前焦点会话
- 终端流
- 结构化状态
- 当前动作
- 下一动作
- 失败原因
- 操作按钮

### 底部事件栏

- 告警
- 通知
- 重试倒计时
- daemon 心跳
- 模型限流 / 失败摘要

## 6. 关键交互流

### 6.1 新项目启动

1. 导入仓库 / 文档 / 文档目录
2. App 调用 daemon 进行分析
3. 生成工作流蓝图与 backlog
4. 用户确认主线 / 调度策略
5. 开始创建会话并执行

### 6.2 运行中监督

1. Command Center 显示全局态
2. Sessions 显示每个会话的实时状态
3. Tasks 显示可执行 / 等待 / 阻塞 / 完成
4. 用户可 pause / retry / reprioritize / handoff

### 6.3 异常恢复

1. daemon 检测错误分类
2. 按策略自动重试或等待依赖
3. 必要时发出人工接管通知
4. 用户在 App / tray / CLI 中恢复或处理

## 7. 状态模型要求

主界面必须直接展示统一结构化状态，而不是模糊文案。

最少应展示：

- `state`
- `reason_code`
- `reason_label`
- `host`
- `role`
- `current_task`
- `next_task`
- `depends_on`
- `retry_at`
- `http_status`
- `last_heartbeat_at`

推荐主状态：

- `running`
- `ready`
- `waiting_dependency`
- `waiting_external_signal`
- `retry_scheduled`
- `rate_limited`
- `human_input_required`
- `failed_recoverable`
- `failed_terminal`
- `completed`

## 8. 托盘设计

托盘菜单不应只是“打开/退出”。

至少包含：

- 打开 `Hello App`
- 打开当前项目
- 查看运行中会话数
- 查看阻塞/告警数
- 恢复上次任务
- 暂停全部
- 继续全部
- 打开日志目录
- 打开设置
- 重启 daemon
- 退出

## 9. hello-daemon 职责

`hello-daemon` 是唯一真实控制面，负责：

- 项目与文档分析
- 任务图与阶段门管理
- 宿主适配器调用
- 子进程 / PTY 监管
- 会话恢复与状态持久化
- 事件流广播
- tray 协调
- App / CLI / browser 统一 API

## 10. hello-cli 的定位

`hello-cli` 不再承担主产品展示，而负责：

- `doctor`
- `daemon start|stop|status`
- `recover`
- `export`
- `connect`
- `open`

它是维护入口，不是主要体验载体。

## 11. 技术栈建议

### 后台与控制面

- `Rust`
- `Tokio`
- `Axum`
- `SQLite`
- `sqlx`
- `tracing`
- `portable_pty`

### App 壳层

- `Tauri 2`

### 前端

- `React`
- `TypeScript`
- `xterm.js`
- 轻量高可定制组件体系

## 12. 不建议优先做的内容

当前阶段不建议优先投入：

- 复杂纯 TUI 多窗格产品
- 原生多窗口终端拼接
- 云端 SaaS 后台优先
- 多消息平台连接器优先
- 过早的团队协作/计费/组织架构模块

## 13. 成功标准

`Hello App` 第一阶段完成时，至少应满足：

- 三端可运行
- daemon 可静默常驻
- tray 可用
- 可导入项目与文档
- 可自动生成主线与任务图
- 可并行调度多个宿主会话
- 可清晰显示运行中 / 等待 / 阻塞 / 重试 / 完成
- 无原生控制台闪烁
- 用户能在 GUI 中完成主要监督与恢复动作

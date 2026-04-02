# Hello App 第一期实施蓝图

## 1. 一期目标

第一期不追求完整商业化产品，而是先形成可运行的 `App-first control plane`：

- `hello-daemon`
- `Hello App`
- `hello-cli`
- 基础 tray
- 基础多会话调度
- 基础项目分析与任务图

## 2. 一期范围

### 必做

- Rust workspace 初始化
- `hello-daemon` 进程
- 本地 API 与事件流
- `Codex` / `Claude` / `Gemini` host adapter 骨架
- SQLite 持久化
- 项目分析桥接现有 JS 逻辑
- App 主窗口
- Command Center 初版
- Sessions 视图初版
- Tasks 视图初版
- tray 初版
- CLI 维护命令初版

### 暂不做

- 完整付费体系
- 团队权限体系
- 多人协同
- 云同步
- 飞书 / QQ / 微信连接器
- 高级 memory / 向量检索

## 3. 推荐仓库结构

```text
helloloop/
├── Cargo.toml
├── apps/
│   ├── hello-app/
│   ├── hello-daemon/
│   └── hello-cli/
├── crates/
│   ├── helloloop-domain/
│   ├── helloloop-store/
│   ├── helloloop-scheduler/
│   ├── helloloop-runtime/
│   ├── helloloop-pty/
│   ├── helloloop-api/
│   ├── helloloop-host-codex/
│   ├── helloloop-host-claude/
│   └── helloloop-host-gemini/
├── frontend/
│   └── hello-app-web/
├── legacy/
│   └── node-runtime/
└── docs/
```

## 4. 模块拆分

### `helloloop-domain`

负责：

- 任务
- 会话
- 仓库
- 状态
- 错误模型
- 调度策略

### `helloloop-store`

负责：

- SQLite schema
- 仓库访问
- 事件表
- 查询模型

### `helloloop-scheduler`

负责：

- 主线推进
- lane 并行
- stage gate
- 重试与等待
- 依赖阻塞

### `helloloop-runtime`

负责：

- 运行 supervisor
- 子进程生命周期
- 输出采集
- 心跳与恢复

### `helloloop-pty`

负责：

- PTY 建立
- 跨平台隐藏控制台策略
- 终端流桥接

### `helloloop-api`

负责：

- HTTP
- WebSocket / SSE
- App 与 CLI 的本地调用接口

### host adapters

每个宿主一个 crate，负责：

- 安装探测
- 参数生成
- 错误翻译
- 特有恢复策略

## 5. 前端初版页面

### `/`

- Command Center

### `/workspaces/:id`

- 项目概览
- 文档概览
- backlog 概览

### `/sessions`

- 会话列表
- 焦点会话详情

### `/tasks`

- 看板 / 列表双视图

### `/review`

- 基础 diff 与结果摘要

### `/settings`

- 宿主策略
- 调度策略
- daemon 行为
- i18n

## 6. 一期里程碑

### M1：Control Plane 骨架

- Rust workspace
- daemon
- domain/store/api 基础
- CLI `doctor/status`

### M2：执行层接管

- host adapters 骨架
- 子进程监管
- PTY 桥接
- 基础重试与恢复
- recent event replay API
- daemon bootstrap metadata / health context

### M3：App 初版

- Tauri 壳层
- Command Center
- Sessions
- Tasks
- tray
- browser fallback `/app/`

### M4：从现有 Node 迁移关键语义

- 文档分析桥接
- workflow blueprint 桥接
- 旧状态模型映射到新状态模型

## 7. 迁移策略

### 原则

- 先重建内核，再迁移表层
- 先 Rust 化控制面，再逐步替换旧 Node 运行时
- 在迁移期保留现有 JS 分析成果，避免推翻已有方法论沉淀

### 具体做法

1. `legacy/node-runtime` 暂存现有 JS 实现
2. Rust daemon 通过 bridge 调用现有分析器
3. 新 App 直接消费 Rust API
4. 待 Rust 原生 planner 成熟后，再替换 legacy bridge

## 8. 风险与对策

### 风险：范围过大

对策：

- 只先做三件事：分析、调度、观察

### 风险：三端细节不一致

对策：

- 统一 daemon 与 API
- 前端视图层尽量共享

### 风险：宿主 CLI 差异大

对策：

- adapter 边界前置
- 不让宿主差异污染领域模型

### 风险：Windows 控制台闪烁

对策：

- 用 Rust 统一接管创建进程和 PTY
- 不再依赖弹出式系统终端

## 9. 一期验收标准

- `Hello App` 可启动并自动连接 daemon
- daemon 可独立运行、可重启、可恢复
- 至少能导入一个项目与一组文档
- 能创建 2 个以上并行会话
- 会话状态能被结构化展示
- 出现 429 / 500 / 503 / 依赖等待时能正确显示
- tray 可打开主窗口并显示运行摘要
- 全程无 PowerShell / Terminal 闪烁窗口

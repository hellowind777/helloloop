# HelloLoop

> 一个面向持续软件交付的本地多代理指挥中心。  
> 现在的主产品形态不是“命令列表”，而是 **Hello App + hello-daemon + hello-cli**。

## HelloLoop 是什么

HelloLoop 用来把下面这类开发任务真正持续推进下去：

- 输入开发需求、开发文档、文档目录或现有仓库
- 自动分析当前代码进度与文档目标之间的差距
- 生成并持续推进主线、泳道、依赖与 backlog
- 调度 `Codex CLI`、`Claude Code`、`Gemini CLI`
- 在一个统一控制面里持续观察：
  - 当前任务
  - 后续任务
  - 已完成任务
  - 阻塞与依赖
  - 429 / 400 / 500 / 503 等故障语义
  - 自动重试 / 等待人工介入 / 继续主线

它适合“需要持续往前跑”的真实开发流程，而不是只回答一轮对话。

---

## 当前产品形态

### 1. Hello App

主产品界面。

提供：

- Command Center
- Workspaces
- Sessions
- Tasks
- Review
- Settings

支持：

- 浅色 / 深色主题
- `zh-CN` / `en-US` 多语言
- 焦点会话面板
- 结构化状态语义展示
- 本地桌面托盘入口
- 浏览器 fallback

### 2. hello-daemon

本地控制面服务。

负责：

- 工作区分析
- 主线快照刷新
- 本地 API / 事件流
- 会话状态聚合
- 控制动作转发
- App / CLI / tray 统一状态源

### 3. hello-cli

维护与接入入口，不再承担主产品展示。

常用来：

- 启动 / 检查 daemon
- 连接工作区
- 打开 Hello App
- 恢复主线
- 导出快照

---

## 现在能直接做什么

- 导入仓库路径、文档路径、配置目录名、首选引擎
- 保存工作区选择
- 触发工作区分析
- 查看主线蓝图、运行态、健康信号、近期活动
- 查看会话详情、依赖、恢复动作、任务分组
- 查看评审摘要、结构化诊断、验证证据、最近文件变更
- 从 tray / CLI / App 继续主线、暂停主线或恢复首个可恢复会话
- 在默认端口不可用时自动切换到可用本地端口
- 通过活动记录文件让 CLI / App 自动发现当前 daemon 地址
- 在 Windows 下以隐藏方式启动后台进程，尽量避免控制台闪烁

---

## 最适合的使用场景

- 根据 PRD、架构文档、任务文档持续完成一个仓库
- 多仓 / 多泳道并行推进，需要统一监督
- 任务会跑很久，希望中断后还能接上
- 需要把“分析 → 执行 → 评审 → 恢复”收口到同一控制面
- 希望把 `Codex CLI`、`Claude Code`、`Gemini CLI` 放到同一套方法论里使用

不适合：

- 只改一个小文件
- 只聊方案、不执行代码
- 不允许本地生成状态文件或自动修改代码

---

## 快速开始

### 1. 启动 daemon

```powershell
cargo run -p hello-cli --manifest-path "D:\GitHub\dev\helloloop\Cargo.toml" -- daemon start --workspace "D:\GitHub\dev\helloloop"
```

说明：

- 默认监听 `127.0.0.1:37176`
- 若该端口被占用，会自动回退到下一个可用端口
- 当前活动地址会写入本地 daemon 记录文件，CLI 与 App 会自动发现

### 2. 连接工作区并触发分析

```powershell
cargo run -p hello-cli --manifest-path "D:\GitHub\dev\helloloop\Cargo.toml" -- connect --workspace "D:\GitHub\dev\helloloop" --docs "docs" --engine codex --config-dir-name ".helloloop" --analyze
```

### 3. 打开 Hello App

```powershell
cargo run -p hello-cli --manifest-path "D:\GitHub\dev\helloloop\Cargo.toml" -- open
```

### 4. 查看 daemon 状态

```powershell
cargo run -p hello-cli --manifest-path "D:\GitHub\dev\helloloop\Cargo.toml" -- daemon status
```

### 5. 继续主线

```powershell
cargo run -p hello-cli --manifest-path "D:\GitHub\dev\helloloop\Cargo.toml" -- continue
```

### 6. 暂停主线

```powershell
cargo run -p hello-cli --manifest-path "D:\GitHub\dev\helloloop\Cargo.toml" -- pause
```

### 7. 恢复首个可恢复会话

```powershell
cargo run -p hello-cli --manifest-path "D:\GitHub\dev\helloloop\Cargo.toml" -- recover-first
```

### 8. 同步本地插件目录

```powershell
powershell -ExecutionPolicy Bypass -File "D:\GitHub\dev\helloloop\scripts\sync-local-plugin.ps1" -Host codex -Force
```

---

## hello-cli 常用命令

```text
hello-cli doctor
hello-cli open
hello-cli settings
hello-cli workspace
hello-cli connect --workspace <repo> --docs <docs> --engine <codex|claude|gemini> --config-dir-name <name> --analyze
hello-cli continue
hello-cli pause
hello-cli recover-first
hello-cli recover --session <id> --action <key>
hello-cli export --out <file>
hello-cli daemon start
hello-cli daemon status
hello-cli daemon stop
```

---

## 界面里能看到什么

### Command Center

- 当前主线
- 任务总量
- 会话风险
- 事件流

### Workspaces

- 工作区导入
- 主线蓝图
- 工作区健康
- 运行态与近期活动

### Sessions

- 会话矩阵
- 状态分组
- 焦点会话详情
- 可执行恢复动作

### Tasks

- 依赖流
- Ready / Running / Blocked / Completed 四列
- Lane / 依赖过滤

### Review

- 结构化诊断
- 风险信号
- 验证证据
- 最近文件变更

### Settings

- 默认宿主
- 调度策略
- 自动重试
- 主题 / 多语言
- daemon 运行上下文

---

## 运行时状态放在哪里

### daemon 活动记录

用于让 App / CLI 自动发现当前 daemon 地址。

- Windows：`%LOCALAPPDATA%\HelloLoop\active-daemon.json`
- macOS：`~/Library/Application Support/HelloLoop/active-daemon.json`
- Linux：`$XDG_STATE_HOME/helloloop/active-daemon.json`

### 工作区状态

每个仓库的运行数据仍写入目标仓库下的 `.helloloop/`。

常见内容包括：

- backlog
- 主线状态
- 运行状态
- supervisor 状态
- runs 记录
- daemon 数据库

---

## 当前文档入口

- `docs/app-first-product-strategy.md`
- `docs/hello-app-blueprint.md`
- `docs/hello-app-phase1-implementation.md`
- `docs/hierarchical-role-based-agile-multi-agent-sdlc.md`
- `docs/rust-core-rewrite-recommendation.md`
- `docs/README.md`

---

## 当前仓库定位

这个仓库已经进入 **App-first control plane** 阶段。

也就是说：

- Hello App 是主体验
- hello-daemon 是唯一控制中枢
- hello-cli 是维护入口
- 浏览器页面与桌面壳共享同一套 Web UI

旧的长命令式 dashboard / web / tui 形态不会再作为主产品方向继续扩张。

---

## 一句话理解

如果普通 CLI 更像“单轮开发助手”，那 HelloLoop 更像“持续推进开发主线的本地指挥中心”。

# HelloLoop

> [!WARNING]
> `HelloLoop` 适合“持续推进型”的自动开发任务，不适合在未备份的重要仓库上直接盲跑。请先备份关键数据，并对自动修改结果进行人工复核。

`HelloLoop` 是一个面向 `Codex CLI`、`Claude Code`、`Gemini CLI` 的持续开发工作流插件。

它解决的不是“问一次、答一次”的问题，而是这类场景：

- 根据开发文档持续推进一个仓库，直到 backlog 清空
- 先分析当前代码进度，再补齐缺口，而不是从头乱做
- 中途遇到宿主中断、限流、网络抖动后还能继续接上
- 同时查看多个仓库的任务状态与执行进度

---

## 1. HelloLoop 能做什么

把“开发文档 + 现有代码 + 持续执行 + 可视化跟踪”收口成一条标准流程：

1. 自动识别项目仓库与开发文档
2. 分析当前进度、偏差和剩余任务
3. 生成 / 刷新 `.helloloop/backlog.json`
4. 输出中文确认单
5. 确认后持续执行、验证、复核
6. 中断后支持继续接续，而不是重新来一遍

---

## 2. 最适合的使用场景

- 按架构文档、PRD、任务拆解持续完成仓库开发
- 多仓并行推进，需要统一看板跟踪
- 任务需要跑很久，不希望因为一次中断就全部停掉
- 需要让主终端、TUI 看板、Web 看板都能看到当前状态
- 需要在 `Codex CLI` / `Claude Code` / `Gemini CLI` 之间保持一致体验

不适合的场景：

- 只改一个很小的文件
- 单轮对话就能完成的简单问答
- 不允许自动修改文件、只想人工讨论方案

---

## 3. 核心能力

- 显式调用才接管，不会默默劫持普通对话
- 自动对齐“开发文档目标”与“当前代码事实”
- 分析、执行、验证、任务复核、主线终态复核一体化
- 默认后台执行，但当前终端可以继续实时观察
- 宿主中断后可输出自然语言续跑提示
- 提供终端 TUI 总控台
- 提供本地 Web 看板
- 提供结构化 JSON 状态流，方便上层程序消费
- Windows 下尽量隐藏后台控制台，避免频繁弹窗 / 闪烁

---

## 4. 支持的宿主

| 宿主 | 调用方式 |
| --- | --- |
| `Codex CLI` | `Codex` 内输入 `$helloloop` / `#helloloop` / `helloloop:helloloop` |
| `Claude Code` | `/helloloop` |
| `Gemini CLI` | `/helloloop` |
| 普通终端 | `npx helloloop` |

说明：

- 只有用户显式调用时才进入 HelloLoop
- 只是在对话里提到 `helloloop` 仓库、README、命令示例，不算调用

---

## 5. 安装

### 安装到 Codex

```bash
npx helloloop install --host codex
```

### 安装到 Claude Code

```bash
npx helloloop install --host claude
```

### 安装到 Gemini CLI

```bash
npx helloloop install --host gemini
```

### 一次装到全部宿主

```bash
npx helloloop install --host all
```

---

## 6. 最快上手

### 只让 HelloLoop 自己判断

```bash
npx helloloop
```

### 指定开发文档或项目路径

```bash
npx helloloop <PATH>
```

`<PATH>` 可以是：

- 项目仓库目录
- 开发文档目录
- 开发文档文件

### 明确指定执行引擎

```bash
npx helloloop codex
npx helloloop claude
npx helloloop gemini
```

### 跳过确认直接开始

```bash
npx helloloop -y
```

### 只分析，不执行

```bash
npx helloloop --dry-run
```

---

## 7. 常见使用方式

### 场景 A：根据文档持续完成一个仓库

```bash
npx helloloop "D:\GitHub\dev\hellomind-codex\docs"
```

### 场景 B：指定仓库并补充自然语言要求

```bash
npx helloloop "D:\GitHub\dev\repo" 先对齐开发文档，再继续完成剩余任务
```

### 场景 C：强制某个引擎继续推进

```bash
npx helloloop codex "D:\GitHub\dev\repo" 接着做，不要重新分析无关内容
```

### 场景 D：宿主中断后继续接上

```bash
helloloop resume-host
```

如果要让上层程序读取结构化结果：

```bash
helloloop resume-host --json
```

---

## 8. 后台执行与继续观察

`HelloLoop` 的默认体验是：

- 自动执行时切到后台继续跑
- 当前终端仍可继续观察实时输出
- 当前 turn 被打断，不等于后台任务立即停止

如果你稍后想重新看进度：

```bash
helloloop watch
helloloop status --watch
```

如果你只想后台继续跑，前台命令立即返回：

```bash
helloloop run-loop --detach
helloloop run-once --detach
```

---

## 9. 看板与可视化

### 终端 TUI 总控台

```bash
helloloop dashboard
helloloop tui
helloloop dash
```

适合：

- 常驻一个终端看多仓任务
- 在仓库之间快速切换
- 查看 backlog 的待处理 / 进行中 / 已完成 / 阻塞 / 失败

快捷键：

- `← / →` 切换仓库
- `↑ / ↓` 滚动
- `1-9` 直达仓库
- `r` 刷新
- `q` 退出

### 本地 Web 看板

```bash
helloloop web
```

默认会启动一个本地 Web 服务，并输出访问地址。

可选参数：

```bash
helloloop web --port 3210
helloloop web --bind 127.0.0.1
helloloop web --stop
```

适合：

- 长时间像 Jira 一样挂着看板
- 多仓泳道 + 任务列跟踪
- 点击任务查看详情

### 给主代理或外部程序消费结构化状态

```bash
helloloop dashboard --json
helloloop dashboard --json --watch
helloloop dash -j --watch --poll-ms 2000
```

---

## 10. 常用命令速查

| 命令 | 作用 |
| --- | --- |
| `helloloop` | 分析并进入主流程 |
| `helloloop status` / `helloloop st` | 查看当前仓库状态 |
| `helloloop watch` / `helloloop w` | 重新附着后台会话 |
| `helloloop next` / `helloloop n` | 预览下一任务 |
| `helloloop run-once` / `helloloop once` | 执行一个任务 |
| `helloloop run-loop` / `helloloop loop` | 连续执行多个任务 |
| `helloloop dashboard` / `helloloop dash` | 打开终端总控台 |
| `helloloop tui` | 显式打开 TUI 看板 |
| `helloloop web` | 启动本地 Web 看板 |
| `helloloop resume-host` / `helloloop rh` | 输出宿主续跑提示 |
| `helloloop doctor` / `helloloop dr` | 诊断安装与运行环境 |
| `helloloop install` | 安装插件到宿主 |
| `helloloop uninstall` | 从宿主卸载插件 |

---

## 11. 短命令别名

如果你不想每次打很长：

```bash
helloloop dash
helloloop tui
helloloop web
helloloop st
helloloop w
helloloop rh
helloloop once
helloloop loop
```

---

## 12. 配置文件

全局设置位于：

```text
~/.helloloop/settings.json
```

常见配置包括：

- 观察层自动重试
- 后台守护保活
- 终端并发上限
- 告警邮箱

项目级运行状态位于目标仓库：

```text
<repo>/.helloloop/
```

其中通常会包含：

- backlog
- 运行状态
- supervisor 状态
- 宿主续跑信息
- runs 执行记录

---

## 13. Windows 使用说明

`HelloLoop` 会尽量把后台启动、内部调度和观察链做成隐藏模式，目标是：

- 不弹出空白 PowerShell 窗口
- 不让后台守护层反复闪烁控制台
- 主任务在后台继续跑，主终端只负责观察

但首次安装、系统权限、终端自身限制等因素仍可能影响最终表现。

如果你主要关心状态可视化，优先使用：

- `helloloop dashboard`
- `helloloop tui`
- `helloloop web`

---

## 14. 边界说明

`HelloLoop` 不会做这些事：

- 不会在普通对话里静默接管当前宿主
- 不会在未确认时默认清空已有项目目录
- 不会因为一条“已完成”回复就直接宣称任务真正完成
- 不会在恢复阶段偷偷切换到别的引擎

---

## 15. 推荐工作方式

### 个人开发者

- 用 `npx helloloop` 或宿主内显式调用开始
- 用 `watch` 看实时过程
- 用 `dashboard` / `tui` 看多仓状态

### 多仓联动开发

- 每个仓库各自维护 `.helloloop/`
- 用 `web` 看整体进度
- 用 `resume-host` 在主代理中断后继续接上

### 长时间任务

- 先确认后启动
- 让后台继续执行
- 用 `status` / `watch` / `dashboard` / `web` 轮流观察

---

## 16. 一句话理解

如果普通 CLI 像“单次回答助手”，那 `HelloLoop` 更像“持续推进开发任务的执行层 + 观察层 + 续跑层”。

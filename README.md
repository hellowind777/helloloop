# HelloLoop

`HelloLoop` 是一个面向 `Codex CLI`、`Claude Code`、`Gemini CLI` 的多宿主开发工作流插件，用来把“根据开发文档持续接续开发”变成一条可分析、可确认、可验证、可追踪的标准流程。

它有两层定位：

- `Codex CLI`：首发平台、参考实现、最佳体验路径
- `Claude Code` / `Gemini CLI`：各自按原生 agent 逻辑执行，但共享同一套 `.helloloop/` 工作流规范

Codex 路径的主工作流只有两种 CLI 入口：

```bash
npx helloloop
npx helloloop <PATH>
```

无论从哪个宿主进入，`HelloLoop` 都遵循同一条主线：

1. 自动识别项目仓库与开发文档
2. 分析当前代码与文档目标的真实差距
3. 生成或刷新目标仓库根目录下的 `.helloloop/`
4. 输出中文执行确认单
5. 用户确认后，继续按当前宿主的原生 agent 逻辑推进开发、测试和验收

## 目录

- [核心流程](#核心流程)
- [支持矩阵](#支持矩阵)
- [安装](#安装)
- [快速开始](#快速开始)
- [自动发现规则](#自动发现规则)
- [自动执行边界](#自动执行边界)
- [Doctor 检查](#doctor-检查)
- [命令速查](#命令速查)
- [状态目录](#状态目录)
- [Skill 用法](#skill-用法)
- [在 Codex 中使用](#在-codex-中使用)
- [跨平台与安全](#跨平台与安全)
- [仓库结构](#仓库结构)
- [许可证](#许可证)

## 核心流程

`HelloLoop` 的默认流程固定为 5 步：

1. 自动发现项目仓库与开发文档
2. 对比文档目标与当前代码，识别当前进度和偏差
3. 生成或刷新目标仓库根目录下的 `.helloloop/`
4. 输出执行确认单，明确展示仓库、文档、当前进度、待办任务、验证命令和执行边界
5. 用户确认后，自动推进后续开发、测试和验收，直到全部完成或遇到硬阻塞

如果分析识别出偏差修正任务，`HelloLoop` 会优先先收口偏差，再继续后面的开发任务。

工作流统一，但执行器分为两类：

- `Codex CLI`：通过 `npx helloloop` / `$helloloop` 进入，使用当前仓库内的 Node CLI 与 Codex 插件链路
- `Claude Code` / `Gemini CLI`：通过 `/helloloop` 进入，使用各自原生插件 / 扩展与 agent 工具链

## 支持矩阵

| 宿主 | 安装方式 | 原生使用入口 | 当前定位 |
| --- | --- | --- | --- |
| `Codex CLI` | `helloloop install --host codex` | `$helloloop` / `npx helloloop` | 首发平台、参考实现、最佳体验 |
| `Claude Code` | `helloloop install --host claude` | `/helloloop` | Claude 原生插件工作流 |
| `Gemini CLI` | `helloloop install --host gemini` | `/helloloop` | Gemini 原生扩展工作流 |

如果你希望一次性装好三家宿主：

```bash
npx helloloop install --host all
```

## 安装

### npm / npx

默认安装 `Codex` 宿主：

```bash
npx helloloop install --codex-home <CODEX_HOME>
```

安装到指定宿主：

```bash
npx helloloop install --host codex
npx helloloop install --host claude
npx helloloop install --host gemini
npx helloloop install --host all
```

可选 home 参数：

```bash
--codex-home <CODEX_HOME>
--claude-home <CLAUDE_HOME>
--gemini-home <GEMINI_HOME>
```

### 源码仓库

```bash
node ./scripts/helloloop.mjs install --codex-home <CODEX_HOME>
```

Windows PowerShell 也可以直接运行：

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\install-home-plugin.ps1 -CodexHome <CODEX_HOME>
```

安装完成后：

- Codex 会写入 `<CODEX_HOME>/plugins/helloloop`
- Claude 会写入 `<CLAUDE_HOME>/marketplaces/helloloop-local`
- Gemini 会写入 `<GEMINI_HOME>/extensions/helloloop`

如果你想在安装后做一次全宿主环境检查：

```bash
npx helloloop doctor --host all
```

## 快速开始

### 1. 选择宿主入口

```text
Codex   -> $helloloop / npx helloloop
Claude  -> /helloloop
Gemini  -> /helloloop
```

说明：

- `Codex` 路径下，`$helloloop` 与 `npx helloloop` 对齐同一主流程
- `Claude` 与 `Gemini` 路径下，`/helloloop` 会走各自原生 agent 执行逻辑
- 三家都会维护同一个 `.helloloop/` 状态目录规范

### 2. 进入项目仓库或开发文档目录

最短命令：

```bash
npx helloloop
```

如果你只知道一个路径，也可以只传一个：

```bash
npx helloloop <PATH>
```

这里的 `<PATH>` 可以是：

- 项目仓库路径
- 开发文档目录
- 开发文档文件

### 3. 查看执行确认单

分析完成后，`HelloLoop` 会展示一份执行确认单，至少包含：

- 识别出的目标仓库
- 识别出的开发文档
- 当前进度摘要
- 已实现事项
- 待完成事项
- 任务统计
- 首个待执行任务
- 验证命令预览
- 自动推进边界

### 4. 确认后自动继续执行

你确认后，`HelloLoop` 会：

- 按 backlog 顺序自动推进
- 每个任务都走当前宿主的原生 agent 执行与验证
- 遇到失败、风险超阈值、依赖未满足或环境硬阻塞时立即停下
- 把分析结果、状态和运行记录都写进目标仓库的 `.helloloop/`

如果你已经做了全局安装，也可以把 `npx helloloop` 简写成 `helloloop`。

如果你想手动查看或接管某一步，也可以使用：

```bash
npx helloloop status
npx helloloop next
npx helloloop run-once
```

## 自动发现规则

- 不传路径：默认分析当前目录
- 只传一个路径：自动判断它是仓库路径还是开发文档路径
- 当前目录是仓库：自动查找开发文档
- 当前目录是文档目录：自动尝试反推目标仓库
- 只给开发文档但无法推断仓库：停止并提示补充 `--repo`
- 只给仓库但找不到开发文档：停止并提示补充 `--docs`

推荐始终优先使用：

```bash
npx helloloop
npx helloloop <PATH>
```

只有自动发现无法收敛时，再补充高级参数：

```bash
npx helloloop --repo <REPO_ROOT> --docs <DOCS_PATH>
```

## 自动执行边界

默认主命令会在确认后尽量自动完成整轮 backlog，而不是只跑一个任务。

### 常用执行模式

```bash
npx helloloop
npx helloloop <PATH>
npx helloloop --dry-run
npx helloloop -y
```

含义如下：

- `npx helloloop`：分析 → 展示确认单 → 等待你确认 → 自动执行
- `npx helloloop <PATH>`：同上，但先用你给的单一路径做自动识别
- `npx helloloop --dry-run`：只分析并输出确认单，不真正开始执行
- `npx helloloop -y`：跳过交互确认，分析后直接自动执行

### 停止条件

出现以下情况时，`HelloLoop` 会停止并保留现场，而不是静默降级：

- 无法自动确定目标仓库或开发文档
- backlog 已存在失败任务、阻塞任务或未满足依赖
- 后续任务风险超出自动阈值，且你没有显式加 `--allow-high-risk`
- 验证命令失败
- 当前宿主 CLI、插件资产或 shell 环境不可安全执行

## Doctor 检查

你可以用 `doctor` 检查当前宿主是否已具备基本运行条件。

### 只检查 Codex

```bash
npx helloloop doctor
```

### 检查全部宿主

```bash
npx helloloop doctor --host all
```

### 检查已安装目录

```bash
npx helloloop doctor --host all --codex-home <CODEX_HOME> --claude-home <CLAUDE_HOME> --gemini-home <GEMINI_HOME>
```

`doctor` 当前可检查：

- 宿主 CLI 是否存在
- 本地运行时资产是否齐全
- 目标仓库 `.helloloop/` 基础文件是否存在
- 已安装宿主目录是否已写入对应插件 / 扩展

## 命令速查

| 命令 | 作用 |
| --- | --- |
| `analyze` | 主工作流；分析并输出确认单，确认后自动接续执行 |
| `status` | 查看 backlog 汇总与当前状态 |
| `next` | 预览下一任务，不真正执行 |
| `run-once` | 手动执行一个任务 |
| `run-loop` | 手动连续执行多个任务 |
| `doctor` | 检查所选宿主、运行时资产与目标仓库是否满足运行条件 |
| `init` | 手动初始化 `.helloloop/` 模板 |
| `install` | 安装插件到所选宿主目录 |

### 常用选项

| 选项 | 说明 |
| --- | --- |
| `-y`, `--yes` | 跳过交互确认，分析后直接开始执行 |
| `--dry-run` | 只分析并输出确认单，不真正开始执行 |
| `--host <name>` | 选择安装宿主：`codex`、`claude`、`gemini`、`all` |
| `--repo <dir>` | 高级选项：显式指定项目仓库根目录 |
| `--docs <dir\|file>` | 高级选项：显式指定开发文档目录或文件 |
| `--allow-high-risk` | 允许执行 `medium` 及以上风险任务 |
| `--max-tasks <n>` | 限制手动 `run-loop` 的最大任务数 |
| `--max-attempts <n>` | 单策略最大重试次数 |
| `--max-strategies <n>` | 单任务最大换路次数 |
| `--required-doc <path>` | 追加全局必读文档 |
| `--constraint <text>` | 追加全局实现约束 |
| `--codex-home <dir>` | 指定 Codex Home |
| `--claude-home <dir>` | 指定 Claude Home |
| `--gemini-home <dir>` | 指定 Gemini Home |
| `--config-dir <dir>` | 指定状态目录名，默认 `.helloloop` |
| `--force` | 覆盖已有安装目录 |

## 状态目录

`HelloLoop` 始终把运行状态写入目标仓库根目录，而不是插件目录自身。

默认目录：

```text
.helloloop/
├── backlog.json
├── policy.json
├── project.json
├── status.json
├── STATE.md
└── runs/
```

其中：

- `backlog.json`：分析后生成的任务队列
- `policy.json`：自动推进策略、重试上限和 Codex 参数
- `project.json`：开发文档入口和全局约束
- `status.json`：最近一次运行状态
- `STATE.md`：面向人的进度摘要
- `runs/`：提示词、stdout、stderr、验证日志等留痕

## Skill 用法

如果你已经把 `HelloLoop` 安装成 Codex 插件，也可以直接在 Codex 里调用：

```text
$helloloop
```

或：

```text
helloloop:helloloop
```

此时推荐理解为：

- `$helloloop` 是插件入口
- `npx helloloop` / `npx helloloop <PATH>` 是实际执行入口

也就是说，用户显式调用 `$helloloop` 时，目标行为应当与主命令保持一致：

1. 先自动识别仓库和开发文档
2. 再分析当前代码与文档目标
3. 再展示执行确认单
4. 最后在你确认后自动接续执行

如果当前目录无法判断目标仓库、缺少开发文档，或者你明确只想先讲解不执行，`HelloLoop` 才应该先停下来问你，而不是直接启动执行。

如果你安装的是 Claude 或 Gemini 宿主，则推荐直接使用：

```text
/helloloop
```

它们会按各自 CLI 的原生 agent 逻辑执行，但共享同一套 `.helloloop/` 工作流规范。

## 在 Codex 中使用

可以直接在当前 Codex 会话里运行：

```bash
npx helloloop
```

不需要重开终端。

如果你使用的是全局安装后的 `helloloop` 短命令，是否立刻可用取决于当前 shell 是否已经刷新 PATH。

安装为 Codex 插件后，推荐显式使用的 skill 名称是：

```text
helloloop:helloloop
```

## 跨平台与安全

`HelloLoop` 默认兼容 Windows、macOS 和 Linux。

### shell 策略

- Windows：`pwsh` → `bash`（如 Git Bash）→ `powershell`
- macOS / Linux：`bash` → `sh`
- Windows 不会回退到 `cmd.exe`

说明：

- `Codex` 路径由当前 Node CLI 严格控制 shell 选择
- `Claude` / `Gemini` 路径走各自原生插件 / 扩展，但仍应遵守 `HelloLoop` 的安全约束

### 内建兜底规则

当开发文档没有给出足够约束时，`HelloLoop` 会自动附加一层最低安全边界，包括但不限于：

- 代码是事实源
- 验证必须执行
- 不能静默失败
- 不能吞掉错误
- 危险命令必须阻断
- 路径与 shell 调用必须按跨平台安全方式执行

## 仓库结构

```text
helloloop/
├── .claude-plugin/
├── .codex-plugin/
├── bin/
├── docs/
├── hosts/
├── scripts/
├── skills/
├── src/
├── templates/
└── tests/
```

其中：

- `.claude-plugin/`：Claude plugin 元数据
- `.codex-plugin/`：Codex plugin 元数据
- `hosts/`：Claude marketplace/plugin 与 Gemini extension 的运行时资产
- `src/`：核心实现，例如路径发现、分析提示词、任务调度、执行与安装
- `tests/`：回归测试，覆盖 CLI、安装链路、bundle 结构和关键流程
- `templates/`：初始化目标仓库 `.helloloop/` 时写入的模板

## 许可证

`HelloLoop` 使用 `Apache-2.0`，许可证文件位于仓库根目录 `LICENSE`。

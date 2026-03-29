# HelloLoop

`HelloLoop` 是一个面向 Codex 的独立插件，用来把“按 backlog 持续推进仓库开发”这件事标准化、可追踪、可验证地跑起来。

它不只是在单轮对话里改一段代码，而是把任务队列、必读文档、执行约束、验证命令和运行记录统一放进目标仓库的 `.helloloop/` 目录，让 Codex 可以按明确流程持续接续开发。

命令入口按 `Node.js 20+` 设计，支持 Windows、macOS 和 Linux。

## 目录

- [HelloLoop 是什么](#helloloop-是什么)
- [核心能力](#核心能力)
- [适用场景](#适用场景)
- [安装](#安装)
- [快速开始](#快速开始)
- [命令速查](#命令速查)
- [状态目录](#状态目录)
- [工作机制](#工作机制)
- [仓库结构](#仓库结构)
- [相关文档](#相关文档)

## HelloLoop 是什么

`HelloLoop` 解决的是以下问题：

- 你的仓库里已经有开发文档、任务拆解或 backlog
- 你希望 Codex 能按顺序接着做，而不是每次都从头解释背景
- 你希望每一轮执行前都自动带上项目状态、必读文档和实现约束
- 你希望每次运行后都留下状态记录、验证结果和运行痕迹

围绕这个目标，`HelloLoop` 提供了一套明确的仓库内执行模型：

1. 从 backlog 中选择当前可执行任务
2. 汇总项目上下文、任务目标和约束
3. 生成面向 Codex 的执行提示
4. 调用 Codex 完成实现
5. 执行验证命令
6. 回写状态、日志和运行记录

## 核心能力

- **插件安装**：安装到 Codex Home，作为独立插件使用
- **仓库初始化**：在目标仓库生成 `.helloloop/` 状态目录
- **任务调度**：基于优先级、依赖、风险等级挑选下一任务
- **干跑预览**：先看下一任务、提示词和验证命令，再决定是否执行
- **单轮执行**：执行一个任务并回写结果
- **循环执行**：连续执行多个任务，直到完成、阻塞或达到上限
- **验证联动**：优先使用任务级验证命令，缺省时读取仓库验证配置
- **运行留痕**：把提示词、stdout、stderr、验证输出沉淀到 `runs/`

## 适用场景

- 你有一套开发文档，希望 Codex 接续完成后续开发
- 你有清晰 backlog，希望 AI 按队列逐项推进
- 你希望把“任务、约束、验证、结果”都放在仓库里长期维护
- 你希望执行失败后不是停住，而是能按既定策略继续推进
- 你希望多人协作时，每个人都能快速看懂当前任务状态

## 安装

### 通过 npm / npx 安装

```powershell
npx helloloop install --codex-home <CODEX_HOME>
```

### 从源码仓库安装

```powershell
node ./scripts/helloloop.mjs install --codex-home <CODEX_HOME>
```

如果你在 Windows 上更习惯 PowerShell，也可以使用：

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\install-home-plugin.ps1 -CodexHome <CODEX_HOME>
```

安装完成后，插件会被放到：

```text
<CODEX_HOME>\plugins\helloloop
```

同时会更新：

```text
<CODEX_HOME>\.agents\plugins\marketplace.json
```

## 快速开始

### 1. 安装插件

```powershell
npx helloloop install --codex-home <CODEX_HOME>
```

之后的日常命令推荐直接使用：

```powershell
npx helloloop <command> [options]
```

如果你已经全局安装过：

```powershell
helloloop <command> [options]
```

在 Codex 当前会话里，也可以直接运行同样的 `npx helloloop ...` 命令，不需要重开终端。

### 2. 在目标仓库初始化 `.helloloop/`

```powershell
npx helloloop init --repo <REPO_ROOT>
```

初始化完成后，模板会落在目标仓库根目录下的 `.helloloop/`，而不是插件目录本身。

### 3. 检查运行条件

```powershell
npx helloloop doctor --repo <REPO_ROOT>
```

### 4. 查看状态与下一任务

```powershell
npx helloloop status --repo <REPO_ROOT>
npx helloloop next --repo <REPO_ROOT>
```

### 5. 执行一个任务或连续执行

```powershell
npx helloloop run-once --repo <REPO_ROOT>
npx helloloop run-loop --repo <REPO_ROOT> --max-tasks 2
```

## 命令速查

| 命令 | 作用 |
| --- | --- |
| `install` | 安装插件到 Codex Home，并更新插件 marketplace |
| `init` | 初始化目标仓库的 `.helloloop/` |
| `doctor` | 检查 Codex、插件文件和目标仓库配置是否齐备 |
| `status` | 查看 backlog 汇总、当前状态和下一任务 |
| `next` | 生成下一任务预览，不真正调用 Codex |
| `run-once` | 执行一个任务 |
| `run-loop` | 连续执行多个任务 |

### 常用选项

| 选项 | 说明 |
| --- | --- |
| `--repo <dir>` | 目标仓库根目录，默认当前目录 |
| `--codex-home <dir>` | 指定 Codex Home |
| `--config-dir <dir>` | 指定状态目录名，默认 `.helloloop` |
| `--dry-run` | 只生成提示词和预览，不真正调用 Codex |
| `--task-id <id>` | 指定执行某个任务 |
| `--max-tasks <n>` | `run-loop` 最多执行的任务数 |
| `--max-attempts <n>` | 每种策略的最大重试次数 |
| `--max-strategies <n>` | 单任务最大换路次数 |
| `--allow-high-risk` | 允许执行 `medium` 及以上风险任务 |
| `--required-doc <path>` | 追加全局必读文档 |
| `--constraint <text>` | 追加全局实现约束 |
| `--force` | 覆盖已有安装目录 |

### Skill 名称

安装为 Codex 插件后，推荐显式使用：

```text
helloloop:helloloop
```

## 状态目录

`HelloLoop` 默认在目标仓库根目录创建 `.helloloop/`，用来保存 backlog、策略配置、运行状态和执行留痕。

典型结构如下：

```text
.helloloop/
├── backlog.json
├── policy.json
├── project.json
├── status.json
├── STATE.md
└── runs/
```

各文件作用如下：

- `backlog.json`：任务列表、优先级、风险、依赖、验收条件
- `policy.json`：循环上限、重试策略、Codex 执行参数
- `project.json`：全局必读文档、实现约束、任务规划提示
- `status.json`：最近一次运行的机器可读状态
- `STATE.md`：面向人的当前进展摘要
- `runs/`：每次执行的提示词、日志和验证输出

## 工作机制

### 任务模型

`backlog.json` 中的任务通常包含以下字段：

- `id`：任务唯一标识
- `title`：任务标题
- `status`：`pending`、`in_progress`、`done`、`failed`、`blocked`
- `priority`：`P0` 到 `P3`
- `risk`：`low`、`medium`、`high`、`critical`
- `goal`：本任务要达成的目标
- `docs`：执行前必须阅读的文档
- `paths`：本任务主要涉及的目录
- `acceptance`：验收条件
- `dependsOn`：依赖的上游任务
- `verify`：任务专属验证命令

### 执行流程

`HelloLoop` 在每一轮执行中会完成这些事情：

1. 找出当前可执行任务
2. 读取仓库状态、任务描述和必读文档
3. 生成清晰的 Codex 执行提示
4. 运行 Codex 完成开发
5. 执行验证命令
6. 更新任务状态和运行记录

### 风险控制

- 默认优先自动执行 `low` 风险任务
- 较高风险任务需要显式允许
- 存在未完成依赖时，任务不会被挑选执行
- 存在未收束的执行状态时，循环会停止并等待处理

## 仓库结构

```text
helloloop/
├── .codex-plugin/         # Codex 插件 manifest 与展示元数据
├── bin/                   # npm 命令入口
├── docs/                  # 补充说明文档
├── scripts/               # 安装脚本与 CLI 入口
├── skills/                # 插件技能
├── src/                   # 核心实现
├── templates/             # 初始化时写入 .helloloop/ 的模板
└── tests/                 # 回归测试
```

其中：

- `src/` 用来放 `HelloLoop` 的实际实现逻辑，例如任务选择、状态加载、执行流程、提示词生成和安装流程
- `tests/` 用来做回归验证，确保 CLI、模板、插件 bundle 和执行流程没有被改坏
- `templates/` 是初始化目标仓库时写入 `.helloloop/` 的模板来源

## 相关文档

- `docs/README.md`：插件 bundle 结构补充说明
- `docs/install.md`：安装说明
- `docs/plugin-standard.md`：官方插件结构与标准对照

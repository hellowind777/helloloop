# HelloLoop

`HelloLoop` 是一个面向 `Codex CLI`、`Claude Code`、`Gemini CLI` 的多宿主开发工作流插件，用来把“根据开发文档持续接续开发、测试、验收直到最终目标完成”收敛成一条统一、可确认、可追踪的标准流程。

它的定位很明确：

- `Codex CLI`：首发平台、参考实现、最佳体验路径
- `Claude Code` / `Gemini CLI`：各自按原生 agent 逻辑执行，但共享同一套 `.helloloop/` 工作流规范
- 三家都能安装、都能用、都原生执行开发，不是让一家的 CLI 去伪装成另一家

## 核心价值

- **一条主命令**：优先只用 `npx helloloop` 或 `npx helloloop <PATH>`
- **自动补全上下文**：自动识别开发文档、项目仓库、当前进度和偏差
- **先确认再执行**：真正改代码前先输出中文执行确认单
- **持续推进到底**：确认后继续开发、测试、验收，直到完成最终目标或遇到硬阻塞
- **跨宿主统一状态**：运行状态统一写入目标仓库根目录的 `.helloloop/`
- **跨平台安全**：兼容 Windows / macOS / Linux，Windows 不回退到 `cmd.exe`

## 支持矩阵

| 宿主 | 安装方式 | 原生入口 | 执行方式 |
| --- | --- | --- | --- |
| `Codex CLI` | `helloloop install --host codex` | `$helloloop` / `npx helloloop` | Codex 原生插件 + CLI |
| `Claude Code` | `helloloop install --host claude` | `/helloloop` | Claude 原生 marketplace / plugin |
| `Gemini CLI` | `helloloop install --host gemini` | `/helloloop` | Gemini 原生 extension |

## 默认工作流

无论从哪个宿主进入，`HelloLoop` 都遵循同一条主线：

1. 自动识别目标项目仓库与开发文档
2. 分析“代码当前做到哪里了”“与文档目标是否有偏差”“当前项目是否匹配文档目标”
3. 在目标仓库根目录创建或刷新 `.helloloop/`
4. 输出中文执行确认单
5. 用户确认后，按当前宿主的原生 agent 逻辑继续推进开发、测试和验收

如果分析发现当前实现已经偏离开发文档，`HelloLoop` 会优先先收口偏差，再继续后面的 backlog。

## 最短使用方式

推荐优先只记住下面两条：

```bash
npx helloloop
npx helloloop <PATH>
```

也支持在命令后继续附带路径和自然语言要求：

```bash
npx helloloop <PATH> <补充说明>
```

例如：

```bash
npx helloloop docs/plan.md ./demo-app 接续完成剩余开发内容，并严格执行测试和验收
```

这里的 `<PATH>` 可以是：

- 项目仓库路径
- 开发文档目录
- 开发文档文件

这里的 `<补充说明>` 可以是：

- 第二个显式路径
- 本次执行的额外要求
- 偏差修正、质量要求、交付目标等自然语言说明

## 自动发现与交互逻辑

### 1. 只输入 `npx helloloop`

如果你只输入：

```bash
npx helloloop
```

`HelloLoop` 会先快速扫描当前目录：

- 当前目录本身就是项目仓库或开发文档目录时，直接进入分析
- 当前目录更像“工作区”时，优先尝试使用顶层开发文档，再提示选择候选项目目录
- 当前目录没有明确开发文档时，不会直接报错，而是先列出：
  - 顶层文档文件
  - 顶层目录
  - 疑似项目目录
  然后再询问开发文档路径

### 2. 项目路径只问一次

对外只有“项目路径”这一个概念，不单独再追问“新项目路径”。

- 你输入已有目录 → 按现有项目继续分析
- 你输入不存在的目录 → 视为准备创建的新项目目录

也就是说，用户只需要提供一次项目路径。

### 3. 文档和项目缺一不可时会停下询问

以下情况不会硬猜：

- 给了开发文档，但无法定位项目仓库
- 给了项目路径，但无法定位开发文档
- 同时出现多个冲突的文档路径或项目路径

此时 `HelloLoop` 会暂停，并要求用户补充正确信息。

### 4. 命令 + 自然语言会一起分析

`HelloLoop` 不依赖固定中文关键词来做硬编码分流。

命令里的：

- 显式路径
- 中文自然语言
- 英文自然语言
- 其他语言的补充要求

都会一起进入分析与确认单，不会因为语言不同被静默忽略。

### 5. 现有项目与文档目标冲突时

如果当前项目目录已存在，但分析认为它与开发文档目标明显冲突，`HelloLoop` 不会直接清空目录，而是先提示你选择：

1. 继续在当前项目上尝试接续
2. 清理当前项目内容后按文档目标重建
3. 取消本次执行

如果你明确希望非交互模式下直接重建，可以使用：

```bash
npx helloloop --rebuild-existing
```

重建时会保留必要的仓库元数据和状态目录，例如 `.git`、`.gitignore`、`.gitattributes`、`.helloagents`、`.helloloop`。

## 执行确认单

真正开始开发前，`HelloLoop` 会先输出中文执行确认单。当前确认单至少包含：

- 路径判断与判断依据
- 本次命令补充输入
- 需求语义理解
- 项目匹配判断
- 目标仓库
- 开发文档
- 当前进度
- 已实现事项
- 待完成事项
- 任务统计
- 首个待执行任务
- 验证命令预览
- 自动执行停止条件

未确认前，不会正式修改代码。

## 安装

### npm / npx

默认安装到 `Codex`：

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

### 从源码仓库安装

```bash
node ./scripts/helloloop.mjs install --host codex
```

Windows PowerShell 也可以直接运行：

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\install-home-plugin.ps1 -CodexHome <CODEX_HOME>
```

### 升级、重装、切换分支

如果你已经安装过，但刚拉取了新版本、切换了分支、或想覆盖旧安装，直接重新执行：

```bash
npx helloloop install --host codex --force
npx helloloop install --host all --force
```

### 卸载

```bash
npx helloloop uninstall --host codex
npx helloloop uninstall --host claude
npx helloloop uninstall --host gemini
npx helloloop uninstall --host all
```

### 安装结果

安装完成后，运行时资产会写入：

- `Codex`：`<CODEX_HOME>/plugins/helloloop`
- `Claude`：`<CLAUDE_HOME>/plugins/marketplaces/helloloop-local` 与 `plugins/cache/helloloop-local/helloloop/<VERSION>`
- `Gemini`：`<GEMINI_HOME>/extensions/helloloop`

源码仓库里的 `docs/` 与 `tests/` 不会复制进运行时安装包。

## 使用入口

### Codex CLI

```text
$helloloop
```

或：

```bash
npx helloloop
npx helloloop <PATH>
```

`$helloloop` 的推荐行为与主命令保持一致：优先进入 `npx helloloop` 主流程，而不是在对话里手工模拟分析和续跑。

如果你显式使用技能名，也可以写：

```text
helloloop:helloloop
```

### Claude Code / Gemini CLI

```text
/helloloop
```

它们会按各自 CLI 的原生 agent 逻辑执行，但共享同一套 `.helloloop/` 工作流规范。

## 命令速查

| 命令 | 作用 |
| --- | --- |
| `helloloop` / `analyze` | 自动分析、展示确认单，并在确认后继续接续开发 |
| `install` | 安装运行时 bundle 到指定宿主 |
| `uninstall` | 从指定宿主卸载运行时 bundle 与注册信息 |
| `doctor` | 检查宿主环境、插件资产与目标仓库状态 |
| `init` | 手动初始化 `.helloloop/` 模板 |
| `status` | 查看 backlog 摘要和当前状态 |
| `next` | 生成下一任务的干跑预览 |
| `run-once` | 执行一个任务 |
| `run-loop` | 连续执行多个任务 |

常用选项：

| 选项 | 作用 |
| --- | --- |
| `--dry-run` | 只分析并输出确认单，不开始自动执行 |
| `-y` / `--yes` | 跳过交互确认，分析后直接执行 |
| `--repo <dir>` | 高级覆盖：显式指定项目仓库 |
| `--docs <dir|file>` | 高级覆盖：显式指定开发文档 |
| `--rebuild-existing` | 项目与文档冲突时，自动清理现有项目后重建 |
| `--host <name>` | 宿主：`codex` / `claude` / `gemini` / `all` |
| `--config-dir <dir>` | 状态目录名，默认 `.helloloop` |

手动控制示例：

```bash
npx helloloop status
npx helloloop next
npx helloloop run-once
```

## Doctor 检查

检查默认宿主：

```bash
npx helloloop doctor
```

检查全部宿主：

```bash
npx helloloop doctor --host all
```

检查指定安装目录：

```bash
npx helloloop doctor --host all --codex-home <CODEX_HOME> --claude-home <CLAUDE_HOME> --gemini-home <GEMINI_HOME>
```

`doctor` 的检查范围分两类：

- 在插件源码仓库中运行：主要检查 CLI、bundle 资产和宿主安装资产
- 在目标项目仓库中运行，或显式传入 `--repo`：还会检查 `.helloloop/backlog.json`、`project.json`、`policy.json`、`verify.yaml`

## `.helloloop/` 状态目录

`HelloLoop` 的 backlog、状态和运行记录始终写入目标仓库根目录下的：

```text
.helloloop/
├── backlog.json
├── policy.json
├── project.json
├── status.json
├── STATE.md
└── runs/
```

不会写回插件目录自身。

## 跨平台与安全

### Windows

- 优先使用 `pwsh`
- 也支持 `bash`（如 Git Bash）与 `powershell`
- 不回退到 `cmd.exe`
- 避免危险的嵌套命令、路径拼接删除和 `cmd` 风格破坏性流程

### macOS / Linux

- 优先使用 `bash`
- 如果没有 `bash`，回退到 `sh`

### 通用安全边界

- 不静默失败
- 不静默回退
- 不吞掉错误
- 真正执行前先确认
- 真正结束前先验证

## 仓库结构

```text
helloloop/
├── .claude-plugin/
├── .codex-plugin/
├── .github/
├── .helloagents/
├── bin/
├── docs/
├── hosts/
├── scripts/
├── skills/
├── src/
├── templates/
├── tests/
├── LICENSE
├── package.json
└── README.md
```

其中：

- `.codex-plugin/`：Codex 插件 manifest
- `.claude-plugin/`：Claude plugin manifest
- `hosts/`：Claude marketplace / Gemini extension 资产
- `skills/`：Codex 插件技能说明
- `src/`：发现、分析、执行、安装、卸载、doctor 等核心实现
- `templates/`：初始化目标仓库 `.helloloop/` 的模板
- `docs/` 与 `tests/`：源码仓库维护资料，不进入运行时安装包

## 许可证

`HelloLoop` 使用 `Apache-2.0`，许可证文件位于仓库根目录的 `LICENSE`。

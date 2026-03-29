# HelloLoop

`HelloLoop` 是一个面向 `Codex CLI`、`Claude Code`、`Gemini CLI` 的多宿主开发工作流插件，用来把“根据开发文档持续接续开发、测试、验收，直到最终目标完成”收敛成一条统一、可确认、可追踪的标准流程。

它的核心原则很简单：

- 三家都能安装、都能用、都按各自原生 agent 逻辑执行
- `Codex CLI` 仍然是首发平台、参考实现和最佳体验路径
- 运行状态统一写入目标仓库根目录的 `.helloloop/`
- 真正执行前先分析、先确认，执行中不静默失败、不静默切换

## 宿主与执行引擎

`HelloLoop` 区分两个概念：

- **宿主**：你从哪里进入，例如终端、`Codex`、`Claude`、`Gemini`
- **执行引擎**：真正负责本轮分析 / 开发 / 测试推进的 CLI

这意味着：

- 终端里执行 `npx helloloop` 时，不会再静默固定用 `Codex`
- 在 `Codex` 里触发 `$helloloop` 时，默认优先当前宿主 `Codex`
- 在 `Claude` / `Gemini` 原生命令里触发时，默认优先各自当前宿主
- 如果你在某个宿主里显式要求改用别的引擎，`HelloLoop` 会先确认，不会静默切换

## 支持矩阵

| 宿主 | 安装方式 | 原生入口 | 说明 |
| --- | --- | --- | --- |
| `Codex CLI` | `helloloop install --host codex` | `$helloloop` / `npx helloloop` | Codex 原生插件 + CLI |
| `Claude Code` | `helloloop install --host claude` | `/helloloop` | Claude 原生 marketplace / plugin |
| `Gemini CLI` | `helloloop install --host gemini` | `/helloloop` | Gemini 原生 extension |

## 最短使用方式

推荐先记住下面四种：

```bash
npx helloloop
npx helloloop <PATH>
npx helloloop claude
npx helloloop gemini <PATH> 接续完成剩余开发
```

其中：

- `<PATH>` 可以是项目仓库路径、开发文档目录、开发文档文件
- 命令后可以继续追加自然语言要求
- 不确定时，优先只输入 `npx helloloop`

## 执行引擎选择规则

默认选择顺序如下：

1. 命令首参数显式引擎：`codex` / `claude` / `gemini`
2. 当前宿主默认引擎
3. 项目上次引擎 / 项目默认引擎
4. 用户上次引擎 / 用户默认引擎
5. 当前唯一可用引擎
6. 多个可用但仍无结论时，停下来询问一次

补充说明：

- 首参只有第一个裸词会被解释为引擎；如果你真要把 `claude` 当目录名，请写成 `./claude`、`.\claude` 或绝对路径
- 命令后的自然语言如果明确提到 `codex`、`claude`、`gemini`，也会纳入意图判断
- `已安装` 不等于 `可继续执行`；如果当前引擎在运行中遇到登录失效、额度耗尽、429 限流等问题，`HelloLoop` 会暂停并询问是否切换到其他可用引擎

## 默认工作流

无论从哪个宿主进入，都遵循同一条主线：

1. 自动识别目标项目仓库与开发文档
2. 分析当前代码进度、偏差和项目匹配性
3. 在目标仓库根目录创建或刷新 `.helloloop/`
4. 输出中文执行确认单
5. 用户确认后，按选中的执行引擎持续推进开发、测试、验收
6. 每个任务完成后，自动做一次“任务完成复核”
7. backlog 暂时清空后，自动做一次“主线终态复核”

如果分析发现当前实现已经偏离开发文档，`HelloLoop` 会优先先收口偏差，再继续后面的 backlog。

这意味着：

- 不会因为执行引擎自己一句“已完成”就直接结束
- 如果只是部分完成，`HelloLoop` 会继续当前主线任务，而不是跳去做模型随口建议的别的事
- 如果 backlog 清空了，但主线终态复核仍发现文档目标还有缺口，`HelloLoop` 会自动重新分析并继续推进

## 自动发现与交互逻辑

### 1. 只输入 `npx helloloop`

如果你只输入：

```bash
npx helloloop
```

`HelloLoop` 会先快速扫描当前目录：

- 当前目录本身就是项目仓库或开发文档目录时，直接进入分析
- 当前目录更像工作区时，优先利用顶层文档，再提示选择候选项目目录
- 当前目录没有明确开发文档时，不会直接报错，而是先列出：
  - 顶层文档文件
  - 顶层目录
  - 疑似项目目录
  然后再询问开发文档路径

### 2. 项目路径只问一次

对外只有“项目路径”这一个概念：

- 输入已有目录 → 按现有项目继续分析
- 输入不存在的目录 → 视为准备创建的新项目目录

不会再额外追问一个“新项目路径”。

### 3. 文档和项目缺一不可时会停下询问

以下情况不会硬猜：

- 给了开发文档，但无法定位项目仓库
- 给了项目路径，但无法定位开发文档
- 同时出现多个冲突的文档路径或项目路径

### 4. 命令 + 自然语言会一起分析

`HelloLoop` 不依赖固定中文关键词做硬编码分流。

命令里的：

- 显式路径
- 中文自然语言
- 英文自然语言
- 其他语言的补充要求

都会一起进入分析和确认单，不会因为语言不同被静默忽略。

### 5. 现有项目与文档目标冲突时

如果当前项目目录已存在，但分析认为它与开发文档目标明显冲突，`HelloLoop` 不会直接清空目录，而是先提示你选择：

1. 继续在当前项目上尝试接续
2. 清理当前项目内容后按文档目标重建
3. 取消本次执行

如果你明确希望非交互模式下直接重建，可以使用：

```bash
npx helloloop --rebuild-existing
```

## 执行确认单

真正开始开发前，`HelloLoop` 会先输出中文执行确认单，至少包含：

- 路径判断与判断依据
- 本次命令补充输入
- 执行引擎
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

确认后，默认行为不是“跑一轮就停”，而是：

- 先按 backlog 执行当前颗粒度任务
- 每个任务完成后复核其验收是否真的闭合
- backlog 清空后再复核一次整个主线目标
- 只有“任务验收闭合 + 主线目标闭合 + 验证通过”才算真正结束

## 安装

### 通过 npm / npx

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

## 使用入口

### 终端

```bash
npx helloloop
npx helloloop <PATH>
npx helloloop codex <PATH>
npx helloloop claude <PATH>
npx helloloop gemini <PATH> <补充说明>
```

如果已经做了全局安装，也可以把 `npx helloloop` 简写为 `helloloop`。是否立刻可用取决于当前 shell 是否已经刷新 `PATH`。

### Codex CLI

```text
$helloloop
helloloop:helloloop
```

在 `Codex` 中也可以直接执行：

```bash
npx helloloop
```

默认优先当前宿主 `Codex`；如果你在 `Codex` 内显式要求改用 `Claude` / `Gemini`，会先确认再切换。

### Claude Code / Gemini CLI

```text
/helloloop
```

它们会按各自 CLI 的原生 agent 逻辑执行，但共享同一套 `.helloloop/` 工作流规范。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `helloloop` / `analyze` | 自动分析、展示确认单，并在确认后持续接续开发，直到主线目标闭合或遇到硬阻塞 |
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
| `codex` / `claude` / `gemini` | 作为 `analyze` 模式的命令首参数，显式指定执行引擎 |
| `--dry-run` | 只分析并输出确认单，不开始自动执行 |
| `-y` / `--yes` | 跳过交互确认，分析后直接执行 |
| `--repo <dir>` | 高级覆盖：显式指定项目仓库 |
| `--docs <dir|file>` | 高级覆盖：显式指定开发文档 |
| `--rebuild-existing` | 项目与文档冲突时，自动清理现有项目后重建 |
| `--host <name>` | 安装宿主：`codex` / `claude` / `gemini` / `all` |
| `--config-dir <dir>` | 状态目录名，默认 `.helloloop` |

手动控制示例：

```bash
npx helloloop status
npx helloloop next
npx helloloop run-once
```

## Doctor

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
- 不轻信执行引擎口头“已完成”

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

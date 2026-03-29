# HelloLoop

`HelloLoop` 是一个面向 Codex 的独立插件，用来把“根据开发文档接续推进仓库开发”这件事标准化、可追踪、可验证地跑起来。

它会先分析当前仓库真实代码与开发文档之间的差距，再把后续任务、运行状态、执行记录统一写入目标仓库根目录的 `.helloloop/`，让 Codex 能持续接着做，而不是每轮都重新交代背景。

命令入口按 `Node.js 20+` 设计，支持 Windows、macOS 和 Linux。

## 目录

- [核心定位](#核心定位)
- [安装](#安装)
- [快速开始](#快速开始)
- [路径规则](#路径规则)
- [安全底线](#安全底线)
- [命令速查](#命令速查)
- [状态目录](#状态目录)
- [在 Codex 中使用](#在-codex-中使用)
- [许可证](#许可证)
- [仓库结构](#仓库结构)
- [相关文档](#相关文档)

## 核心定位

`HelloLoop` 适合这样的场景：

- 仓库里已经有 `docs/`、方案包、任务文档或阶段说明
- 代码已经做了一部分，需要先判断“现在做到哪里了”
- 你希望自动生成足够细的后续 backlog，而不是得到一句“继续开发”
- 你希望后续每轮执行都带着状态、约束、文档和验证命令继续推进
- 你希望在开发文档约束不完整时，仍然有一层稳定、安全的执行底线

围绕这个目标，`HelloLoop` 做四件事：

1. 自动发现项目仓库与开发文档
2. 对比当前代码和文档目标，判断真实进度
3. 生成或刷新 `.helloloop/backlog.json`
4. 驱动 Codex 按 backlog 接续执行并留下运行记录

同时，`HelloLoop` 自带一层内建安全底线：

- 开发文档缺少必要约束时，自动补上默认工程约束
- Windows 端优先使用 `pwsh`，也支持 `bash`（如 Git Bash）和 `powershell`，但不回退到 `cmd`
- 所有流程都要求避免静默失败、危险命令和隐私信息泄露

## 安装

### npm / npx

```powershell
npx helloloop install --codex-home <CODEX_HOME>
```

### 源码仓库

```powershell
node ./scripts/helloloop.mjs install --codex-home <CODEX_HOME>
```

如果你在 Windows 上更习惯 PowerShell，也可以使用：

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\install-home-plugin.ps1 -CodexHome <CODEX_HOME>
```

安装完成后，插件会复制到 `<CODEX_HOME>/plugins/helloloop`，并更新 `<CODEX_HOME>/.agents/plugins/marketplace.json`。

## 快速开始

### 1. 安装插件

```powershell
npx helloloop install --codex-home <CODEX_HOME>
```

### 2. 进入目标项目或开发文档目录

最短命令就是：

```powershell
npx helloloop
```

默认规则如下：

- 当前目录是项目仓库根目录时：自动查找开发文档并分析当前进度
- 当前目录本身是开发文档目录时：优先尝试反推目标仓库
- 分析完成后：自动生成或刷新目标仓库根目录下的 `.helloloop/`

如果你只知道一个路径，也可以只传一个位置：

```powershell
npx helloloop <PATH>
```

这里的 `<PATH>` 只能传一个，可以是：

- 项目仓库路径
- 开发文档目录
- 开发文档文件

### 3. 查看下一任务

```powershell
npx helloloop next
```

### 4. 执行一次或连续执行

```powershell
npx helloloop run-once
npx helloloop run-loop --max-tasks 2
```

如果你已经做了全局安装，也可以把 `npx helloloop` 简写成 `helloloop`。

## 路径规则

- 不传路径：默认分析当前目录
- 只传一个路径：自动判断它是仓库路径还是开发文档路径
- 已给开发文档但无法确定仓库：停止并提示补充 `--repo`
- 已给仓库但找不到开发文档：停止并提示补充 `--docs`
- `--repo` 和 `--docs` 是高级覆盖选项，不是主工作流

推荐优先使用：

```powershell
npx helloloop
npx helloloop <PATH>
```

只有在自动发现无法收敛时，再显式补充：

```powershell
npx helloloop --repo <REPO_ROOT> --docs <DOCS_PATH>
```

## 安全底线

- `HelloLoop` 会始终附加一组内建安全底线，覆盖 shell 安全、EHRB 命令阻断、跨平台兼容和静默失败防护。
- 如果项目开发文档或 `.helloloop/project.json` 已有明确约束，则优先使用项目约束；内建安全底线继续作为最低边界。
- 如果项目没有给出必要约束，则自动启用默认工程约束，例如代码是事实源、体积控制、验证必须执行、阻塞必须明确说明。
- Windows 环境下，`HelloLoop` 优先使用 `pwsh`，也支持 `bash`（如 Git Bash）和 `powershell`；如果这些安全 shell 都不可用，会直接停止，而不是回退到 `cmd.exe`。
- macOS / Linux 环境下，`HelloLoop` 优先使用 `bash`，没有 `bash` 时再回退到 `sh`。

## 命令速查

| 命令 | 作用 |
| --- | --- |
| `analyze` | 自动发现仓库与开发文档，分析进度并刷新 `.helloloop/` |
| `next` | 预览下一任务，不真正执行 |
| `run-once` | 执行一个任务 |
| `run-loop` | 连续执行多个任务 |
| `status` | 查看 backlog 汇总与当前状态 |
| `doctor` | 检查 Codex、插件 bundle 与目标仓库是否满足运行条件 |
| `init` | 手动初始化 `.helloloop/` 模板 |
| `install` | 安装插件到 Codex Home |

除 `install` 外，其余命令都可以直接在目标仓库目录执行；如果不在目标仓库目录，也可以补一个路径：

```powershell
npx helloloop next <PATH>
npx helloloop run-once <PATH>
npx helloloop status <PATH>
```

### 常用选项

| 选项 | 说明 |
| --- | --- |
| `--repo <dir>` | 高级选项：显式指定项目仓库根目录 |
| `--docs <dir\|file>` | 高级选项：显式指定开发文档目录或文件 |
| `--codex-home <dir>` | 指定 Codex Home |
| `--config-dir <dir>` | 指定状态目录名，默认 `.helloloop` |
| `--dry-run` | 只生成提示和预览，不真正调用 Codex |
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

`HelloLoop` 默认在目标仓库根目录创建 `.helloloop/`，而不是写回插件目录自身。

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

各文件职责如下：

- `backlog.json`：接续开发任务列表
- `policy.json`：循环上限、重试策略和 Codex 参数
- `project.json`：开发文档入口和全局约束
- `status.json`：最近一次运行的机器可读状态
- `STATE.md`：面向人的当前进展摘要
- `runs/`：提示词、stdout、stderr、验证输出等运行留痕

## 在 Codex 中使用

可以。

- 在当前 Codex 会话里，直接运行 `npx helloloop ...` 即可，不需要重开终端
- 如果你使用的是全局安装后的 `helloloop` 短命令，是否需要新终端取决于你的 shell 是否已经刷新 PATH
- `HelloLoop` 负责组织分析、backlog 和执行流程，真正的代码分析与开发仍然通过本机 `codex` CLI 完成

## 许可证

`HelloLoop` 使用 `Apache-2.0` 许可证，许可证文件位于仓库根目录 `LICENSE`。

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

- `src/` 放 `HelloLoop` 的实际实现逻辑，例如路径发现、分析提示词生成、运行调度和安装流程
- `tests/` 放回归测试，确保 CLI、安装链路、bundle 结构和分析流程没有被改坏
- `templates/` 是初始化目标仓库时写入 `.helloloop/` 的模板来源

## 相关文档

- `docs/install.md`：安装与日常使用方式
- `docs/README.md`：插件 bundle 结构说明
- `docs/plugin-standard.md`：官方插件结构与当前实现映射

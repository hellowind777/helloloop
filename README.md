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

- 三宿主都只在用户显式调用 `helloloop` 时介入；普通会话不会被 HelloLoop 自动接管
- 在 `Codex` 中，只有显式输入 `$helloloop` / `#helloloop` / `helloloop:helloloop` 才算调用；仅仅提到 `helloloop` 仓库、README、代码、测试、release、npm 包名，都不算调用
- 无论在终端还是在 `Codex` / `Claude` / `Gemini` 宿主内，只要用户未明确指定引擎，`HelloLoop` 都会先询问本轮执行引擎
- 当前宿主、项目历史、用户历史只作为推荐依据，不会自动替你选中引擎
- 如果你已经显式指定，或已经在首轮确认中明确选定了引擎，本轮就固定按该引擎执行
- 如果后续因为登录、配额、限流等问题需要改用别的引擎，`HelloLoop` 也会先询问，不会静默切换

## 支持矩阵

| 宿主 | 安装方式 | 原生入口 | 说明 |
| --- | --- | --- | --- |
| `Codex CLI` | `helloloop install` / `helloloop install --host codex` | `Codex` 内：`$helloloop`；终端：`npx helloloop` | 仅在显式调用时进入 HelloLoop |
| `Claude Code` | `helloloop install --host claude` | `/helloloop` | 仅在显式调用时进入 HelloLoop |
| `Gemini CLI` | `helloloop install --host gemini` | `/helloloop` | 仅在显式调用时进入 HelloLoop |

补充说明：

- `install --host codex` 只会把 `HelloLoop` 注册成 `Codex` 插件，不会把 `helloloop` 写进系统 `PATH`
- 终端里的 `npx helloloop` 始终是 npm CLI 入口；如果本机未全局安装，首次执行出现 `Need to install the following packages` 属正常行为
- `Codex` 安装完成后，建议重启 `Codex` 或新开一个会话，再检查 `$helloloop`

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

执行规则如下：

1. 命令首参数显式引擎：`codex` / `claude` / `gemini`
2. 自然语言中明确且不歧义地指定了引擎
3. 如果前两步仍未明确，先停下来询问本轮执行引擎；当前宿主、项目上次 / 默认、用户上次 / 默认只作为推荐依据
4. `-y` / `--yes` 等非交互模式下，如果你没有显式指定引擎，`HelloLoop` 会直接停止并要求补充引擎

补充说明：

- 首参只有第一个裸词会被解释为引擎；如果你真要把 `claude` 当目录名，请写成 `./claude`、`.\claude` 或绝对路径
- 命令后的自然语言如果明确提到 `codex`、`claude`、`gemini`，也会纳入意图判断
- 当前宿主、项目历史、用户历史不会触发自动选中，只会影响“推荐项”
- `已安装` 不等于 `可继续执行`；如果当前引擎在运行中遇到 400、鉴权、欠费、429、5xx、网络抖动、流中断、长时间卡死等问题，`HelloLoop` 会先按无人值守策略做同引擎“健康探测 + 条件恢复”，不会中途停下来询问

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
- 如果模型只做了一半就想停下来给“下一步建议”，`HelloLoop` 会优先按主线目标继续推进，而不是把半成品当完成

## 无人值守恢复

`HelloLoop` 的设计目标不是“跑一轮停一轮”，而是启动前确认一次，启动后持续无人值守推进。

- 因此运行中的默认策略是：

- 普通运行故障不再中途提问：不会因为 429、5xx、网络抖动、结果流中断、短时空输出就停下来问用户
- 同引擎优先恢复：默认不会自动切换引擎，也不会偷偷改用别的 CLI
- 先探测、后续跑：重试前会先做最小健康探测；只有探测通过后，才会恢复主线任务，而不是盲目把完整任务再跑一遍
- 保留主线上下文恢复：同引擎恢复时会生成恢复记录与恢复 prompt，要求新一轮执行直接基于当前仓库状态继续，而不是从头另起一套
- 定时心跳检查：运行中会持续写入心跳与恢复状态，用于判断当前阶段是否还在正常推进
- 最终停止会告警：如果自动恢复额度真正用尽，且已配置全局邮箱，`HelloLoop` 会把错误类型与具体内容发到指定邮箱

默认恢复节奏：

- 心跳间隔：60 秒
- 疑似卡住预警：15 分钟无可见进展
- 自动终止阈值：45 分钟无可见进展
- 硬阻塞：每 15 分钟探测 1 次，共 5 次；仍失败则暂停等待人工介入
- 软阻塞：先每 15 分钟探测 5 次，再 30 分钟 2 次，再按 60 / 90 / 120 / 150 / 180 分钟各探测 1 次；仍失败则暂停等待人工介入

如果你明确指定或确认了本轮引擎，`HelloLoop` 在自动恢复阶段也会继续锁定该引擎，不会擅自切换。

## 全局告警配置

如果希望在“自动恢复彻底停止”后收到邮件告警，可在：

```text
~/.helloloop/settings.json
```

中配置邮件通知，例如：

```json
{
  "notifications": {
    "email": {
      "enabled": true,
      "to": ["you@example.com"],
      "from": "helloloop@example.com",
      "smtp": {
        "host": "smtp.example.com",
        "port": 465,
        "secure": true,
        "username": "helloloop@example.com",
        "passwordEnv": "HELLOLOOP_SMTP_PASSWORD"
      }
    }
  }
}
```

说明：

- 建议把 SMTP 密码放在环境变量里，不要明文写进配置文件
- 邮件只在“本轮不再继续自动重试”时发送，不会每次失败都刷屏

## 自动发现与交互逻辑

### 1. 只输入 `npx helloloop`

如果你只输入：

```bash
npx helloloop
```

`HelloLoop` 会先明确执行引擎，再快速扫描当前目录：

- 当前目录本身就是开发文档目录时，会先尝试从文档反推项目目录
- 当前目录看起来像普通项目目录时，默认直接把当前目录作为项目目录
- 当前目录更像工作区或用户主目录时，才会额外询问项目目录
- 如果当前项目目录下没有明确开发文档，会只提示补充“开发文档”这一项，并说明已检查的常见位置

### 2. 项目路径只问一次

对外只有“项目路径”这一个概念：

- 输入已有目录 → 按现有项目继续分析
- 输入不存在的目录 → 视为准备创建的新项目目录

不会再额外追问一个“新项目路径”。

### 3. 缺什么就只问什么

正常情况下只需要两项信息：

- 项目目录
- 开发文档

其中：

- 项目目录默认优先使用当前打开的目录
- 当前目录明显不是项目目录时，才会额外询问项目目录
- 开发文档缺失时，只会询问开发文档

以下情况不会硬猜：

- 给了开发文档，但仍无法定位项目目录
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
- 项目目录
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
- 运行中若出现可恢复的 CLI 故障，则按无人值守策略自动恢复，不打断主线

## 安装

### 通过 npm / npx

默认安装到 `Codex`：

```bash
npx helloloop install
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
npx helloloop install --force
npx helloloop install --host claude --force
npx helloloop install --host gemini --force
npx helloloop install --host codex --force
npx helloloop install --host all --force
```

说明：

- `--force` 会清理当前宿主里已有安装残留的 `helloloop` 目录后再重装
- `Codex` 会刷新 home 根下的插件源码目录、已安装缓存、`config.toml` 启用项和 marketplace 条目
- `Claude` 会刷新 marketplace、缓存插件目录，以及 `settings.json` / `known_marketplaces.json` / `installed_plugins.json` 中的 `helloloop` 条目
- `Gemini` 会刷新 `extensions/helloloop/`，不会动同目录下其他扩展
- 安装 / 升级 / 重装时，会同步校准 `~/.helloloop/settings.json` 的当前版本结构：补齐缺失项、清理未知项、保留已知项现有值
- 如果 `~/.helloloop/settings.json` 被确认不是合法 JSON，会先备份原文件，再按当前版本结构重建
- 如果只是首次读取时出现瞬时异常，但重读后内容合法，则不会误生成备份文件
- 如果宿主自己的配置 JSON（如 `Codex marketplace.json`、`Claude settings.json`、`known_marketplaces.json`、`installed_plugins.json`）本身已损坏，`HelloLoop` 会先明确报错并停止，不会先清理现有安装再失败

### 卸载

```bash
npx helloloop uninstall --host codex
npx helloloop uninstall --host claude
npx helloloop uninstall --host gemini
npx helloloop uninstall --host all
```

卸载是定向清理：

- 只删除 `helloloop` 自己的安装目录和注册条目
- 不会顺带删除别的插件、marketplace、扩展或自定义配置
- 即使某个宿主当前未安装 `helloloop`，也会安全退出，不做破坏性清理

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

在终端里（包括 `Codex` 打开的内置终端）也可以直接执行：

```bash
npx helloloop
```

如果你在 `Codex` 中直接使用 `$helloloop` 或 `npx helloloop`，但没有明确指定引擎，`HelloLoop` 仍会先让你确认本轮引擎；`Codex` 只会作为推荐项，不会被自动选中。
未显式调用 `$helloloop`、`helloloop:helloloop` 或 `npx helloloop` 时，普通 `Codex` 会话不会被 HelloLoop 自动接管。

### Claude Code / Gemini CLI

```text
/helloloop
```

它们会按各自 CLI 的原生 agent 逻辑执行，但共享同一套 `.helloloop/` 工作流规范。
只有在你显式调用 `/helloloop` 时，它们才会进入 HelloLoop 工作流；普通 Claude / Gemini 会话不会被自动接管。

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
| `-y` / `--yes` | 跳过执行确认直接开始；但如果未显式指定引擎，会直接报错而不是自动选引擎 |
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

## 宿主写入范围

为了方便排查安装 / 更新 / 卸载问题，下面是默认写入位置：

### `Codex CLI`

- 插件源码目录：`~/plugins/helloloop/`
- 已安装缓存：`~/.codex/plugins/cache/local-plugins/helloloop/local/`
- marketplace：`~/.agents/plugins/marketplace.json`
- 启用配置：`~/.codex/config.toml`

### `Claude Code`

- marketplace：`~/.claude/plugins/marketplaces/helloloop-local/`
- 已安装插件缓存：`~/.claude/plugins/cache/helloloop-local/helloloop/<VERSION>/`
- 用户配置：`~/.claude/settings.json`
- marketplace 索引：`~/.claude/plugins/known_marketplaces.json`
- 已安装插件索引：`~/.claude/plugins/installed_plugins.json`

### `Gemini CLI`

- 扩展目录：`~/.gemini/extensions/helloloop/`

`HelloLoop` 只维护自己的目录和自己的注册项，不会重写别的插件条目。

## 用户目录写入范围

全局用户目录 `~/.helloloop/` 只保留一份全局设置：

```text
~/.helloloop/
└── settings.json
```

说明：

- 这里不保存项目 backlog、状态、运行记录
- 安装 / 升级 / 重装时，会对 `settings.json` 做结构校准，但不会校验或篡改你已存在的已知项内容
- 只有在 `settings.json` 被确认非法时，才会先备份，再重建为当前版本结构
- 如果只是读取瞬时异常、重读后合法，不会误生成 `.bak`

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
也不会写入 `~/.helloloop/`。

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
- 不静默切换执行引擎
- 不吞掉错误
- 真正执行前先确认
- 真正结束前先验证
- 不轻信执行引擎口头“已完成”
- 不接受“先做一半再停下来问要不要继续”

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

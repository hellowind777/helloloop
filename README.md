# HelloLoop

`HelloLoop` 是一个面向 Codex 的 backlog 驱动开发插件。

它把持续开发所需的任务队列、执行策略、验证命令和运行记录集中到目标仓库的 `.helloagents/helloloop/` 目录里，并通过显式 CLI / skill 入口推动任务逐步落地。

## 目录

- [HelloLoop 是什么](#helloloop-是什么)
- [核心能力](#核心能力)
- [适用场景](#适用场景)
- [项目结构](#项目结构)
- [安装](#安装)
- [快速开始](#快速开始)
- [命令说明](#命令说明)
- [状态目录](#状态目录)
- [任务与执行模型](#任务与执行模型)
- [发布到 npm](#发布到-npm)
- [验证](#验证)
- [相关文档](#相关文档)

## HelloLoop 是什么

`HelloLoop` 解决的是“让 Codex 在同一个仓库里持续推进任务”这个问题。

与一次性执行单个改动不同，它围绕一份 backlog 运行：

- 先从 backlog 里选择当前最合适的任务
- 根据项目状态、必读文档和约束生成执行提示
- 调用 Codex 完成实现
- 运行验证命令确认结果
- 失败时按 Ralph Loop 思路重试或换路
- 把状态、结果和运行产物写回目标仓库

这意味着你可以把 `HelloLoop` 当成一个“面向仓库持续推进”的执行层，而不是单次脚本集合。

## 核心能力

- **插件安装**：把运行时 bundle 安装到 `~/.codex/plugins/helloloop`
- **仓库初始化**：为目标仓库生成 `.helloagents/helloloop/` 初始状态文件
- **任务选择**：基于优先级、依赖和风险等级选择下一任务
- **干跑预览**：先生成下一任务提示词和验证列表，再决定是否执行
- **单轮执行**：执行一个任务并回写状态
- **循环执行**：连续执行多个任务，直到达到上限或遇到阻塞
- **验证联动**：优先读取任务自身验证命令，否则回退到仓库 `.helloagents/verify.yaml`
- **运行留痕**：把每次执行的提示词、日志、验证输出保存到 `runs/`

## 适用场景

- 你已经有 backlog，希望 Codex 按队列持续推进
- 你希望每个任务执行前都自动带上项目状态和文档约束
- 你希望执行失败后自动进入重试或换路，而不是停在一次失败
- 你希望把任务状态、验证结果和运行痕迹沉淀在仓库内
- 你希望通过 npm 分发这个插件，并在 GitHub Tag 发布时自动同步到 npm

## 项目结构

```text
helloloop/
├── .codex-plugin/         # Codex 插件 manifest
├── bin/                   # npm bin 入口
├── docs/                  # 说明文档
├── scripts/               # CLI 安装脚本与入口
├── skills/                # 插件技能
├── src/                   # 核心实现
├── templates/             # 初始化模板
└── tests/                 # 回归测试
```

源码仓库包含 `docs/` 和 `tests/`，但安装到 Codex Home 时只会复制运行时必需文件。

## 安装

### 方式一：通过 npm / npx 安装

```powershell
npx helloloop install --codex-home C:\Users\hellowind\.codex
```

### 方式二：从源码仓库安装

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\install-home-plugin.ps1 -CodexHome C:\Users\hellowind\.codex
```

如果已存在同名安装目录，追加 `-Force` 或 `--force` 覆盖即可。

安装完成后，运行时文件会位于：

```text
C:\Users\hellowind\.codex\plugins\helloloop
```

同时会自动更新：

```text
C:\Users\hellowind\.codex\.agents\plugins\marketplace.json
```

## 快速开始

### 1. 安装插件

```powershell
npx helloloop install --codex-home C:\Users\hellowind\.codex
```

### 2. 在目标仓库初始化状态目录

```powershell
node C:\Users\hellowind\.codex\plugins\helloloop\scripts\helloloop.mjs init --repo D:\GitHub\dev\your-repo
```

### 3. 检查运行条件

```powershell
node C:\Users\hellowind\.codex\plugins\helloloop\scripts\helloloop.mjs doctor --repo D:\GitHub\dev\your-repo
```

### 4. 查看当前状态或下一任务

```powershell
node C:\Users\hellowind\.codex\plugins\helloloop\scripts\helloloop.mjs status --repo D:\GitHub\dev\your-repo
node C:\Users\hellowind\.codex\plugins\helloloop\scripts\helloloop.mjs next --repo D:\GitHub\dev\your-repo
```

### 5. 执行一个任务或连续执行

```powershell
node C:\Users\hellowind\.codex\plugins\helloloop\scripts\helloloop.mjs run-once --repo D:\GitHub\dev\your-repo
node C:\Users\hellowind\.codex\plugins\helloloop\scripts\helloloop.mjs run-loop --repo D:\GitHub\dev\your-repo --max-tasks 2
```

## 命令说明

| 命令 | 作用 |
| --- | --- |
| `install` | 安装插件到 Codex Home，并更新 marketplace |
| `init` | 初始化目标仓库 `.helloagents/helloloop/` |
| `doctor` | 检查 Codex CLI、模板、配置文件和插件文件是否齐备 |
| `status` | 查看 backlog 汇总与下一任务 |
| `next` | 干跑生成下一任务预览，不真正调用 Codex |
| `run-once` | 执行一个任务 |
| `run-loop` | 连续执行多个任务 |

### 常用选项

| 选项 | 说明 |
| --- | --- |
| `--repo <dir>` | 目标仓库根目录 |
| `--codex-home <dir>` | 指定 Codex Home |
| `--config-dir <dir>` | 自定义状态目录，默认 `.helloagents/helloloop` |
| `--dry-run` | 只生成提示词和预览，不真正调用 Codex |
| `--task-id <id>` | 指定执行某个任务 |
| `--max-tasks <n>` | `run-loop` 最多执行多少个任务 |
| `--max-attempts <n>` | 每种策略内最大重试次数 |
| `--max-strategies <n>` | 单任务最大换路次数 |
| `--allow-high-risk` | 允许执行 `medium` / `high` / `critical` 风险任务 |
| `--required-doc <path>` | 追加全局必读文档 |
| `--constraint <text>` | 追加全局实现约束 |
| `--force` | 覆盖安装目录 |

### Skill 名称

安装为 Codex 插件后，可通过插件命名空间使用：

```text
helloloop:helloloop
```

## 状态目录

`HelloLoop` 在目标仓库内使用 `.helloagents/helloloop/` 保存执行状态。

典型结构如下：

```text
.helloagents/helloloop/
├── backlog.json
├── policy.json
├── project.json
├── status.json
├── STATE.md
└── runs/
```

### 各文件作用

- `backlog.json`：任务列表、优先级、风险、验收条件、依赖关系
- `policy.json`：循环上限、重试次数、Codex 执行参数
- `project.json`：全局必读文档、实现约束和 planner 配置
- `status.json`：机器可读的最近运行状态
- `STATE.md`：给人看的当前状态摘要
- `runs/`：每次任务执行的提示词、stdout、stderr 和验证记录

## 任务与执行模型

### backlog 任务字段

`backlog.json` 中的任务通常包含这些字段：

- `id`：任务唯一标识
- `title`：任务标题
- `status`：`pending` / `in_progress` / `done` / `failed` / `blocked`
- `priority`：`P0` 到 `P3`
- `risk`：`low` / `medium` / `high` / `critical`
- `goal`：任务目标
- `docs`：执行前必读文档
- `paths`：主要涉及目录
- `acceptance`：验收条件
- `dependsOn`：依赖的上游任务
- `verify`：任务专属验证命令（可选）

### 执行流程

`HelloLoop` 的核心执行逻辑如下：

1. 从 backlog 中筛出可执行任务
2. 按优先级和依赖关系选择下一任务
3. 读取仓库状态、必读文档和实现约束
4. 生成 Codex 执行提示词
5. 调用 `codex exec`
6. 运行验证命令
7. 成功则把任务标记为完成
8. 失败则按 Ralph Loop 记录失败历史并继续重试或换路

### 风险与阻塞规则

- 默认只自动执行 `low` 风险任务
- `medium` 及以上风险任务需要显式传入 `--allow-high-risk`
- 如果存在未收束的 `in_progress` 任务，新的自动执行会被阻塞
- 如果存在 `failed` 或 `blocked` 任务，执行会停下来等待处理
- 如果依赖任务未完成，相关任务不会被挑选执行

## 发布到 npm

仓库已加入自动发布工作流：

```text
.github/workflows/publish.yml
```

这个工作流借鉴了 `helloagents` 的发布结构，并做了适合 `HelloLoop` 的简化与对齐：

- 以 Git Tag 作为发布触发器
- 发布前校验 `package.json` 版本与 Tag 是否一致
- 自动运行 `npm test`
- 自动运行 `npm pack --dry-run`
- 自动发布到 npm
- 自动创建 GitHub Release

### 推荐发布方式

#### 正式版

1. 修改 `package.json` 中的 `version`
2. 提交并推送代码
3. 创建同版本 Tag

示例：

```powershell
npm version patch --no-git-tag-version
git add package.json
git commit -m "chore: release v0.1.1"
git push origin main
git tag v0.1.1
git push origin v0.1.1
```

推送 `v0.1.1` 后，Action 会把 `0.1.1` 发布到 npm 的 `latest` 通道。

#### Beta 版

Beta Tag 采用：

```text
v0.2.0-beta.1
```

这类 Tag 会发布到 npm 的 `beta` 通道。工作流会要求：

- `package.json` 中的基础版本为 `0.2.0`
- 实际发布版本为 `0.2.0-beta.1`

### npm Trusted Publishing 配置

为了让 GitHub Actions 无需 `NPM_TOKEN` 直接发布到 npm，建议使用 npm Trusted Publishing。

在 npm 包设置中把以下信息绑定为 Trusted Publisher：

- GitHub 仓库：`hellowind777/helloloop`
- Workflow 文件：`publish.yml`
- 触发来源：GitHub-hosted runner

发布工作流已经按 Trusted Publishing 方式准备好：

- `id-token: write`
- Node 24
- 升级到最新 npm CLI
- 直接执行 `npm publish`

### 工作流触发规则

- `push tags: v*`：标准自动发布入口
- `workflow_dispatch`：手动输入 Tag 重新发布某个版本

## 验证

### 本地回归

```powershell
npm test
```

### 打包预检

```powershell
npm pack --dry-run
```

### 安装烟测

```powershell
node .\bin\helloloop.mjs install --codex-home C:\Users\hellowind\AppData\Local\Temp\helloloop-smoke --force
```

## 相关文档

- 安装说明：`docs/install.md`
- 插件主说明：`docs/README.md`
- 官方标准映射：`docs/plugin-standard.md`

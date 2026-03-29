# HelloLoop 安装

本文说明 `HelloLoop` 如何安装到 `Codex CLI`、`Claude Code`、`Gemini CLI`，以及安装后的最短使用路径。

## 安装目标

安装完成后，目标目录结构应为：

```text
<CODEX_HOME>/
├── .agents/plugins/marketplace.json
└── plugins/
    └── helloloop/
        ├── .codex-plugin/
        ├── bin/
        ├── scripts/
        ├── skills/
        ├── src/
        └── templates/
```

`docs/` 和 `tests/` 属于源码仓库资料，不会复制进安装后的运行时 bundle。

其他宿主的安装结果：

```text
<CLAUDE_HOME>/
├── plugins/
│   ├── cache/helloloop-local/helloloop/<VERSION>/
│   ├── installed_plugins.json
│   ├── known_marketplaces.json
│   └── marketplaces/helloloop-local/
└── settings.json

<GEMINI_HOME>/
└── extensions/
    └── helloloop/
```

## 推荐安装

### 方案 A：npm / npx

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

安装后检查：

```bash
npx helloloop doctor --host all
```

### 方案 B：源码仓库

```bash
node ./scripts/helloloop.mjs install --codex-home <CODEX_HOME>
```

Windows PowerShell 也可以直接运行：

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\install-home-plugin.ps1 -CodexHome <CODEX_HOME>
```

如果目标目录已存在，追加 `--force` 或 `-Force` 即可覆盖。

其中：

- `Claude` 会按当前 CLI 的标准目录生成 marketplace、cache 与安装索引文件
- `Gemini` 会把扩展写入 `<GEMINI_HOME>/extensions/helloloop`

## 安装后怎么用

安装完成后，进入目标项目仓库或开发文档目录，按宿主优先直接运行：

```bash
npx helloloop
npx helloloop <PATH>
```

或在宿主内直接运行：

```text
Codex   -> $helloloop
Claude  -> /helloloop
Gemini  -> /helloloop
```

说明：

- `Codex` 路径使用当前仓库内的 `helloloop` CLI 和 Codex 插件逻辑
- `Claude` 与 `Gemini` 路径使用各自的原生插件 / 扩展与 agent 工具链
- 三条路径共享同一套 `.helloloop/` 工作流规范

默认行为是：

1. 自动识别仓库和开发文档
2. 分析当前代码与文档目标之间的差距
3. 生成执行确认单
4. 你确认后，按当前宿主的原生 agent 逻辑继续后续开发、测试和验收

如果你只想先看分析结果，不想立刻开始执行：

```bash
npx helloloop --dry-run
```

如果你已经确认过，想跳过交互提示：

```bash
npx helloloop -y
```

只有在自动发现无法确定仓库或文档时，再补充高级参数：

```bash
npx helloloop --repo <REPO_ROOT> --docs <DOCS_PATH>
```

如果已经做了全局安装，也可以把 `npx helloloop` 简写成 `helloloop`。

## Windows 说明

- `HelloLoop` 在 Windows 优先使用 `pwsh`，也支持 `bash`（如 Git Bash）和 `powershell`。
- `HelloLoop` 不会回退到 `cmd.exe`，以避免路径转义和嵌套命令带来的安全风险。
- 如果这些安全 shell 都不可用，`HelloLoop` 会直接停止并提示修复环境。

## 在 Codex 里执行

`npx helloloop ...` 可以直接在当前 Codex 会话里执行，不需要重开终端。

`helloloop ...` 这种短命令是否立即可用，取决于你的安装方式和当前 shell 是否已经刷新 PATH。

如果你是通过已安装 skill 的方式来调用，也就是在 Codex 里直接输入：

```text
$helloloop
```

那么推荐行为也应当与主命令一致：优先进入 `npx helloloop` / `npx helloloop <PATH>` 主流程，而不是在对话里手工模拟分析和续跑。

Claude 与 Gemini 则走各自的原生插件 / 扩展命令，但共享同一套 `.helloloop/` 工作流规范。

## Doctor 使用

### 检查默认 Codex 路径

```bash
npx helloloop doctor
```

### 检查全部宿主

```bash
npx helloloop doctor --host all
```

### 检查指定安装目录

```bash
npx helloloop doctor --host all --codex-home <CODEX_HOME> --claude-home <CLAUDE_HOME> --gemini-home <GEMINI_HOME>
```

## 状态目录位置

`HelloLoop` 的 backlog、状态和运行记录始终写入目标仓库根目录下的：

```text
.helloloop/
```

不会写回插件目录自身。

## 许可证

`HelloLoop` 使用 `Apache-2.0`，许可证文件为仓库根目录下的 `LICENSE`。

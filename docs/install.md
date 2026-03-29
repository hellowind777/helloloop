# HelloLoop 安装与维护

本文聚焦四件事：

1. 如何安装到 `Codex CLI`、`Claude Code`、`Gemini CLI`
2. 如何升级、重装、切换分支
3. 如何卸载和清理
4. 安装后最短怎么用

## 安装后的目标结构

### Codex

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

### Claude

```text
<CLAUDE_HOME>/
├── plugins/
│   ├── cache/helloloop-local/helloloop/<VERSION>/
│   ├── installed_plugins.json
│   ├── known_marketplaces.json
│   └── marketplaces/helloloop-local/
└── settings.json
```

### Gemini

```text
<GEMINI_HOME>/
└── extensions/
    └── helloloop/
```

说明：

- `docs/` 和 `tests/` 只属于源码仓库，不会复制进运行时安装包
- 运行状态始终写入目标项目仓库的 `.helloloop/`，不是写到上面的安装目录

## 推荐安装

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

### 通过源码仓库

```bash
node ./scripts/helloloop.mjs install --host codex
```

Windows PowerShell 也可以直接运行：

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\install-home-plugin.ps1 -CodexHome <CODEX_HOME>
```

## 升级、重装、切换分支

如果目标目录已存在，追加 `--force` 即可覆盖旧安装：

```bash
npx helloloop install --host codex --force
npx helloloop install --host all --force
```

适用场景：

- 拉取了新的提交
- 切换了 Git 分支
- 从旧版本升级到新版本
- 想清理旧 bundle 后重新覆盖

## 卸载

```bash
npx helloloop uninstall --host codex
npx helloloop uninstall --host claude
npx helloloop uninstall --host gemini
npx helloloop uninstall --host all
```

卸载会清理：

- `Codex`：插件目录与 marketplace 注册项
- `Claude`：marketplace、cache、安装索引和 `settings.json` 中的启用记录
- `Gemini`：扩展目录

## 安装后如何使用

最短命令：

```bash
npx helloloop
npx helloloop <PATH>
```

也支持路径 + 自然语言混合输入：

```bash
npx helloloop <PATH> <补充说明>
```

宿主内的原生入口：

```text
Codex   -> $helloloop
Claude  -> /helloloop
Gemini  -> /helloloop
```

默认行为是：

1. 自动识别项目仓库与开发文档
2. 分析当前代码与文档目标的真实差距
3. 生成中文执行确认单
4. 用户确认后，继续按当前宿主的原生 agent 逻辑执行开发、测试和验收

## 交互补充说明

- 如果当前目录更像工作区，`HelloLoop` 会优先利用顶层文档，并提示选择候选项目目录
- 如果没有识别到明确开发文档，会先展示顶层文档文件、顶层目录和疑似项目目录，再询问文档路径
- 项目路径只问一次：已有目录按现有项目处理，不存在的目录按新项目路径处理
- 如果当前项目与开发文档目标明显冲突，会先确认是继续、重建还是取消
- 如果希望非交互直接按重建方案执行，可追加 `--rebuild-existing`

## 常用执行选项

只看分析，不正式执行：

```bash
npx helloloop --dry-run
```

跳过确认直接开始：

```bash
npx helloloop -y
```

只有自动发现无法收敛时，再显式补充：

```bash
npx helloloop --repo <PROJECT_ROOT> --docs <DOCS_PATH>
```

如果已经做了全局安装，也可以把 `npx helloloop` 简写为 `helloloop`。是否立刻可用取决于当前 shell 是否已经刷新 `PATH`。

## 在 Codex 中使用

`npx helloloop ...` 可以直接在当前 Codex 会话里执行，不需要重开终端。

如果通过技能入口调用，也就是：

```text
$helloloop
```

推荐行为仍然应与主命令一致：优先进入 `npx helloloop` 主流程，而不是在对话里手工模拟分析和续跑。

## Doctor

检查默认宿主：

```bash
npx helloloop doctor
```

检查全部宿主：

```bash
npx helloloop doctor --host all
```

检查指定 home：

```bash
npx helloloop doctor --host all --codex-home <CODEX_HOME> --claude-home <CLAUDE_HOME> --gemini-home <GEMINI_HOME>
```

## 状态目录位置

```text
.helloloop/
```

`HelloLoop` 的 backlog、状态和运行记录始终写入目标项目仓库根目录，不会写回插件自身目录。

## 跨平台说明

- Windows：优先 `pwsh`，也支持 `bash` 和 `powershell`，不回退到 `cmd.exe`
- macOS / Linux：优先 `bash`，缺失时回退 `sh`
- 所有平台都遵循先确认、后执行、再验证的安全边界

## 许可证

`HelloLoop` 使用 `Apache-2.0`，许可证文件位于仓库根目录 `LICENSE`。

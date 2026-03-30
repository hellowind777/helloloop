# HelloLoop 安装与维护

本文聚焦四件事：

1. 如何安装到 `Codex CLI`、`Claude Code`、`Gemini CLI`
2. 如何升级、重装、切换分支
3. 如何卸载和清理
4. 安装后最短怎么用

## 安装后的目标结构

### Codex

```text
<HOME>/
├── .agents/plugins/marketplace.json
└── plugins/
    └── helloloop/
        ├── .codex-plugin/
        ├── bin/
        ├── scripts/
        ├── skills/
        ├── src/
        └── templates/

<CODEX_HOME>/
├── config.toml
└── plugins/
    └── cache/local-plugins/helloloop/local/
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
- 运行状态始终写入目标项目仓库的 `.helloloop/`

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
- 需要覆盖已有安装残留
- 想清理旧 bundle 后重新覆盖

## 卸载

```bash
npx helloloop uninstall --host codex
npx helloloop uninstall --host claude
npx helloloop uninstall --host gemini
npx helloloop uninstall --host all
```

卸载会清理：

- `Codex`：home 根插件源码目录、已安装缓存、`config.toml` 启用项与 marketplace 注册项
- `Claude`：marketplace、cache、安装索引和 `settings.json` 中的启用记录
- `Gemini`：扩展目录

## 安装后如何使用

最短命令：

```bash
npx helloloop
npx helloloop <PATH>
npx helloloop claude
npx helloloop gemini <PATH> <补充说明>
```

宿主内的原生入口：

```text
Codex   -> $helloloop
Claude  -> /helloloop
Gemini  -> /helloloop
```

补充说明：

- `install --host codex` 只会把插件注册进 `Codex`，不会把 `helloloop` 命令写进系统 `PATH`
- 终端里的 `npx helloloop` 仍然是 npm CLI 入口；如果本机未全局安装，首次执行提示拉取 npm 包属于正常行为
- 安装完成后建议重启 `Codex` 或新开会话，再检查 `$helloloop`

默认行为：

1. 自动识别项目仓库与开发文档
2. 先明确并询问本次执行引擎
3. 分析当前代码与文档目标的真实差距
4. 生成中文执行确认单
5. 用户确认后，继续按所选引擎推进开发、测试和验收
6. 每个任务完成后，会再做一次任务完成复核
7. backlog 清空后，会再做一次主线终态复核；若仍有缺口则自动继续

## 引擎选择补充说明

- `npx helloloop codex`
- `npx helloloop claude <PATH>`
- `npx helloloop gemini <PATH> 接续开发`

如果命令首参数没有显式指定执行引擎，则：

1. 先分析当前宿主、项目上次 / 默认引擎、用户上次 / 默认引擎与当前可用引擎
2. 上述信息只作为推荐依据，不会自动选中
3. 无论可用引擎数量多少，只要用户未明确指定，都先询问用户一次

如果当前引擎在运行中遇到 400、鉴权、余额、429、5xx、网络抖动或长时间卡死，`HelloLoop` 会先按同引擎“健康探测 + 条件恢复”链路继续尝试；只有重试额度真正用尽后才暂停，不会自动切换引擎。

默认恢复节奏：

- 硬阻塞：每 15 分钟探测 1 次，共 5 次
- 软阻塞：先每 15 分钟探测 5 次，再 30 分钟 2 次，再按 60 / 90 / 120 / 150 / 180 分钟各探测 1 次
- 最终停止后：若 `~/.helloloop/settings.json` 已配置邮箱，则自动发送告警邮件

## 交互补充说明

- 如果当前目录看起来像普通项目目录，`HelloLoop` 默认直接把当前目录当作项目目录
- 如果当前目录更像工作区或用户主目录，`HelloLoop` 才会额外询问项目目录
- 如果没有识别到明确开发文档，只会提示补充开发文档，并说明已检查的常见位置
- 项目路径只问一次：已有目录按现有项目处理，不存在的目录按新项目路径处理
- 如果当前项目与开发文档目标明显冲突，会先确认是继续、重建还是取消
- 如果希望非交互直接按重建方案执行，可追加 `--rebuild-existing`
- 如果执行引擎只是部分完成当前任务，`HelloLoop` 会继续收口当前主线任务，而不是直接结束

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

## 在 Codex 中使用

`$helloloop` 是 `Codex` 对话内的插件入口；`npx helloloop ...` 是终端 CLI 入口，可在系统终端或 `Codex` 的内置终端里执行。

如果通过技能入口调用，也就是：

```text
$helloloop
```

推荐行为仍然与主命令一致：优先进入 `npx helloloop` 主流程。若在 `Codex` 内显式要求改用 `Claude` / `Gemini`，会先确认再切换。

## Doctor

```bash
npx helloloop doctor
npx helloloop doctor --host all
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
- 所有平台都遵循先确认、后执行、再验证、再复核的安全边界

## 许可证

`HelloLoop` 使用 `Apache-2.0`，许可证文件位于仓库根目录 `LICENSE`。

# HelloLoop 插件标准映射

本文回答三个问题：

1. `HelloLoop` 如何符合 `Codex` 最新测试版插件目录标准
2. `HelloLoop` 如何同时兼容 `Claude Code` 与 `Gemini CLI`
3. `HelloLoop` 的主交互契约为什么设计成“先分析、再确认、再原生执行”

## 上游核对快照

本次对齐使用的上游快照：

- `openai/codex`：`6a0c4709ca2154e9f3ebb07e58fb156386630188`
- `openai/plugins`：`c33798c8a1e6da61a75e06e33ceae39a35f05ea5`
- 本地 `codex --version`：`0.117.0`

## Codex 官方目录标准

`Codex` 当前插件目录的稳妥形态是：

```text
<plugin-root>/
├── .codex-plugin/plugin.json
├── skills/
├── .app.json          # 可选
├── .mcp.json          # 可选
├── assets/            # 可选
└── 其他伴随文件
```

本地 marketplace 入口位于：

```text
<CODEX_HOME>/.agents/plugins/marketplace.json
```

## HelloLoop 的落地映射

### 插件根目录

`HelloLoop` 当前在源码仓库根目录直接作为插件根目录，不再额外包一层子目录。

核心映射如下：

- `.codex-plugin/plugin.json`
- `.claude-plugin/plugin.json`
- `skills/helloloop/SKILL.md`
- `bin/helloloop.js`
- `scripts/helloloop.mjs`
- `src/`
- `templates/`
- `hosts/claude/...`
- `hosts/gemini/...`

### 外部注册

- `Codex`：`<CODEX_HOME>/.agents/plugins/marketplace.json` 指向 `./plugins/helloloop`
- `Claude`：写入本地 marketplace、cache、known marketplaces、installed plugins 与 settings 启用项
- `Gemini`：写入 `~/.gemini/extensions/helloloop`

### 目标仓库状态

开发过程中的 backlog、状态和运行记录统一写入目标仓库根目录：

```text
.helloloop/
```

这部分永远属于“目标项目”，不属于插件 bundle 本身。

## 三宿主架构原则

`HelloLoop` 的正确架构不是“一家 CLI 兼容另外两家”，而是：

- 三家都能装
- 三家都能用
- 三家各自按自己的原生 agent 逻辑执行开发
- `Codex` 路径作为首发平台和参考实现，体验可以更完整

同时，`HelloLoop` 在实现上区分：

- **宿主**：从哪里进入
- **执行引擎**：真正负责本轮分析 / 开发 / 测试推进的 CLI

因此终端里的 `npx helloloop` 不会再静默固定用 `Codex`；只有命令首参数或自然语言明确指定了引擎时才会直接选定，否则当前宿主、项目/用户记忆和当前可用引擎只用于生成推荐项，并先停下来询问。

因此当前实现是：

- `Codex`：插件 skill + 本地 CLI
- `Claude`：原生 marketplace / plugin 指令
- `Gemini`：原生 extension 指令

## 主交互契约

当前交互契约固定为：

1. 优先使用 `npx helloloop`、`npx helloloop <PATH>`，也支持 `npx helloloop codex|claude|gemini`
2. 允许在命令后混合传入路径和自然语言要求
3. 先选择或确认本次执行引擎，再分析当前进度、偏差和项目匹配性
4. 先输出中文执行确认单
5. 用户确认后，再开始正式开发
6. 由所选引擎按当前宿主的原生逻辑持续推进；每个任务完成后要复核任务是否真正闭合，backlog 清空后还要复核主线目标是否真正闭合，直到最终目标完成且测试、验收通过

补充约束：

- 如果当前目录没有明确开发文档，先展示顶层文档文件、顶层目录和疑似项目目录，再询问文档路径
- 项目路径对外只有一个概念；若路径不存在，直接按新项目路径处理
- 如果现有项目与开发文档目标冲突，必须先确认继续、重建还是取消
- 非交互自动重建仅在显式追加 `--rebuild-existing` 时允许

## 当前设计结论

1. 当前目录自身就是插件根目录，不再额外包一层 `plugins/helloloop/`
2. 安装动作只负责复制运行时 bundle 并更新宿主注册信息
3. `docs/` 与 `tests/` 只保留在源码仓库，不进入运行时安装包
4. `.helloloop/` 永远属于目标项目，不属于插件 bundle
5. 日常工作流优先使用 `npx helloloop` 或 `npx helloloop <PATH>`
6. `Codex`、`Claude`、`Gemini` 都原生执行开发，不互相伪装
7. Windows 允许 `pwsh`、`bash`、`powershell` 等安全 shell，但不回退到 `cmd.exe`

## 发布约定

当前仓库按版本号触发自动发包与发布：

- Git tag：`vX.Y.Z` 或 `vX.Y.Z-beta.N`
- `package.json` 的基础版本必须与 tag 基础版本一致
- tag 推送后，GitHub Actions 会自动执行测试、`npm pack --dry-run`、`npm publish` 与 GitHub Release

这就是 `HelloLoop` 当前既符合 `Codex` 最新测试版插件结构，又能兼容三宿主原生工作流的实现方式。

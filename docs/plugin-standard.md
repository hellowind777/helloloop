# HelloLoop 插件标准映射

本文回答两个问题：

1. `HelloLoop` 如何按 `Codex` 最新插件标准组织
2. `HelloLoop` 如何同时兼容 `Claude Code` 与 `Gemini CLI` 的宿主资产

## 上游快照

本次核对使用的上游快照：

- `openai/codex`：`6a0c4709ca2154e9f3ebb07e58fb156386630188`
- `openai/plugins`：`c33798c8a1e6da61a75e06e33ceae39a35f05ea5`
- 本地 `codex --version`：`0.117.0`

## 官方目录标准

`openai/plugins` 当前给出的插件目录标准是：

```text
<plugin-root>/
├── .codex-plugin/plugin.json
├── skills/
├── .app.json          # 可选
├── .mcp.json          # 可选
├── assets/            # 可选
├── 其他伴随文件
```

市场入口位于插件目录之外：

```text
<codex-home>/.agents/plugins/marketplace.json
```

## 当前运行时自动加载的核心内容

`openai/codex` 当前运行时真正从插件 manifest 与约定目录中解析并接入的核心内容包括：

- `skills`
- `mcpServers`
- `apps`
- `interface`

这意味着当前最稳妥的官方插件形态，是把插件能力明确落在技能、脚本和本地 bundle 目录上。

## HelloLoop 的落地映射

`HelloLoop` 当前采用的标准映射如下：

### 插件根目录

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

- `<CODEX_HOME>/.agents/plugins/marketplace.json` 指向 `./plugins/helloloop`

### 目标仓库状态

- 运行状态、backlog 和执行记录统一写入目标仓库根目录 `.helloloop/`

## 当前设计结论

1. 当前目录自身就是插件根目录，不再额外包一层 `plugins/helloloop/`
2. 插件入口采用显式 skill 与 CLI，而不是依赖隐藏运行时路径
3. `.helloloop/` 目录属于目标仓库，不属于插件 bundle
4. 安装动作只负责复制运行时 bundle 并更新 marketplace
5. 日常工作流优先使用 `npx helloloop` 或 `npx helloloop <PATH>`
6. 主命令必须先展示执行确认单，再在用户确认后自动接续执行
7. `Claude` 与 `Gemini` 走各自原生 plugin / extension 工作流
8. Windows 端允许 `pwsh`、`bash`、`powershell` 这类安全 shell，但不允许回退到 `cmd.exe`

## 当前工作流

推荐的实际使用顺序：

```bash
npx helloloop install --codex-home <CODEX_HOME>
npx helloloop
```

主命令会自动完成：

1. 识别仓库和开发文档
2. 对比当前代码与文档目标
3. 生成 backlog 与状态目录
4. 输出执行确认单
5. 经确认后继续自动开发、测试和验收

如果只想先看分析结果：

```bash
npx helloloop --dry-run
```

如果自动发现无法判断仓库或开发文档，再补充：

```bash
npx helloloop --repo <REPO_ROOT> --docs <DOCS_PATH>
```

这就是当前源码边界下，既符合官方插件结构，又符合 `HelloLoop` 目标职责的实现方式。

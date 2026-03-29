---
name: helloloop
description: 当用户希望 Codex 先分析仓库当前进度、生成确认单，再自动按 backlog 持续接续开发时使用。
---

# HelloLoop

当任务目标不是单轮对话里改一点代码，而是要基于开发文档持续推进整个仓库时，使用这个插件。

## 强制入口规则

- 用户显式调用 `$helloloop` / `#helloloop` / `helloloop:helloloop` 时，默认必须优先执行 `npx helloloop` 或 `npx helloloop <PATH>`；如果用户又明确指定了执行引擎，也允许使用 `npx helloloop codex|claude|gemini ...`。
- 用户没有明确指定执行引擎时，不允许由 skill 自行补成 `codex` / `claude` / `gemini`；必须让 `HelloLoop` 先完成引擎确认。
- 不允许在对话里手工模拟 `HelloLoop` 的分析、确认单、backlog 编排和自动续跑流程来代替 CLI。
- 只有在以下情况，才允许先停下来问用户而不是直接执行 CLI：
  1. 用户既没有给路径，当前目录也无法判断项目仓库或开发文档
  2. 用户给了开发文档，但无法定位目标项目仓库
  3. 用户给了项目路径，但无法找到开发文档
  4. 用户明确要求先只讲解、不执行

## `$helloloop` 的默认执行映射

- 当前目录已经是目标项目仓库或开发文档目录 → 先执行 `npx helloloop --host-context codex`
- 用户给了单一路径 → 先执行 `npx helloloop --host-context codex <PATH>`
- 用户明确只想先看分析和确认单 → 执行 `npx helloloop --dry-run`
- 用户明确要求跳过确认直接开始 → 执行 `npx helloloop -y`
- 用户未明确指定执行引擎 → 保持命令里不带引擎首参数，让 `HelloLoop` 先做引擎确认；当前宿主只作为推荐依据
- 用户明确指定执行引擎 → 保留该引擎首参数；如果在 `Codex` 宿主内要求改用 `Claude` / `Gemini`，先确认，不允许静默切换
- 用户在命令后附带了额外路径或自然语言要求 → 必须把这些附加内容一并传给主 CLI，不允许丢弃或手工改写

## 附加输入处理规则

- 命令后的显式路径优先于自动发现结果。
- 命令后的非路径文本不靠关键词硬编码分流，而是作为“本次用户意图”原样传给 `HelloLoop` 的确认单与分析 prompt。
- 如果附加输入里同时包含文档路径、项目路径和额外要求，优先保留全部信息，再由 CLI 输出确认单统一确认。
- 不允许因为语言不同（中文 / 英文 / 其他语言）就忽略附加要求。

## 路径发现与提问规则

- 如果当前目录没有自动识别到明确开发文档，应先展示顶层文档文件、顶层目录和疑似项目目录，再要求用户补充文档路径。
- 项目路径对外只有一个概念，不要单独追问“新项目路径”。
- 如果用户输入的项目路径不存在，应直接把它视为准备创建的新项目目录。
- 如果自动发现同时出现多个冲突的文档路径或项目路径，不允许替用户猜测，必须停下来确认。

## 项目冲突规则

- 如果分析认为“当前项目目录已存在，但与开发文档目标明显冲突”，必须先提示用户选择继续、重建还是取消。
- 非交互模式下，只有显式追加 `--rebuild-existing`，才允许直接清理当前项目后重建。
- 未经确认，不允许默认清空现有项目目录。

## 插件边界

- 当前 bundle 根目录就是 `HelloLoop` 的官方插件目录。
- 插件元数据位于 `.codex-plugin/plugin.json`，执行逻辑位于 `skills/`、`bin/`、`scripts/`、`src/`、`templates/`。
- 运行状态统一写入目标仓库根目录下的 `.helloloop/`。

## 使用前准备

1. 先通过 `npx helloloop install --codex-home <CODEX_HOME>` 或 `scripts/install-home-plugin.ps1` 安装插件。
2. 打开目标项目仓库目录，或者打开开发文档所在目录。
3. 运行 `npx helloloop` 或 `npx helloloop <PATH>`。
4. 命中 `$helloloop` 后，优先按上面的默认执行映射直接调用 CLI。
5. `HelloLoop` 会先明确执行引擎，再自动分析并输出执行确认单。
6. 用户确认后，`HelloLoop` 才开始正式自动执行。

如果无法自动判断仓库路径或开发文档路径，就停下来提示用户补充；`--repo` 和 `--docs` 只作为显式覆盖选项使用。

## 工作模式

- 代码是事实源，开发文档是目标源。
- `HelloLoop` 会先分析当前真实进度，再生成或刷新 `.helloloop/backlog.json`。
- 分析后会展示中文执行确认单，明确告知路径判断、语义理解、项目匹配、当前进度、待办任务、验证命令和执行边界。
- 用户确认后，默认会持续执行到 backlog 清空且主线终态复核通过，或开发文档的最终目标完成且测试、验收通过，或遇到硬阻塞。
- 每个任务在执行引擎声称“完成”后，还必须再过一层任务完成复核；如果只是部分完成，继续当前主线任务，不直接结束。
- 用户需求明确且当前任务可直接完成时，必须一次性完成本轮应交付的全部工作；禁止做一半后用“如果你要”“是否继续”之类的话术停下，也禁止用客套套话收尾。
- 真正的代码分析与实现由本轮选中的 `codex` / `claude` / `gemini` CLI 原生完成。
- 如果当前引擎在运行中遇到 429、5xx、网络抖动、流中断或长时间卡死，必须优先按无人值守策略做同引擎自动恢复，不要中途停下来询问用户。
- 只有识别为 400 请求错误、登录/鉴权/订阅问题、本地 CLI 缺失或权限错误等硬阻塞时，才允许结束本轮自动执行。
- `$helloloop` 的职责是把用户请求路由到主 CLI 流程，而不是在对话里手工复刻一套平行流程。

## 核心命令

- `npx helloloop`
- `npx helloloop <PATH>`
- `npx helloloop codex`
- `npx helloloop claude <PATH>`
- `npx helloloop gemini <PATH> <补充说明>`
- `npx helloloop <PATH> <补充说明>`
- `npx helloloop --dry-run`
- `npx helloloop -y`
- `npx helloloop --rebuild-existing`

## 手动控制命令

- `npx helloloop status`
- `npx helloloop next`
- `npx helloloop run-once`
- `npx helloloop run-loop --max-tasks <n>`
- `npx helloloop doctor`
- `npx helloloop init`
- `npx helloloop install --host all`
- `npx helloloop uninstall --host all`

## 调用方式

- 在官方 Codex 插件模式下，明确的 skill 名称是 `helloloop:helloloop`。
- 在对话里显式提到 `helloloop` 插件，也会帮助 Codex 更准确地命中这个 skill。

## 参考文档

- 主说明：`README.md`
- 安装说明：`docs/install.md`
- Bundle 说明：`docs/README.md`
- 插件标准映射：`docs/plugin-standard.md`

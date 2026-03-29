---
name: helloloop
description: 当用户希望 Codex 先分析仓库当前进度、生成确认单，再自动按 backlog 持续接续开发时使用。
---

# HelloLoop

当任务目标不是单轮对话里改一点代码，而是要基于开发文档持续推进整个仓库时，使用这个插件。

## 强制入口规则

- 用户显式调用 `$helloloop` / `helloloop:helloloop` 时，默认必须优先执行 `npx helloloop` 或 `npx helloloop <PATH>`。
- 不允许在对话里手工模拟 `HelloLoop` 的分析、确认单、backlog 编排和自动续跑流程来代替 CLI。
- 只有在以下情况，才允许先停下来问用户而不是直接执行 CLI：
  1. 用户既没有给路径，当前目录也无法判断项目仓库或开发文档
  2. 用户给了开发文档，但无法定位目标项目仓库
  3. 用户给了项目路径，但无法找到开发文档
  4. 用户明确要求先只讲解、不执行

## `$helloloop` 的默认执行映射

- 当前目录已经是目标项目仓库或开发文档目录 → 先执行 `npx helloloop`
- 用户给了单一路径 → 先执行 `npx helloloop <PATH>`
- 用户明确只想先看分析和确认单 → 执行 `npx helloloop --dry-run`
- 用户明确要求跳过确认直接开始 → 执行 `npx helloloop -y`

## 插件边界

- 当前 bundle 根目录就是 `HelloLoop` 的官方插件目录。
- 插件元数据位于 `.codex-plugin/plugin.json`，执行逻辑位于 `skills/`、`bin/`、`scripts/`、`src/`、`templates/`。
- 运行状态统一写入目标仓库根目录下的 `.helloloop/`。

## 使用前准备

1. 先通过 `npx helloloop install --codex-home <CODEX_HOME>` 或 `scripts/install-home-plugin.ps1` 安装插件。
2. 打开目标项目仓库目录，或者打开开发文档所在目录。
3. 运行 `npx helloloop` 或 `npx helloloop <PATH>`。
4. 命中 `$helloloop` 后，优先按上面的默认执行映射直接调用 CLI。
5. `HelloLoop` 会先自动分析，再输出执行确认单。
6. 用户确认后，`HelloLoop` 才开始正式自动执行。

如果无法自动判断仓库路径或开发文档路径，就停下来提示用户补充；`--repo` 和 `--docs` 只作为显式覆盖选项使用。

## 工作模式

- 代码是事实源，开发文档是目标源。
- `HelloLoop` 会先分析当前真实进度，再生成或刷新 `.helloloop/backlog.json`。
- 分析后会展示执行确认单，明确告知当前进度、待办任务、验证命令和执行边界。
- 用户确认后，默认会持续执行到 backlog 清空或遇到硬阻塞。
- 真正的代码分析与实现仍由本机 `codex` CLI 完成。
- `$helloloop` 的职责是把用户请求路由到主 CLI 流程，而不是在对话里手工复刻一套平行流程。

## 核心命令

- `npx helloloop`
- `npx helloloop <PATH>`
- `npx helloloop --dry-run`
- `npx helloloop -y`

## 手动控制命令

- `npx helloloop status`
- `npx helloloop next`
- `npx helloloop run-once`
- `npx helloloop run-loop --max-tasks <n>`
- `npx helloloop doctor`
- `npx helloloop init`

## 调用方式

- 在官方 Codex 插件模式下，明确的 skill 名称是 `helloloop:helloloop`。
- 在对话里显式提到 `helloloop` 插件，也会帮助 Codex 更准确地命中这个 skill。

## 参考文档

- 主说明：`README.md`
- 安装说明：`docs/install.md`
- Bundle 说明：`docs/README.md`
- 插件标准映射：`docs/plugin-standard.md`

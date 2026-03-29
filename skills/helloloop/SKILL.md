---
name: helloloop
description: 当用户希望 Codex 先分析仓库当前进度，再生成 backlog 并按队列持续接续开发时使用。
---

# HelloLoop

当任务目标不是单轮对话里改一点代码，而是要基于开发文档持续推进整个仓库时，使用这个插件。

## 插件边界

- 当前 bundle 根目录就是 `HelloLoop` 的官方插件目录。
- 插件元数据位于 `.codex-plugin/plugin.json`，执行逻辑位于 `skills/`、`bin/`、`scripts/`、`src/`、`templates/`。
- 运行状态统一写入目标仓库根目录下的 `.helloloop/`。

## 使用前准备

1. 先通过 `npx helloloop install --codex-home <CODEX_HOME>` 或 `scripts/install-home-plugin.ps1` 安装插件。
2. 打开目标项目仓库目录，或者打开开发文档所在目录。
3. 运行 `npx helloloop` 或 `npx helloloop <path>`。
4. 如果无法自动判断仓库路径或开发文档路径，就停下来提示用户补充；`--repo` 和 `--docs` 只作为显式覆盖选项使用。

## 工作模式

- 代码是事实源，开发文档是目标源。
- `HelloLoop` 会先分析当前真实进度，再生成或刷新 `.helloloop/backlog.json`。
- 后续开发通过 `next`、`run-once`、`run-loop` 按 backlog 接续推进。
- 真正的代码分析与实现仍由本机 `codex` CLI 完成。

## 核心命令

- `npx helloloop`
- `npx helloloop <path>`
- `npx helloloop next`
- `npx helloloop run-once`
- `npx helloloop run-loop --max-tasks <n>`

## 高级命令

- `npx helloloop status`
- `npx helloloop doctor`
- `npx helloloop init`
- `npx helloloop --repo <repo-root> --docs <docs-path>`

## 调用方式

- 在官方 Codex 插件模式下，明确的 skill 名称是 `helloloop:helloloop`。
- 在对话里显式提到 `helloloop` 插件，也会帮助 Codex 更准确地命中这个 skill。

## 参考文档

- 主说明：`README.md`
- 安装说明：`docs/install.md`
- Bundle 说明：`docs/README.md`
- 插件标准映射：`docs/plugin-standard.md`

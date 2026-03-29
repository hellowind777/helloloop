# HelloLoop 插件标准映射

本文只回答一个问题：按 `openai/codex` 与 `openai/plugins` 的官方最新源码，独立目录版 `HelloLoop` 应该如何组织为官方标准插件。

## 上游快照

本次核对使用的上游仓库快照：

- `openai/codex` HEAD：`6a0c4709ca2154e9f3ebb07e58fb156386630188`
- `openai/plugins` HEAD：`c33798c8a1e6da61a75e06e33ceae39a35f05ea5`
- 本地 `codex --version`：`0.117.0`

## 官方仓库标准

`openai/plugins` 给出的插件目录标准是：

```text
<plugin-root>/
├── .codex-plugin/plugin.json
├── skills/
├── .app.json          # 可选
├── .mcp.json          # 可选
├── assets/            # 可选
├── hooks.json         # 可选伴随文件
├── agents/            # 可选伴随文件
└── commands/          # 可选伴随文件
```

市场入口固定在插件根目录之外：

```text
<codex-home>/.agents/plugins/marketplace.json
```

官方来源：

- `openai/plugins/README.md`
- `openai/codex/codex-rs/core/src/plugins/marketplace.rs`

## 当前 Codex 运行时真正自动加载的内容

`openai/codex` 当前运行时真正通过插件 manifest 解析并接入的字段只有：

- `skills`
- `mcpServers`
- `apps`
- `interface`

直接证据：

- `codex-rs/core/src/plugins/manifest.rs`
- `codex-rs/core/src/plugins/manager.rs`
- `codex-rs/core/src/plugins/render.rs`

其中：

- `manager.rs` 会自动发现默认 `skills/`、`.mcp.json`、`.app.json`
- 插件说明文案把插件定义为 “skills, MCP servers, and apps” 的本地 bundle

## Hook 的真实边界

Hook 当前仍然不走插件 manifest。

直接证据：

- `codex-rs/hooks/src/engine/discovery.rs`
- `codex-rs/hooks/src/events/user_prompt_submit.rs`
- `codex-rs/hooks/src/events/stop.rs`

运行方式是：

- 从配置层目录里的 `hooks.json` 发现 Hook
- 再按 `UserPromptSubmit`、`Stop` 等事件执行

这意味着：

- 把 `hooks` 写进 `plugin.json`，今天不会自动生效
- 插件目录里即使带了 `hooks.json`，它目前也只是“随插件分发的伴随文件”

## 官方标准与运行时的差异

这里有一个必须直说的差异：

- `openai/plugins` 仓库 README 允许插件目录包含 `hooks.json`
- 但 `openai/codex` 的当前运行时代码并没有从 `plugin.json` 自动加载 `hooks`

因此，不能把“官方仓库允许打包 hooks 文件”误读成“当前运行时支持纯插件 Hook 接入”。

## HelloLoop 的正确映射

按官方源码约束，`HelloLoop` 如果坚持“纯官方插件、不要外挂其他文件”，那正确映射就是让当前目录本身成为插件根目录，并显式放弃 Hook 自动驾驶层。

### 1. 官方插件层

用于满足官方插件标准：

- `.codex-plugin/plugin.json`
- `skills/helloloop/SKILL.md`
- `scripts/helloloop.mjs`
- 外部 `<codex-home>/.agents/plugins/marketplace.json`

这一层负责：

- 插件元数据
- Codex 插件可发现性
- 标准技能入口
- 显式 CLI 入口
- backlog 驱动的 Ralph Loop 执行

## 纯官方插件模式下仍保留的能力

以下能力在当前实现中仍然保留：

- `helloloop:helloloop` skill 入口
- `scripts/helloloop.mjs` CLI 入口
- `.helloloop/` 下的 backlog / policy / project / status 状态目录
- Ralph Loop 的多轮重试与换路策略

## 纯官方插件模式下主动放弃的能力

因为官方运行时今天不会从插件 manifest 自动加载 Hook，所以纯插件化必须明确放弃这些能力：

- `~helloloop`
- `~helloloop confirm`
- `~helloloop status`
- `~helloloop stop --yes`
- `UserPromptSubmit` 进入会话
- `Stop` Hook 自动续跑

这不是遗漏，而是按官方源码边界做的显式收缩。

## 当前仓库的落地原则

当前 bundle 采用以下原则：

1. 当前目录自身对齐官方插件目录标准，不再包一层 `plugins/helloloop/`。
2. 不在 `plugin.json` 里声明当前运行时不支持的 `hooks` 字段。
3. 不再通过 bridge 或额外挂载文件偷偷恢复 `~helloloop`。
4. 插件使用显式 skill/CLI 入口，而不是伪装成官方支持的 Hook 插件。
5. 开发文档独立放在当前目录的 `docs/` 下。
6. 安装时由外部 marketplace 指向 `./plugins/helloloop`，而不是把 marketplace 塞进插件目录本身。

这不是降级，而是当前官方源码边界下唯一严格符合“纯官方插件”要求的实现。

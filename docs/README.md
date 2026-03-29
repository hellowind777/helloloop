# HelloLoop

`HelloLoop` 现在作为独立 Codex 插件 bundle 交付。

当前目录本身就是插件根目录，直接包含：

- `.codex-plugin/`
- `skills/`
- `scripts/`
- `src/`
- `templates/`
- `tests/`
- `docs/`

这样做的原因不是偏好，而是官方运行时边界决定的。当前 Codex 官方插件运行时会自动加载插件里的 `skills`、`mcpServers`、`apps`，因此 `HelloLoop` 采用插件技能与显式 CLI 双入口交付。

## 目录

```text
helloloop/
├── .codex-plugin/
├── bin/
├── docs/
├── scripts/
├── skills/
├── src/
├── templates/
└── tests/
```

## 官方插件层

当前目录满足 `openai/plugins` 的标准形态：

- `.codex-plugin/plugin.json`
- `skills/`
- 可选的伴随文件与脚本
- 外部 marketplace 中指向本目录的本地路径

当前插件主要提供两件事：

- 在 Codex 插件体系中暴露 `HelloLoop` 的技能与元数据
- 提供一个显式 CLI 入口脚本和安装脚本，而不是通过 Hook 偷接运行时

当前纯插件版本保留的核心能力：

- backlog 驱动执行
- 显式 CLI / skill 触发
- Ralph Loop 式失败重试与换路

官方插件入口脚本：

```powershell
node .\scripts\helloloop.mjs doctor --repo <REPO_ROOT>
node .\scripts\helloloop.mjs init --repo <REPO_ROOT>
node .\scripts\helloloop.mjs run-loop --repo <REPO_ROOT>
```

## 状态目录

### `.helloloop/`

CLI/backlog 执行目录，保存：

- `backlog.json`
- `policy.json`
- `project.json`
- `status.json`
- `STATE.md`
- `runs/`

这些状态始终写入目标仓库，而不是插件 bundle 本身。

按官方 Codex 源码，插件 skill 会被加上 `plugin_name:` 前缀。因此这个插件的直接 skill 名应理解为：

```text
helloloop:helloloop
```

更稳妥的使用方式是：

- 显式提到 `helloloop` 插件
- 或显式使用 `helloloop:helloloop` 这个 skill 名

不应把 bare `$helloloop` 当成官方保证的调用形式。

## 推荐工作流

### 1. 官方插件标准工作流

命令：

```powershell
npx helloloop install --codex-home <CODEX_HOME>
npx helloloop init --repo <REPO_ROOT>
npx helloloop status --repo <REPO_ROOT>
npx helloloop run-loop --repo <REPO_ROOT> --max-tasks 2
```

如果已经全局安装 `helloloop`，则可以把 `npx helloloop` 简写为 `helloloop`。

## 核心命令

```powershell
npx helloloop doctor --repo <REPO_ROOT>
npx helloloop status --repo <REPO_ROOT>
npx helloloop next --repo <REPO_ROOT>
npx helloloop run-once --repo <REPO_ROOT>
npx helloloop run-loop --repo <REPO_ROOT>
```

## 验证

针对 `HelloLoop` 的快速回归入口：

```powershell
npm test
```

它会覆盖：

- 纯插件 CLI 表面
- Ralph Loop 默认参数与干跑提示
- 独立 bundle 的脚本、安装入口和文档目录是否齐备

## 参考

- 安装说明：`docs/install.md`
- 官方标准与运行时边界：`docs/plugin-standard.md`

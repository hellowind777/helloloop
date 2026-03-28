# HelloLoop

`HelloLoop` 现在是一个独立的 Codex 官方插件 bundle。

这个目录本身就是插件根目录，不再需要额外包一层 `plugins/helloloop/`。源码仓库根目录直接包含：

- `.codex-plugin/`
- `skills/`
- `scripts/`
- `src/`
- `templates/`
- `tests/`
- `docs/`

## 快速开始

1. 通过 npm / npx 安装到 Codex Home：

```powershell
npx <published-package-name> install --codex-home C:\Users\hellowind\.codex
```

2. 或从源码仓库安装到 Codex Home：

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\install-home-plugin.ps1 -CodexHome C:\Users\hellowind\.codex
```

3. 在目标仓库初始化 `HelloLoop` 状态目录：

```powershell
node C:\Users\hellowind\.codex\plugins\helloloop\scripts\helloloop.mjs init --repo D:\GitHub\dev\your-repo
```

4. 检查或执行 backlog：

```powershell
node C:\Users\hellowind\.codex\plugins\helloloop\scripts\helloloop.mjs doctor --repo D:\GitHub\dev\your-repo
node C:\Users\hellowind\.codex\plugins\helloloop\scripts\helloloop.mjs run-loop --repo D:\GitHub\dev\your-repo
```

安装脚本只会复制运行时所需文件到 `~/.codex/plugins/helloloop`，不会复制 `docs/` 和 `tests/`。

在 Codex 里查看插件列表时，请使用 `/plugins`（复数）；`/plugin` 不是当前官方入口。

npm 这里只作为分发渠道；最终仍然是把插件安装到本地 `~/.codex/plugins/helloloop`，并通过 marketplace 让 Codex 发现它。

当前 npm 包名就是 `helloloop`，可以直接作为分发名使用。

## 关键边界

- 保留：backlog 驱动执行、显式 CLI / skill 触发、Ralph Loop 重试与换路。
- 不支持：`~helloloop`、`~helloloop confirm`、`~helloloop status`、`~helloloop stop --yes`、`UserPromptSubmit` / `Stop` Hook 自动续跑。

## 文档

- 主指南：`docs/README.md`（源码仓库）
- 安装说明：`docs/install.md`（源码仓库）
- 官方标准映射：`docs/plugin-standard.md`（源码仓库）

## 验证

```powershell
npm test
```

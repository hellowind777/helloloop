# Autoloop

`Autoloop` 现在是一个独立的 Codex 官方插件 bundle。

这个目录本身就是插件根目录，不再需要额外包一层 `plugins/autoloop/`。根目录直接包含：

- `.codex-plugin/`
- `skills/`
- `scripts/`
- `src/`
- `templates/`
- `tests/`
- `docs/`

## 快速开始

1. 安装到 Codex Home：

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\install-home-plugin.ps1 -CodexHome C:\Users\hellowind\.codex
```

2. 在目标仓库初始化 `Autoloop` 状态目录：

```powershell
node C:\Users\hellowind\.codex\plugins\autoloop\scripts\autoloop.mjs init --repo D:\GitHub\dev\your-repo
```

3. 检查或执行 backlog：

```powershell
node C:\Users\hellowind\.codex\plugins\autoloop\scripts\autoloop.mjs doctor --repo D:\GitHub\dev\your-repo
node C:\Users\hellowind\.codex\plugins\autoloop\scripts\autoloop.mjs run-loop --repo D:\GitHub\dev\your-repo
```

## 关键边界

- 保留：backlog 驱动执行、显式 CLI / skill 触发、Ralph Loop 重试与换路。
- 不支持：`~autoloop`、`~autoloop confirm`、`~autoloop status`、`~autoloop stop --yes`、`UserPromptSubmit` / `Stop` Hook 自动续跑。

## 文档

- 主指南：`docs/README.md`
- 安装说明：`docs/install.md`
- 官方标准映射：`docs/plugin-standard.md`

## 验证

```powershell
npm test
```

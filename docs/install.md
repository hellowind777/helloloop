# HelloLoop 安装

本文只说明独立 bundle 的安装方式，不涉及任何 Hook 模式。

## 目录定位

当前目录 `D:\GitHub\dev\helloloop` 本身就是插件根目录。

安装后的目标位置应为：

```text
<CODEX_HOME>/
├── .agents/plugins/marketplace.json
└── plugins/
    └── helloloop/
        ├── .codex-plugin/
        ├── skills/
        ├── scripts/
        ├── src/
        └── templates/
```

## 推荐安装

### 方案 A：通过 npm / npx

```powershell
npx <published-package-name> install --codex-home C:\Users\hellowind\.codex
```

这个命令适合未来从 npm 分发后直接安装。

### 方案 B：从源码仓库安装

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\install-home-plugin.ps1 -CodexHome C:\Users\hellowind\.codex
```

如果目标目录已存在，追加 `-Force` 覆盖：

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\install-home-plugin.ps1 -CodexHome C:\Users\hellowind\.codex -Force
```

这个脚本会做三件事：

1. 把运行时 bundle 复制到 `<CODEX_HOME>\plugins\helloloop`
2. 更新 `<CODEX_HOME>\.agents\plugins\marketplace.json`
3. 不复制 `docs/` 和 `tests/` 这类开发侧文件

在 Codex 内查看插件时，请使用 `/plugins`（复数），不是 `/plugin`。

npm 只是分发方式，不是 Codex 的直接插件源；Codex 当前仍通过本地 marketplace 条目 `./plugins/helloloop` 加载插件。

当前 npm 包名使用 `helloloop`。

## 手动安装

### 1. 复制插件目录

把当前目录整体复制到：

```text
C:\Users\hellowind\.codex\plugins\helloloop
```

### 2. 更新 marketplace

在：

```text
C:\Users\hellowind\.codex\.agents\plugins\marketplace.json
```

确保存在如下条目：

```json
{
  "name": "helloloop",
  "source": {
    "source": "local",
    "path": "./plugins/helloloop"
  },
  "policy": {
    "installation": "AVAILABLE",
    "authentication": "ON_INSTALL"
  },
  "category": "Coding"
}
```

## 运行方式

安装完成后，针对目标仓库执行：

```powershell
node C:\Users\hellowind\.codex\plugins\helloloop\scripts\helloloop.mjs doctor --repo D:\GitHub\dev\your-repo
node C:\Users\hellowind\.codex\plugins\helloloop\scripts\helloloop.mjs init --repo D:\GitHub\dev\your-repo
node C:\Users\hellowind\.codex\plugins\helloloop\scripts\helloloop.mjs run-loop --repo D:\GitHub\dev\your-repo
```

`HelloLoop` 的 backlog 状态目录始终写入目标仓库的：

```text
.helloagents/helloloop/
```

而不是写回插件目录自身。

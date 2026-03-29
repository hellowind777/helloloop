# HelloLoop 安装

本文只说明独立 bundle 的安装方式。

## 目录定位

当前目录本身就是插件根目录。

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
npx helloloop install --codex-home <CODEX_HOME>
```

这个命令适合直接从 npm 安装，并且后续也可以继续用 `npx helloloop` 执行日常命令。

### 方案 B：从源码仓库安装

```powershell
node ./scripts/helloloop.mjs install --codex-home <CODEX_HOME>
```

如果你在 Windows 上更习惯 PowerShell，也可以使用：

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\install-home-plugin.ps1 -CodexHome <CODEX_HOME>
```

如果目标目录已存在，追加 `--force` 或 `-Force` 覆盖：

```powershell
node ./scripts/helloloop.mjs install --codex-home <CODEX_HOME> --force
pwsh -NoLogo -NoProfile -File .\scripts\install-home-plugin.ps1 -CodexHome <CODEX_HOME> -Force
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
<CODEX_HOME>\plugins\helloloop
```

### 2. 更新 marketplace

在：

```text
<CODEX_HOME>\.agents\plugins\marketplace.json
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
npx helloloop doctor --repo <REPO_ROOT>
npx helloloop init --repo <REPO_ROOT>
npx helloloop run-loop --repo <REPO_ROOT>
```

如果已经全局安装 `helloloop`，也可以直接写成：

```powershell
helloloop doctor --repo <REPO_ROOT>
helloloop init --repo <REPO_ROOT>
helloloop run-loop --repo <REPO_ROOT>
```

`HelloLoop` 的 backlog 状态目录始终写入目标仓库的：

```text
.helloloop/
```

而不是写回插件目录自身。

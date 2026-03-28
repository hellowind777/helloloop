# Autoloop 安装

本文只说明独立 bundle 的安装方式，不涉及任何 Hook 模式。

## 目录定位

当前目录 `D:\GitHub\dev\autoloop` 本身就是插件根目录。

安装后的目标位置应为：

```text
<CODEX_HOME>/
├── .agents/plugins/marketplace.json
└── plugins/
    └── autoloop/
        ├── .codex-plugin/
        ├── skills/
        ├── scripts/
        ├── src/
        ├── templates/
        └── docs/
```

## 推荐安装

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\install-home-plugin.ps1 -CodexHome C:\Users\hellowind\.codex
```

如果目标目录已存在，追加 `-Force` 覆盖：

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\install-home-plugin.ps1 -CodexHome C:\Users\hellowind\.codex -Force
```

这个脚本会做两件事：

1. 把整个 bundle 复制到 `<CODEX_HOME>\plugins\autoloop`
2. 更新 `<CODEX_HOME>\.agents\plugins\marketplace.json`

## 手动安装

### 1. 复制插件目录

把当前目录整体复制到：

```text
C:\Users\hellowind\.codex\plugins\autoloop
```

### 2. 更新 marketplace

在：

```text
C:\Users\hellowind\.codex\.agents\plugins\marketplace.json
```

确保存在如下条目：

```json
{
  "name": "autoloop",
  "source": {
    "source": "local",
    "path": "./plugins/autoloop"
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
node C:\Users\hellowind\.codex\plugins\autoloop\scripts\autoloop.mjs doctor --repo D:\GitHub\dev\your-repo
node C:\Users\hellowind\.codex\plugins\autoloop\scripts\autoloop.mjs init --repo D:\GitHub\dev\your-repo
node C:\Users\hellowind\.codex\plugins\autoloop\scripts\autoloop.mjs run-loop --repo D:\GitHub\dev\your-repo
```

`Autoloop` 的 backlog 状态目录始终写入目标仓库的：

```text
.helloagents/autoloop/
```

而不是写回插件目录自身。

# HelloLoop 安装

本文只说明独立插件 bundle 的安装方式，以及安装后的最短使用路径。

## 安装目标

安装完成后，目标目录结构应为：

```text
<CODEX_HOME>/
├── .agents/plugins/marketplace.json
└── plugins/
    └── helloloop/
        ├── .codex-plugin/
        ├── bin/
        ├── scripts/
        ├── skills/
        ├── src/
        └── templates/
```

`docs/` 和 `tests/` 属于源码仓库资料，不会复制进安装后的运行时 bundle。

## 推荐安装

### 方案 A：npm / npx

```powershell
npx helloloop install --codex-home <CODEX_HOME>
```

### 方案 B：源码仓库

```powershell
node ./scripts/helloloop.mjs install --codex-home <CODEX_HOME>
```

Windows PowerShell 也可以直接运行：

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\install-home-plugin.ps1 -CodexHome <CODEX_HOME>
```

如果目标目录已存在，追加 `--force` 或 `-Force` 即可覆盖。

## 安装后怎么用

安装完成后，进入目标项目仓库或开发文档目录，优先直接运行：

```powershell
npx helloloop
npx helloloop next
npx helloloop run-once
```

如果你只知道一个路径，也可以只传一个：

```powershell
npx helloloop <PATH>
```

这里的 `<PATH>` 可以是项目路径，也可以是开发文档目录或文件。

只有在自动发现无法确定仓库或文档时，再补充高级参数：

```powershell
npx helloloop --repo <REPO_ROOT> --docs <DOCS_PATH>
```

如果已经做了全局安装，也可以把 `npx helloloop` 简写成 `helloloop`。

## Windows 说明

- `HelloLoop` 在 Windows 优先使用 `pwsh`，也支持 `bash`（如 Git Bash）和 `powershell`，不会回退到 `cmd.exe`。
- 如果你的环境缺少这些安全 shell，`HelloLoop` 会直接停止并提示修复环境。
- 这样做是为了避免路径转义、嵌套命令和危险文件操作在 Windows 上被错误展开。

## 许可证

`HelloLoop` 使用 `Apache-2.0`，许可证文件为仓库根目录下的 `LICENSE`。

## 在 Codex 里执行

`npx helloloop ...` 可以直接在当前 Codex 会话里执行，不需要重开终端。

`helloloop ...` 这种短命令是否立即可用，取决于你的全局安装方式和当前 shell 是否已经刷新 PATH。

## 手动安装

### 1. 复制插件目录

把当前目录复制到：

```text
<CODEX_HOME>/plugins/helloloop
```

### 2. 更新 marketplace

在 `<CODEX_HOME>/.agents/plugins/marketplace.json` 中确保存在如下条目：

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

## 状态目录位置

`HelloLoop` 的 backlog 与运行状态始终写入目标仓库根目录下的：

```text
.helloloop/
```

不会写回插件目录自身。

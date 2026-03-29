# HelloLoop Bundle 说明

`HelloLoop` 以独立 Codex 插件 bundle 交付，当前目录本身就是插件根目录。

## 目录结构

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

其中：

- `.codex-plugin/`：插件 manifest 和展示元数据
- `bin/`：npm 命令入口
- `scripts/`：源码仓库下的脚本入口
- `skills/`：插件技能
- `src/`：路径发现、分析、调度、安装等核心实现
- `templates/`：写入目标仓库 `.helloloop/` 的模板
- `tests/`：回归测试
- `docs/`：源码仓库补充文档

## 运行时边界

安装后的运行时 bundle 只带以下内容：

- `.codex-plugin/`
- `LICENSE`
- `bin/`
- `scripts/`
- `skills/`
- `src/`
- `templates/`
- `README.md`

`docs/` 和 `tests/` 用于源码仓库维护，不属于运行时必需文件。

## 推荐工作流

### npm / npx

```powershell
npx helloloop install --codex-home <CODEX_HOME>
npx helloloop
npx helloloop next
npx helloloop run-loop --max-tasks 2
```

### 源码仓库调试

```powershell
node ./scripts/helloloop.mjs
node ./scripts/helloloop.mjs next
node ./scripts/helloloop.mjs run-loop --max-tasks 2
```

如果你不在目标仓库目录，也可以补一个路径：

```powershell
npx helloloop <PATH>
npx helloloop next <PATH>
```

## `.helloloop/` 目录

目标仓库中的 `.helloloop/` 保存：

- `backlog.json`
- `policy.json`
- `project.json`
- `status.json`
- `STATE.md`
- `runs/`

这些状态始终写入目标仓库，而不是写入插件 bundle。

## Skill 调用

按当前 Codex 插件命名规则，推荐显式使用：

```text
helloloop:helloloop
```

## 验证

本仓库的快速回归入口：

```powershell
npm test
```

它覆盖安装链路、CLI 表面、bundle 结构和分析链路的关键回归。

## 许可证

运行时 bundle 也会携带 `LICENSE`，当前许可证为 `Apache-2.0`。

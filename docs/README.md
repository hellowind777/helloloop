# HelloLoop Bundle 说明

`HelloLoop` 以多宿主 bundle 交付，当前目录同时包含：

- `Codex` 官方插件资产
- `Claude Code` marketplace / plugin 资产
- `Gemini CLI` extension 资产

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
- `.claude-plugin/`：Claude plugin 元数据
- `bin/`：npm 命令入口
- `hosts/`：Claude / Gemini 宿主运行时资产
- `scripts/`：源码仓库下的 CLI 与安装脚本
- `skills/`：插件技能
- `src/`：路径发现、分析、调度、执行、安装等核心实现
- `templates/`：写入目标仓库 `.helloloop/` 的模板
- `tests/`：回归测试
- `docs/`：源码仓库补充文档

## 运行时边界

安装后的运行时 bundle 只带以下内容：

- `.claude-plugin/`
- `.codex-plugin/`
- `LICENSE`
- `README.md`
- `bin/`
 - `hosts/`
- `scripts/`
- `skills/`
- `src/`
- `templates/`

`docs/` 和 `tests/` 用于源码仓库维护，不属于运行时必需文件。

## 推荐工作流

### npm / npx

```bash
npx helloloop install --codex-home <CODEX_HOME>
npx helloloop
npx helloloop <PATH>
npx helloloop --dry-run
```

主命令会自动：

1. 识别项目仓库和开发文档
2. 分析当前进度与偏差
3. 输出执行确认单
4. 经用户确认后继续自动接续执行

### 源码仓库调试

```bash
node ./scripts/helloloop.mjs
node ./scripts/helloloop.mjs <PATH>
node ./scripts/helloloop.mjs --dry-run
```

### 手动控制命令

```bash
npx helloloop status
npx helloloop next
npx helloloop run-once
npx helloloop run-loop --max-tasks 2
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

```bash
npm test
```

它覆盖安装链路、CLI 表面、bundle 结构和分析流程的关键回归。

## 许可证

运行时 bundle 也会携带 `LICENSE`，当前许可证为 `Apache-2.0`。

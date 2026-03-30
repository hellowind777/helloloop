# HelloLoop Bundle 说明

`HelloLoop` 以一个源码仓库维护三套宿主资产：

- `Codex` 官方插件 bundle
- `Claude Code` marketplace / plugin bundle
- `Gemini CLI` extension bundle

三家都原生执行开发，但共享同一套 `.helloloop/` 工作流状态规范。

## 源码仓库结构

```text
helloloop/
├── .claude-plugin/
├── .codex-plugin/
├── docs/
├── hosts/
├── bin/
├── scripts/
├── skills/
├── src/
├── templates/
└── tests/
```

关键目录说明：

- `.codex-plugin/`：Codex 插件 manifest
- `.claude-plugin/`：Claude plugin manifest
- `hosts/`：Claude marketplace / Gemini extension 运行时资产
- `bin/`：npm 命令入口
- `scripts/`：源码仓库调试入口与安装脚本
- `skills/`：Codex 插件技能
- `src/`：发现、分析、执行、安装、卸载、doctor 等核心实现
- `templates/`：目标仓库 `.helloloop/` 初始化模板
- `docs/`：源码仓库文档
- `tests/`：源码仓库回归测试

## 运行时安装包边界

运行时 bundle 只带以下内容：

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
- `package.json`

不会把 `docs/` 和 `tests/` 复制到用户安装目录。

## 核心交互契约

无论从哪个宿主进入，都遵循同样的交互顺序：

1. 自动识别项目仓库与开发文档
2. 先明确并询问本次执行引擎
3. 分析当前代码进度、偏差和项目匹配性
4. 在目标仓库根目录创建或刷新 `.helloloop/`
5. 输出中文执行确认单
6. 用户确认后，按当前宿主 + 所选执行引擎的原生 agent 逻辑继续推进开发、测试和验收
7. 每个任务完成后，再做一次任务完成复核
8. backlog 暂时清空后，再做一次主线终态复核

补充规则：

- `npx helloloop` 支持混合传入引擎、路径和自然语言要求
- 终端里不会再静默固定使用 `Codex`
- 当前引擎如果在运行中遇到 400 / 鉴权 / 余额 / 429 / 5xx / 网络抖动问题，会先按同引擎“健康探测 + 条件恢复”链路继续；不会自动切换引擎
- 如果当前目录没有识别到明确文档，会先展示顶层概览，再询问文档路径
- 项目路径只问一次；若路径不存在，则按新项目路径处理
- 如果现有项目与文档目标冲突，会先确认继续、重建还是取消
- 不会因为执行引擎一句“已完成”就直接结束；必须通过任务复核与主线终态复核

## 推荐工作流

### 安装

```bash
npx helloloop install --host all
```

### 执行

```bash
npx helloloop
npx helloloop <PATH>
npx helloloop codex
npx helloloop claude <PATH>
npx helloloop gemini <PATH> <补充说明>
```

### 维护

```bash
npx helloloop doctor --host all
npx helloloop uninstall --host all
```

## `.helloloop/` 目录

目标仓库中的 `.helloloop/` 至少包含：

- `backlog.json`
- `policy.json`
- `project.json`
- `status.json`
- `STATE.md`
- `runs/`

这些状态始终写入目标仓库，而不是写入插件安装目录。

## Codex 技能入口

Codex 下的显式技能入口为：

```text
helloloop:helloloop
```

但推荐优先让它路由到：

```bash
npx helloloop
```

如果在 `Codex` 内显式要求改用 `Claude` / `Gemini`，应先确认再切换。

## 验证

本仓库的快速回归入口：

```bash
npm test
```

发布前还会额外执行：

```bash
npm pack --dry-run
```

正式发版通过 Git tag 驱动：

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

beta 发版使用：

```bash
git tag vX.Y.Z-beta.N
git push origin vX.Y.Z-beta.N
```

tag 推送后，GitHub Actions 会自动执行版本校验、`npm test`、`npm pack --dry-run`、`npm publish` 与 GitHub Release；任一步失败都会阻断后续发版动作。

## 许可证

运行时 bundle 也会携带 `LICENSE`，当前许可证为 `Apache-2.0`。

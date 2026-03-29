# 变更日志

## [0.3.1] - 2026-03-29
### 调整
- **[分析交互]**: 主命令支持路径与自然语言混合输入，确认单补充路径判断、本次补充输入、语义理解与项目匹配信息
- **[工作区发现]**: 当前目录缺少明确开发文档时，先展示顶层概览再询问文档路径；项目路径统一为单一概念，不再额外拆出“新项目路径”
- **[冲突重建]**: 新增现有项目与文档目标冲突时的继续 / 重建 / 取消分支，并支持 `--rebuild-existing` 非交互重建
- **[宿主维护]**: 新增多宿主 `uninstall`，补齐安装、重装、旧分支残留清理与 `doctor` 校验链路
- **[文档/技能]**: README、安装文档、插件标准、Codex / Claude / Gemini 技能与命令说明统一更新为最新交互模型
- **[跨平台修复]**: 修正 POSIX 绝对路径前带中文冒号时的路径线索提取，消除 Linux 发布流水线中的确认单来源判断偏差

## [0.2.1] - 2026-03-29
### 调整
- **[Claude]**: 修正 Claude Code marketplace manifest 字段，移除不兼容字段并补充 marketplace 元数据
- **[安装]**: Claude 宿主改为按当前官方标准生成 `plugins/marketplaces`、`plugins/cache`、`known_marketplaces.json`、`installed_plugins.json`
- **[验证/文档]**: `doctor` 补充 Claude 安装索引检查，README、安装文档与回归测试同步更新

## [0.2.0] - 2026-03-29
### 调整
- **[多宿主]**: 新增 Claude marketplace/plugin 资产与 Gemini extension 资产，支持多 CLI 原生安装与使用
- **[安装]**: `helloloop install` 新增 `--host codex|claude|gemini|all`、`--claude-home`、`--gemini-home`
- **[文档/测试]**: README、安装说明、插件标准文档、新增多 CLI 架构文档与任务清单，并补充多宿主安装回归测试

## [0.1.0] - 2026-03-28
### 调整
- **[配置]**: 默认状态目录从 `.helloagents/helloloop` 改为 `.helloloop`
- **[提示]**: 干跑与执行提示词只读取当前 loop 状态
- **[文档/测试]**: README、安装文档、技能说明与回归测试同步新默认目录

## [0.1.0] - 2026-03-28
### 调整
- **[品牌]**: 项目、插件、skill、CLI 与安装目录统一从 `autoloop` 更名为 `helloloop`
- **[安装]**: marketplace 与安装逻辑切换到 `./plugins/helloloop`，并清理遗留 `autoloop` 安装目录
- **[文档/测试]**: README、安装说明、插件标准文档与回归测试同步新名称

## [0.1.0] - 2026-03-28
### 调整
- **[安装]**: `scripts/install-home-plugin.ps1` 仅复制运行时 bundle，不再复制 `docs/` 与 `tests/`
- **[测试]**: `tests/install_script.test.mjs` 覆盖安装包瘦身后的行为
- **[文档]**: 补充 `/plugins` 是当前官方插件入口的说明

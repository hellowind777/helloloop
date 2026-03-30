# HelloLoop 多 CLI 落地任务清单

## Phase 1：基础宿主支持

[√] 为 `Codex` 保留现有原生插件与 CLI 路径  
[√] 新增 Claude marketplace / plugin 运行时资产  
[√] 新增 Gemini extension 运行时资产  
[√] 新增 `install --host codex|claude|gemini|all`  
[√] 为 Claude 自动写入标准 `settings.json`、`known_marketplaces.json`、`installed_plugins.json` 与 cache 目录  
[√] 为 Gemini 自动安装到 `~/.gemini/extensions/helloloop`

## Phase 2：文档与使用说明

[√] 更新 README 的多 CLI 说明  
[√] 更新安装文档  
[√] 增加多 CLI 架构说明  
[√] 增加多 CLI 任务清单

## Phase 3：验证与回归

[√] 为多宿主安装新增回归测试  
[√] 为打包白名单新增宿主资产断言  
[√] 增加 Claude 宿主集成验证  
[√] 增加 Gemini 宿主集成验证  
[√] 增加多宿主 doctor 检查

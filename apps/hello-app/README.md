# Hello App

`Hello App` 是 `HelloLoop` 当前的主产品界面。

## 当前已落地

- 桌面壳：`apps/hello-app/src-tauri/`
- 共享 Web UI：`apps/hello-app/web/`
- 浏览器 fallback：由 `hello-daemon` 通过 `/app/` 提供
- 左侧导航 + 中央主视图 + 右侧焦点面板 + 底部状态栏
- `zh-CN` / `en-US`
- 浅色 / 深色主题
- Workspaces onboarding / analyze / continue mainline / pause mainline
- Sessions / Tasks / Review / Settings 结构化视图
- tray 菜单与 daemon 联动

## 主要页面

- `Command Center`
- `Workspaces`
- `Sessions`
- `Tasks`
- `Review`
- `Settings`

## 这一层的职责

- 把 daemon 的结构化状态变成可读、可操作的监督界面
- 把当前任务、后续任务、依赖、阻塞、风险、恢复动作直接展示出来
- 尽量让用户不必再盯着后台终端窗口

## 开发方式

桌面壳与浏览器 fallback 共用同一套 Web UI，所以：

- 前端视图改动优先落在 `web/`
- Tauri 壳主要负责窗口、托盘、daemon 启动与打开本地界面

## 关联文档

- `../../docs/app-first-product-strategy.md`
- `../../docs/hello-app-blueprint.md`
- `../../docs/hello-app-phase1-implementation.md`

function escapeInlineJson(value) {
  return JSON.stringify(value)
    .replace(/</gu, "\\u003c")
    .replace(/>/gu, "\\u003e")
    .replace(/&/gu, "\\u0026");
}

export function renderDashboardWebHtml(options = {}) {
  const initialSnapshot = options.initialSnapshot || {
    generatedAt: "",
    activeCount: 0,
    taskTotals: {},
    sessions: [],
  };

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HelloLoop Ops Center</title>
  <link rel="stylesheet" href="/assets/dashboard.css" />
</head>
<body>
  <header class="topbar">
    <div class="topbar-main">
      <div class="title">
        <h1 id="title-text">HelloLoop Ops Center</h1>
        <p id="title-copy">面向多仓、多会话、多任务主线的实时开发指挥台，支持总览、任务、会话、依赖、追踪与洞察多视图协同。</p>
      </div>
      <div class="topbar-pills">
        <div class="pill" id="update-pill">等待首帧</div>
        <div class="pill" id="session-pill">仓库 0 · 活跃会话 0</div>
      </div>
    </div>
    <div class="stats-row" id="stats"></div>
  </header>
  <main id="app" class="app-host"></main>
  <div class="drawer-backdrop" id="drawer-backdrop"></div>
  <aside class="drawer" id="drawer">
    <button type="button" class="drawer-close" id="drawer-close">关闭</button>
    <div id="drawer-content"></div>
  </aside>
  <script>window.__HELLOLOOP_INITIAL_SNAPSHOT__ = ${escapeInlineJson(initialSnapshot)};</script>
  <script type="module" src="/assets/dashboard-app.mjs"></script>
</body>
</html>`;
}

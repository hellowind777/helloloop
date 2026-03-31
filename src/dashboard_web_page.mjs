import { DASHBOARD_WEB_CSS, DASHBOARD_WEB_JS } from "./dashboard_web_client.mjs";

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
  <title>HelloLoop Dashboard</title>
  <style>${DASHBOARD_WEB_CSS}</style>
</head>
<body>
  <header>
    <div class="title-row">
      <div class="title">
        <h1>HelloLoop Dashboard</h1>
        <p>本地实时多仓开发看板。页面会持续订阅后台会话状态，不依赖宿主聊天流刷新。</p>
      </div>
      <div class="pill" id="update-pill">等待首帧</div>
    </div>
    <div class="stats-row">
      <div class="stats" id="stats"></div>
      <div class="pill" id="session-pill">仓库 0 · 活跃会话 0</div>
    </div>
  </header>
  <main id="board"></main>
  <aside class="drawer" id="drawer">
    <button class="drawer-close" id="drawer-close">关闭</button>
    <div id="drawer-content"></div>
  </aside>
  <script>window.__HELLOLOOP_INITIAL_SNAPSHOT__ = ${escapeInlineJson(initialSnapshot)};</script>
  <script>${DASHBOARD_WEB_JS}</script>
</body>
</html>`;
}

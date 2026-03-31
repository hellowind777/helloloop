export const DASHBOARD_WEB_CSS = `
  :root {
    color-scheme: dark;
    --bg: #081122;
    --panel: #0f1a2f;
    --panel-2: #13213c;
    --border: rgba(148, 163, 184, 0.2);
    --text: #e5eefc;
    --muted: #9fb2d1;
    --accent: #5eead4;
    --warn: #fbbf24;
    --danger: #f87171;
    --ok: #34d399;
    --shadow: 0 16px 40px rgba(0, 0, 0, 0.28);
    font-family: Inter, "Segoe UI", system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: radial-gradient(circle at top, #13284a 0%, var(--bg) 40%, #050b16 100%); color: var(--text); }
  header { position: sticky; top: 0; z-index: 10; backdrop-filter: blur(14px); background: rgba(8, 17, 34, 0.86); border-bottom: 1px solid var(--border); padding: 20px 24px 16px; }
  .title-row, .stats-row, .repo-header-top, .repo-meta { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
  .title h1 { margin: 0; font-size: 24px; font-weight: 700; }
  .title p { margin: 6px 0 0; color: var(--muted); font-size: 14px; }
  .pill, .badge, .drawer-close { border-radius: 999px; border: 1px solid var(--border); background: rgba(19, 33, 60, 0.9); color: var(--text); }
  .pill { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; font-size: 13px; }
  .stats-row { margin-top: 16px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 12px; width: min(100%, 760px); }
  .stat, .repo-board { background: rgba(15, 26, 47, 0.9); border: 1px solid var(--border); box-shadow: var(--shadow); }
  .stat { border-radius: 16px; padding: 14px; }
  .stat-label, .column-count, .repo-meta, .empty, .card-meta, .drawer-section h4 { color: var(--muted); font-size: 12px; }
  .stat-value { margin-top: 6px; font-size: 22px; font-weight: 700; }
  main { padding: 20px 24px 80px; display: grid; gap: 20px; }
  .repo-board { border-radius: 22px; overflow: hidden; }
  .repo-header { padding: 18px 20px 14px; border-bottom: 1px solid var(--border); background: linear-gradient(180deg, rgba(19, 33, 60, 0.96) 0%, rgba(15, 26, 47, 0.96) 100%); }
  .repo-header h2 { margin: 0; font-size: 20px; }
  .repo-meta { margin-top: 12px; font-size: 13px; }
  .columns { display: grid; grid-template-columns: repeat(5, minmax(220px, 1fr)); gap: 16px; padding: 18px; overflow-x: auto; }
  .column { min-height: 180px; background: rgba(9, 16, 29, 0.72); border: 1px solid rgba(148, 163, 184, 0.14); border-radius: 18px; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
  .column h3, .drawer h3 { margin: 0; font-size: 15px; }
  .cards { display: grid; gap: 10px; align-content: start; }
  .card { width: 100%; text-align: left; background: rgba(19, 33, 60, 0.96); border: 1px solid rgba(148, 163, 184, 0.16); border-radius: 14px; padding: 12px; cursor: pointer; color: inherit; }
  .card:hover { border-color: rgba(94, 234, 212, 0.42); transform: translateY(-1px); }
  .card-title { font-size: 14px; font-weight: 600; line-height: 1.45; }
  .badges, .repo-badges { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .badge { padding: 4px 10px; font-size: 11px; border-color: transparent; background: rgba(148, 163, 184, 0.14); }
  .badge.ok { background: rgba(52, 211, 153, 0.15); color: var(--ok); }
  .badge.warn { background: rgba(251, 191, 36, 0.14); color: var(--warn); }
  .badge.danger { background: rgba(248, 113, 113, 0.14); color: var(--danger); }
  .badge.accent { background: rgba(94, 234, 212, 0.12); color: var(--accent); }
  .card-meta { margin-top: 10px; line-height: 1.5; }
  aside.drawer { position: fixed; top: 0; right: 0; width: min(480px, 100vw); height: 100vh; background: rgba(6, 13, 26, 0.98); border-left: 1px solid var(--border); box-shadow: var(--shadow); transform: translateX(100%); transition: transform 180ms ease; padding: 24px; overflow-y: auto; z-index: 20; }
  aside.drawer.open { transform: translateX(0); }
  .drawer h3 { font-size: 20px; }
  .drawer-section { margin-top: 18px; }
  .drawer-section h4 { margin: 0 0 8px; text-transform: uppercase; }
  .drawer-list { margin: 0; padding-left: 18px; line-height: 1.6; }
  .drawer-close { position: sticky; top: 0; float: right; padding: 6px 12px; cursor: pointer; }
  @media (max-width: 1100px) { .columns { grid-template-columns: repeat(2, minmax(240px, 1fr)); } }
  @media (max-width: 760px) { header, main { padding-left: 14px; padding-right: 14px; } .columns { grid-template-columns: 1fr; } }
`;

export const DASHBOARD_WEB_JS = `
  const STATUS_COLUMNS = [
    { key: "pending", label: "待处理" },
    { key: "in_progress", label: "进行中" },
    { key: "done", label: "已完成" },
    { key: "blocked", label: "阻塞" },
    { key: "failed", label: "失败" },
  ];
  const boardEl = document.getElementById("board");
  const statsEl = document.getElementById("stats");
  const sessionPillEl = document.getElementById("session-pill");
  const updatePillEl = document.getElementById("update-pill");
  const drawerEl = document.getElementById("drawer");
  const drawerContentEl = document.getElementById("drawer-content");
  const drawerCloseEl = document.getElementById("drawer-close");
  let currentSnapshot = window.__HELLOLOOP_INITIAL_SNAPSHOT__;

  function badgeClass(kind) {
    if (kind === "done" || kind === "running" || kind === "ready") return "ok";
    if (kind === "blocked" || kind === "failed") return "danger";
    if (kind === "retry_waiting" || kind === "watchdog_waiting") return "warn";
    return "accent";
  }

  function formatRuntime(session) {
    const runtime = session.runtime || {};
    const bits = [runtime.status || "idle"];
    if (Number.isFinite(Number(runtime.recoveryCount)) && Number(runtime.recoveryCount) > 0) bits.push("recovery=" + runtime.recoveryCount);
    if (Number.isFinite(Number(runtime?.heartbeat?.idleSeconds)) && Number(runtime.heartbeat.idleSeconds) > 0) bits.push("idle=" + runtime.heartbeat.idleSeconds + "s");
    return bits.join(" | ");
  }

  function groupTasks(tasks) {
    const grouped = Object.fromEntries(STATUS_COLUMNS.map((column) => [column.key, []]));
    for (const task of Array.isArray(tasks) ? tasks : []) {
      const key = task.status || "pending";
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(task);
    }
    return grouped;
  }

  function renderStats(snapshot) {
    const totals = snapshot.taskTotals || {};
    const items = [["仓库总数", snapshot.repoCount || 0], ["活跃会话", snapshot.activeCount || 0], ["任务总计", totals.total || 0], ["待处理", totals.pending || 0], ["进行中", totals.inProgress || 0], ["已完成", totals.done || 0], ["阻塞", totals.blocked || 0], ["失败", totals.failed || 0]];
    statsEl.innerHTML = items.map(([label, value]) => '<div class="stat"><div class="stat-label">' + label + '</div><div class="stat-value">' + value + '</div></div>').join("");
    sessionPillEl.textContent = "仓库 " + (snapshot.repoCount || 0) + " · 活跃会话 " + (snapshot.activeCount || 0);
    updatePillEl.textContent = "最近刷新 " + (snapshot.generatedAt || "unknown");
  }

  function renderTaskCard(task, session) {
    const isCurrent = task.id && task.id === session.latestStatus?.taskId;
    const docsCount = Array.isArray(task.docs) ? task.docs.length : 0;
    const pathsCount = Array.isArray(task.paths) ? task.paths.length : 0;
    return '<button class="card" data-session="' + encodeURIComponent(session.sessionId || "") + '" data-task="' + encodeURIComponent(task.id || "") + '"><div class="card-title">' + (task.title || task.id || "未命名任务") + '</div><div class="badges"><span class="badge accent">' + (task.priority || "P2") + '</span><span class="badge ' + badgeClass(task.status || "pending") + '">' + (task.status || "pending") + '</span><span class="badge ' + badgeClass(task.risk || "low") + '">' + (task.risk || "low") + '</span>' + (isCurrent ? '<span class="badge warn">当前执行</span>' : "") + '</div><div class="card-meta">docs ' + docsCount + ' · paths ' + pathsCount + '</div></button>';
  }

  function renderSessionBoard(session) {
    const grouped = groupTasks(session.tasks || []);
    const repoBadges = ['<span class="badge ' + badgeClass(session.supervisor?.status || "running") + '">supervisor ' + (session.supervisor?.status || "unknown") + '</span>', '<span class="badge ' + badgeClass(session.runtime?.status || "idle") + '">runtime ' + formatRuntime(session) + '</span>', (session.latestStatus?.taskTitle ? '<span class="badge accent">当前任务 ' + session.latestStatus.taskTitle + '</span>' : "")].filter(Boolean).join("");
    const columnsHtml = STATUS_COLUMNS.map((column) => {
      const tasks = grouped[column.key] || [];
      return '<section class="column"><div><h3>' + column.label + '</h3><div class="column-count">' + tasks.length + ' 个任务</div></div><div class="cards">' + (tasks.length ? tasks.map((task) => renderTaskCard(task, session)).join("") : '<div class="empty">当前列为空</div>') + '</div></section>';
    }).join("");
    return '<section class="repo-board"><div class="repo-header"><div class="repo-header-top"><div><h2>' + session.repoName + '</h2><div class="repo-meta"><span>仓库：' + session.repoRoot + '</span><span>会话：' + session.sessionId + '</span></div></div><div class="repo-badges">' + repoBadges + '</div></div><div class="repo-meta"><span>当前动作：' + (session.activity?.current?.label || session.latestStatus?.message || session.runtime?.failureReason || "等待新事件") + '</span><span>宿主续跑：' + (session.hostResume?.issue?.label || (session.hostResume?.supervisorActive ? "后台仍在运行，可直接接续观察" : "需要按续跑提示继续")) + '</span></div></div><div class="columns">' + columnsHtml + '</div></section>';
  }

  function renderSnapshot(snapshot) {
    currentSnapshot = snapshot;
    renderStats(snapshot);
    if (!Array.isArray(snapshot.sessions) || !snapshot.sessions.length) {
      boardEl.innerHTML = '<section class="repo-board"><div class="repo-header"><h2>当前没有已登记仓库或后台会话</h2></div></section>';
      return;
    }
    boardEl.innerHTML = snapshot.sessions.map(renderSessionBoard).join("");
  }

  function openDrawer(task, session) {
    const docs = Array.isArray(task.docs) ? task.docs : [];
    const paths = Array.isArray(task.paths) ? task.paths : [];
    const acceptance = Array.isArray(task.acceptance) ? task.acceptance : [];
    drawerContentEl.innerHTML = '<h3>' + (task.title || task.id || "未命名任务") + '</h3><div class="badges"><span class="badge accent">仓库 ' + session.repoName + '</span><span class="badge accent">优先级 ' + (task.priority || "P2") + '</span><span class="badge ' + badgeClass(task.status || "pending") + '">状态 ' + (task.status || "pending") + '</span><span class="badge ' + badgeClass(task.risk || "low") + '">风险 ' + (task.risk || "low") + '</span></div><div class="drawer-section"><h4>目标</h4><div>' + (task.goal || "无") + '</div></div><div class="drawer-section"><h4>文档</h4><ul class="drawer-list">' + (docs.length ? docs.map((item) => '<li>' + item + '</li>').join("") : "<li>无</li>") + '</ul></div><div class="drawer-section"><h4>路径</h4><ul class="drawer-list">' + (paths.length ? paths.map((item) => '<li>' + item + '</li>').join("") : "<li>无</li>") + '</ul></div><div class="drawer-section"><h4>验收</h4><ul class="drawer-list">' + (acceptance.length ? acceptance.map((item) => '<li>' + item + '</li>').join("") : "<li>无</li>") + '</ul></div>';
    drawerEl.classList.add("open");
  }

  boardEl.addEventListener("click", (event) => {
    const button = event.target.closest(".card");
    if (!button) return;
    const sessionId = decodeURIComponent(button.dataset.session || "");
    const taskId = decodeURIComponent(button.dataset.task || "");
    const session = (currentSnapshot.sessions || []).find((item) => item.sessionId === sessionId);
    const task = (session?.tasks || []).find((item) => item.id === taskId);
    if (session && task) openDrawer(task, session);
  });

  drawerCloseEl.addEventListener("click", () => drawerEl.classList.remove("open"));
  window.addEventListener("keydown", (event) => { if (event.key === "Escape") drawerEl.classList.remove("open"); });

  function connectEvents() {
    const source = new EventSource("/events");
    source.onmessage = (event) => { try { renderSnapshot(JSON.parse(event.data)); } catch (error) { console.error("snapshot parse failed", error); } };
    source.onerror = () => { source.close(); setTimeout(connectEvents, 1500); };
  }

  renderSnapshot(currentSnapshot);
  connectEvents();
`;

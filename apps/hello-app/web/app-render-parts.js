import { escapeHtml, formatDate, translate } from "./app-i18n.js";
import {
  countWaitingSessions,
  metricCard,
  miniMetric,
  navCard,
  renderConnectionPill,
  renderEventCard,
  renderFocusWorkspace,
  renderHostCard,
  renderSessionCard,
  sessionBadges,
  summarizeHosts,
  summarizeRisk,
  taskColumn,
} from "./app-render-cards.js";

export function renderSidebar(state, snapshot, sessions, tasks) {
  const workspaceProfile = state.workspace?.workflow?.profileLabel || snapshot?.methodology || t(state, "none");
  const preferredHost = state.settings?.preferred_host
    ? (translate(state.locale, `host.${state.settings.preferred_host}`) || state.settings.preferred_host)
    : summarizeHosts(state);
  return `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-kicker">HelloLoop</div>
        <h1 class="brand-title">${escapeHtml(t(state, "app"))}</h1>
        <p class="brand-subtitle">${escapeHtml(t(state, "subtitle"))}</p>
      </div>
      <section class="sidebar-section">
        <div class="section-kicker">${escapeHtml(t(state, "overview"))}</div>
        <div class="nav-list">
          ${navCard("command-center", t(state, "commandCenter"), snapshot?.focus_summary || t(state, "none"), currentView(state) === "command-center")}
          ${navCard("workspaces", t(state, "workspaces"), workspaceProfile, currentView(state) === "workspaces")}
          ${navCard("sessions", t(state, "sessions"), `${sessions.length} · ${t(state, "liveQueue")}`, currentView(state) === "sessions")}
          ${navCard("tasks", t(state, "tasks"), `${tasks.length} · ${snapshot?.methodology || t(state, "none")}`, currentView(state) === "tasks")}
          ${navCard("review", t(state, "review"), `${countWaitingSessions(sessions)} · ${t(state, "coordination")}`, currentView(state) === "review")}
          ${navCard("settings", t(state, "settings"), `${state.hosts.length} · ${preferredHost || summarizeHosts(state)}`, currentView(state) === "settings")}
        </div>
      </section>
      <section class="sidebar-section">
        <div class="section-kicker">${escapeHtml(t(state, "coordination"))}</div>
        <div class="sidebar-metrics">
          ${miniMetric(t(state, "sessionCount"), String(sessions.length))}
          ${miniMetric(t(state, "blockedCount"), String(countWaitingSessions(sessions)))}
          ${miniMetric(t(state, "taskCount"), String(tasks.length))}
        </div>
      </section>
      <div class="footer-meta">${escapeHtml(t(state, "lastUpdated"))}: ${escapeHtml(formatDate(state.locale, snapshot?.updated_at) || t(state, "none"))}</div>
    </aside>
  `;
}

export function renderHero(state, snapshot, sessions, tasks) {
  const profile = state.workspace?.workflow?.profileLabel || snapshot?.methodology || t(state, "none");
  return `
    <section class="hero">
      <div class="hero-copy-block">
        <div class="section-kicker">${escapeHtml(viewTitle(state))}</div>
        <h2 class="hero-title">${escapeHtml(snapshot?.workspace_label || "HelloLoop")}</h2>
        <p class="hero-copy">${escapeHtml(snapshot?.focus_summary || profile || t(state, "none"))}</p>
      </div>
      <div class="hero-toolbar">
        ${renderConnectionPill(state)}
        ${state.error ? `<div class="alert-pill">${escapeHtml(state.error)}</div>` : ""}
        ${state.notice ? `<div class="notice-pill">${escapeHtml(state.notice)}</div>` : ""}
        <button class="button primary" data-action="refresh">${escapeHtml(t(state, "refresh"))}</button>
        <a class="ghost-button" href="/api/v1/command-center" target="_blank" rel="noreferrer">${escapeHtml(t(state, "openApi"))}</a>
        <button class="ghost-button" data-action="theme">${escapeHtml(state.theme === "light" ? t(state, "themeDark") : t(state, "themeLight"))}</button>
        <button class="locale-button" data-action="locale">${escapeHtml(state.locale === "zh-CN" ? "EN" : "中文")}</button>
      </div>
      <div class="metrics">
        ${metricCard(t(state, "sessionCount"), String(sessions.length), snapshot?.orchestration_mode || t(state, "none"))}
        ${metricCard(t(state, "taskCount"), String(tasks.length), snapshot?.methodology || t(state, "none"))}
        ${metricCard(t(state, "blockedCount"), String(countWaitingSessions(sessions)), summarizeRisk(state, sessions))}
        ${metricCard(t(state, "hostCount"), String(state.hosts.length), summarizeHosts(state))}
      </div>
    </section>
  `;
}

export function renderSessionsPanel(state, sessions) {
  return `
    <section class="panel">
      <div class="section-header">
        <div>
          <div class="section-kicker">${escapeHtml(t(state, "sessions"))}</div>
          <h3 class="section-title">${escapeHtml(t(state, "sessionOverview"))}</h3>
        </div>
      </div>
      <div class="session-list">
        ${sessions.length ? sessions.map((session) => renderSessionCard(state, session)).join("") : `<div class="empty">${escapeHtml(t(state, "noSessions"))}</div>`}
      </div>
    </section>
  `;
}

export function renderHostsPanel(state) {
  return `
    <section class="panel">
      <div class="section-header">
        <div>
          <div class="section-kicker">${escapeHtml(t(state, "hosts"))}</div>
          <h3 class="section-title">${escapeHtml(t(state, "capabilities"))}</h3>
        </div>
      </div>
      <div class="capability-list">
        ${state.hosts.length ? state.hosts.map(renderHostCard).join("") : `<div class="empty">${escapeHtml(t(state, "none"))}</div>`}
      </div>
    </section>
  `;
}

export function renderTaskBoard(state, tasks) {
  return `
    <section class="panel">
      <div class="section-header">
        <div>
          <div class="section-kicker">${escapeHtml(t(state, "tasks"))}</div>
          <h3 class="section-title">${escapeHtml(t(state, "tasks"))}</h3>
        </div>
      </div>
      <div class="task-columns">
        ${taskColumn(state, t(state, "ready"), tasks.filter((item) => item.state === "ready"))}
        ${taskColumn(state, t(state, "running"), tasks.filter((item) => item.state === "running"))}
        ${taskColumn(state, t(state, "blocked"), tasks.filter((item) => !["ready", "running", "completed"].includes(item.state)))}
        ${taskColumn(state, t(state, "completed"), tasks.filter((item) => item.state === "completed"))}
      </div>
    </section>
  `;
}

export function renderTimelinePanel(state) {
  return `
    <section class="panel">
      <div class="section-header">
        <div>
          <div class="section-kicker">${escapeHtml(t(state, "timeline"))}</div>
          <h3 class="section-title">${escapeHtml(t(state, "eventFeed"))}</h3>
        </div>
      </div>
      <div class="timeline-list">
        ${state.events.length ? state.events.map((item) => renderEventCard(state, item)).join("") : `<div class="empty">${escapeHtml(t(state, "noEvents"))}</div>`}
      </div>
    </section>
  `;
}

export function renderFocusPanel(state, session) {
  const detail = state.sessionDetail && state.sessionDetail.session?.id === session?.id
    ? state.sessionDetail
    : null;
  const detailMarkup = session
    ? (detail ? renderFocusWorkspace(state, detail) : `<div class="empty">${escapeHtml(t(state, "loadingSessionDetail"))}</div>`)
    : `<div class="empty">${escapeHtml(t(state, "noSessions"))}</div>`;
  return `
    <aside class="focus-panel">
      <div class="focus-header">
        <div>
          <div class="section-kicker">${escapeHtml(t(state, "focusPanel"))}</div>
          <h3 class="focus-title">${escapeHtml(session?.title || t(state, "none"))}</h3>
          <p class="focus-copy">${escapeHtml(session?.reason_label || t(state, "none"))}</p>
        </div>
        <div class="focus-badges">${session ? sessionBadges(session) : ""}</div>
      </div>
      <div class="focus-stack">
        <div class="focus-card">
          ${detailMarkup}
        </div>
        <div class="focus-card">
          <div class="section-kicker">${escapeHtml(t(state, "eventFeed"))}</div>
          <div class="timeline-list compact">
            ${state.events.slice(0, 6).length ? state.events.slice(0, 6).map((item) => renderEventCard(state, item)).join("") : `<div class="empty">${escapeHtml(t(state, "noEvents"))}</div>`}
          </div>
        </div>
      </div>
    </aside>
  `;
}

function t(state, key) {
  return translate(state.locale, key);
}

function currentView(state) {
  return state.currentView || "command-center";
}

function viewTitle(state) {
  const key = currentView(state) === "command-center"
    ? "commandCenter"
    : currentView(state);
  return t(state, key);
}

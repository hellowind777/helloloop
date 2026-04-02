import {
  buildDependencyRows,
  buildGlobalQueues,
  buildSessionQueues,
  buildTraceEvents,
  currentActionText,
  deriveInsights,
  ensureSelectedSession,
  escapeHtml,
  filterTaskRecords,
  formatClock,
  formatFailureSummary,
  formatRelationLabel,
  formatSchedulerMode,
  formatSchedulerSummary,
  formatSessionStatusLabel,
  formatTaskStatusLabel,
  formatWaitSummary,
  listTaskRecords,
  sessionMatchesFilters,
  statusBadgeClass,
  toTaskRecord,
  STATUS_COLUMNS,
} from "./dashboard_web_client_state.mjs";
import {
  renderBadge,
  renderMetricCard,
  renderQueueSection,
  renderQueueSummary,
  renderRetryCountdown,
  renderTaskCard,
} from "./dashboard_web_client_render_parts.mjs";
import { renderShell } from "./dashboard_web_client_render_shell.mjs";

function renderRepoCard(session, locale, t) {
  const queues = buildSessionQueues(session);
  const summary = session.summary || {};
  return `<article class="repo-card">
    <div class="panel-head">
      <div>
        <div class="section-kicker">Session ${escapeHtml(session.displaySessionId || session.sessionId || t("common.unknown"))}</div>
        <h3>${escapeHtml(session.repoName)}</h3>
      </div>
      <div class="badge-row">
        ${renderBadge(formatSessionStatusLabel(session, locale), statusBadgeClass(session))}
        ${renderBadge(formatSchedulerSummary(session, locale), "accent")}
        ${renderRetryCountdown(session, t)}
      </div>
    </div>
    <div class="repo-metrics">
      ${renderMetricCard(t("repo.backlog"), `${summary.done || 0}/${summary.total || 0}`, t("repo.backlogDetail", { pending: summary.pending || 0, blocked: summary.blocked || 0 }))}
      ${renderMetricCard(t("repo.focus"), session.workflow?.currentFocus || t("common.none"), session.workflow?.profileLabel || t("repo.unanalyzed"))}
      ${renderMetricCard(t("repo.action"), currentActionText(session), formatSchedulerSummary(session, locale))}
    </div>
    <div class="repo-queues">
      <div class="repo-queue-slot"><div class="slot-label">${escapeHtml(t("repo.current"))}</div>${renderQueueSummary(queues.current, locale, t, t("repo.noCurrent"))}</div>
      <div class="repo-queue-slot"><div class="slot-label">${escapeHtml(t("repo.next"))}</div>${renderQueueSummary(queues.next, locale, t, t("repo.noNext"))}</div>
      <div class="repo-queue-slot"><div class="slot-label">${escapeHtml(t("repo.blocked"))}</div>${renderQueueSummary(queues.blocked, locale, t, formatWaitSummary(session, locale))}</div>
      <div class="repo-queue-slot"><div class="slot-label">${escapeHtml(t("repo.done"))}</div>${renderQueueSummary(queues.done, locale, t, t("repo.noDone"))}</div>
    </div>
    <div class="detail-list compact">
      <div class="detail-row"><div class="detail-row-key">${escapeHtml(t("repo.waiting"))}</div><div class="detail-row-value">${escapeHtml(formatWaitSummary(session, locale))}</div></div>
      <div class="detail-row"><div class="detail-row-key">${escapeHtml(t("repo.failure"))}</div><div class="detail-row-value">${escapeHtml(formatFailureSummary(session, locale))}</div></div>
      <div class="detail-row"><div class="detail-row-key">${escapeHtml(t("repo.resume"))}</div><div class="detail-row-value">${escapeHtml(session.hostResumeLabel || t("common.none"))}</div></div>
    </div>
    <div class="panel-actions">
      <button type="button" class="toolbar-button" data-action="goto-view" data-view="tasks" data-session="${encodeURIComponent(session.sessionId || "")}">${escapeHtml(t("repo.viewTasks"))}</button>
      <button type="button" class="toolbar-button" data-action="goto-view" data-view="sessions" data-session="${encodeURIComponent(session.sessionId || "")}">${escapeHtml(t("repo.viewSessions"))}</button>
      <button type="button" class="toolbar-button" data-action="goto-view" data-view="trace" data-session="${encodeURIComponent(session.sessionId || "")}">${escapeHtml(t("repo.viewTrace"))}</button>
    </div>
  </article>`;
}

function renderOverview(snapshot, uiState, locale, t) {
  const insights = deriveInsights(snapshot);
  const sessions = (snapshot.sessions || []).filter((session) => sessionMatchesFilters(session, uiState.filters));
  const hero = `<section class="hero-grid">
    <article class="hero-card">
      <div class="section-kicker">${escapeHtml(t("overview.summaryKicker"))}</div>
      <h2>${escapeHtml(t("overview.title"))}</h2>
      <p>${escapeHtml(t("overview.copy"))}</p>
      <div class="metric-grid">
        ${renderMetricCard(t("overview.running"), insights.running.length, t("overview.runningDetail"))}
        ${renderMetricCard(t("overview.retrying"), insights.retrying.length, t("overview.retryingDetail"))}
        ${renderMetricCard(t("overview.manual"), insights.manual.length, t("overview.manualDetail"))}
        ${renderMetricCard(t("overview.external"), insights.external.length, t("overview.externalDetail"))}
      </div>
    </article>
    <article class="hero-card">
      <div class="section-kicker">${escapeHtml(t("overview.primaryKicker"))}</div>
      <h2>${escapeHtml((snapshot.sessions || [])[0]?.workflow?.profileLabel || t("overview.workflowFallback"))}</h2>
      <p>${escapeHtml((snapshot.sessions || [])[0]?.workflow?.mainlineSummary || t("overview.workflowSummaryFallback"))}</p>
      <div class="badge-row">
        ${renderBadge(t("overview.schema", { value: snapshot.schemaVersion || 1 }), "accent")}
        ${renderBadge(t("overview.updatedAt", { value: formatClock(snapshot.generatedAt, locale) }), "accent")}
      </div>
    </article>
  </section>`;

  const repoGrid = sessions.length
    ? `<section class="repo-grid">${sessions.map((session) => renderRepoCard(session, locale, t)).join("")}</section>`
    : `<section class="panel-card"><div class="empty-state">${escapeHtml(t("session.empty"))}</div></section>`;

  return `<div class="content-stack">${hero}${repoGrid}</div>`;
}

function renderTaskView(snapshot, uiState, locale, t) {
  const queues = buildGlobalQueues(snapshot, uiState.filters);
  const visibleRecords = filterTaskRecords(listTaskRecords(snapshot), uiState.filters);
  const boardColumns = STATUS_COLUMNS.map((column) => {
    const records = visibleRecords.filter((record) => record.status === column.key);
    return `<section class="board-column">
      <div class="column-head"><h4>${escapeHtml(formatTaskStatusLabel(column.key, locale))}</h4>${renderBadge(`${records.length}`, "accent")}</div>
      <div class="column-list">${records.length ? records.map((record) => renderTaskCard(record, locale, t, { compact: true })).join("") : `<div class="empty-state">${escapeHtml(t("common.emptyColumn"))}</div>`}</div>
    </section>`;
  }).join("");

  return `<div class="content-stack">
    <section class="queue-grid">
      ${renderQueueSection(t("task.currentTitle"), t("task.currentDesc"), queues.current, locale, t)}
      ${renderQueueSection(t("task.nextTitle"), t("task.nextDesc"), queues.next, locale, t)}
      ${renderQueueSection(t("task.blockedTitle"), t("task.blockedDesc"), queues.blocked, locale, t)}
      ${renderQueueSection(t("task.doneTitle"), t("task.doneDesc"), queues.done, locale, t)}
    </section>
    <section class="panel-card">
      <div class="panel-head">
        <div><div class="section-kicker">${escapeHtml(t("task.fullBoardKicker"))}</div><h3>${escapeHtml(t("task.fullBoardTitle"))}</h3></div>
        ${renderBadge(t("task.totalTasks", { count: visibleRecords.length }), "accent")}
      </div>
      <div class="board-grid">${boardColumns}</div>
    </section>
  </div>`;
}

function renderSessionList(snapshot, uiState, locale, t) {
  const sessions = (snapshot.sessions || []).filter((session) => sessionMatchesFilters(session, uiState.filters));
  const listBody = sessions.length
    ? sessions.map((session) => `
      <button type="button" class="session-item ${uiState.selectedSessionId === session.sessionId ? "active" : ""}" data-action="select-session" data-session="${encodeURIComponent(session.sessionId || "")}">
        <div class="session-item-head">
          <div>
            <div class="session-title">${escapeHtml(session.repoName)}</div>
            <div class="session-subtitle">${escapeHtml(session.displaySessionId || session.sessionId || t("common.unknown"))}</div>
          </div>
          ${renderBadge(formatSessionStatusLabel(session, locale), statusBadgeClass(session))}
        </div>
        <div class="session-subcopy">${escapeHtml(session.workflow?.currentFocus || session.statusModel?.reason || currentActionText(session))}</div>
      </button>`).join("")
    : `<div class="empty-state">${escapeHtml(t("session.empty"))}</div>`;

  return `<aside class="session-list-card">
    <div class="panel-head">
      <div><div class="section-kicker">${escapeHtml(t("session.listKicker"))}</div><h3>${escapeHtml(t("session.listTitle"))}</h3></div>
      ${renderBadge(t("session.repoCount", { count: sessions.length }), "accent")}
    </div>
    <div class="session-list">${listBody}</div>
  </aside>`;
}

function renderSessionDetail(session, locale, t, filters = {}) {
  if (!session) {
    return `<section class="panel-card"><div class="empty-state">${escapeHtml(t("session.empty"))}</div></section>`;
  }

  const queues = buildSessionQueues(session, filters);
  const boardColumns = STATUS_COLUMNS.map((column) => {
    const records = filterTaskRecords(
      (session.tasks || []).map((task) => toTaskRecord(session, task)),
      { ...filters, repo: session.repoName, status: column.key },
    );
    return `<section class="board-column compact">
      <div class="column-head"><h4>${escapeHtml(formatTaskStatusLabel(column.key, locale))}</h4>${renderBadge(`${records.length}`, "accent")}</div>
      <div class="column-list">${records.length ? records.map((record) => renderTaskCard(record, locale, t, { compact: true })).join("") : `<div class="empty-state">${escapeHtml(t("common.emptyColumn"))}</div>`}</div>
    </section>`;
  }).join("");

  return `<section class="session-detail-stack">
    <section class="panel-card">
      <div class="panel-head">
        <div><div class="section-kicker">${escapeHtml(t("session.detailKicker"))}</div><h3>${escapeHtml(session.repoName)}</h3></div>
        <div class="badge-row">
          ${renderBadge(formatSessionStatusLabel(session, locale), statusBadgeClass(session))}
          ${renderBadge(formatSchedulerSummary(session, locale), "accent")}
          ${renderRetryCountdown(session, t)}
        </div>
      </div>
      <div class="metric-grid">
        ${renderMetricCard(t("session.currentAction"), currentActionText(session), formatSchedulerMode(session.statusModel?.scheduler?.mode, locale))}
        ${renderMetricCard(t("session.wait"), formatWaitSummary(session, locale), formatFailureSummary(session, locale))}
        ${renderMetricCard(t("session.docAnalysis"), session.docAnalysis?.summary || t("common.none"), session.workflow?.profileLabel || t("repo.unanalyzed"))}
        ${renderMetricCard(t("session.location"), session.repoRoot || t("common.none"), session.hostResumeLabel || t("common.none"))}
      </div>
    </section>
    <section class="queue-grid">
      ${renderQueueSection(t("repo.current"), t("task.currentDesc"), queues.current, locale, t)}
      ${renderQueueSection(t("repo.next"), t("task.nextDesc"), queues.next, locale, t)}
      ${renderQueueSection(t("repo.blocked"), t("task.blockedDesc"), queues.blocked, locale, t)}
      ${renderQueueSection(t("repo.done"), t("task.doneDesc"), queues.done, locale, t)}
    </section>
    <section class="panel-card">
      <div class="panel-head">
        <div><div class="section-kicker">${escapeHtml(t("session.fullQueueKicker"))}</div><h3>${escapeHtml(t("session.fullQueueTitle"))}</h3></div>
        ${renderBadge(t("session.total", { count: session.summary?.total || 0 }), "accent")}
      </div>
      <div class="board-grid">${boardColumns}</div>
    </section>
  </section>`;
}

function renderDependenciesView(snapshot, uiState, locale, t) {
  const rows = buildDependencyRows(snapshot, uiState.filters);
  return `<section class="panel-card">
    <div class="panel-head">
      <div><div class="section-kicker">${escapeHtml(t("dependency.kicker"))}</div><h3>${escapeHtml(t("dependency.title"))}</h3></div>
      ${renderBadge(t("dependency.total", { count: rows.length }), "accent")}
    </div>
    <div class="table-scroll">
      <div class="table-grid">
        <div class="table-row table-head"><div>${escapeHtml(t("dependency.repo"))}</div><div>${escapeHtml(t("dependency.task"))}</div><div>${escapeHtml(t("dependency.relation"))}</div><div>${escapeHtml(t("dependency.status"))}</div></div>
        ${rows.length ? rows.map((row) => `<div class="table-row"><div>${escapeHtml(row.repoName)}</div><div>${escapeHtml(row.task)}</div><div>${renderBadge(formatRelationLabel(row.relation, locale), "accent")} ${escapeHtml(row.target)}</div><div>${escapeHtml(formatTaskStatusLabel(row.status, locale))}</div></div>`).join("") : `<div class="empty-state">${escapeHtml(t("dependency.empty"))}</div>`}
      </div>
    </div>
  </section>`;
}

function renderTraceView(snapshot, uiState, locale, t) {
  const session = ensureSelectedSession(snapshot, uiState);
  const events = session ? buildTraceEvents(session) : [];
  return `<div class="session-layout">
    ${renderSessionList(snapshot, uiState, locale, t)}
    <section class="panel-card">
      <div class="panel-head">
        <div><div class="section-kicker">${escapeHtml(t("trace.kicker"))}</div><h3>${escapeHtml(session?.repoName || t("common.none"))}</h3></div>
        ${renderBadge(t("trace.total", { count: events.length }), "accent")}
      </div>
      <div class="trace-list">${events.length ? events.map((event) => `
        <article class="trace-event">
          <strong>${escapeHtml(event.kind || "event")} · ${escapeHtml(event.label || t("common.none"))}</strong>
          <p>${escapeHtml(event.summary || t("common.none"))} · ${escapeHtml(formatClock(event.updatedAt, locale))}</p>
        </article>`).join("") : `<div class="empty-state">${escapeHtml(t("trace.empty"))}</div>`}</div>
    </section>
  </div>`;
}

function renderInsightsView(snapshot, uiState, locale, t) {
  const insights = deriveInsights(snapshot);
  const applyFilters = (sessions) => sessions.filter((session) => sessionMatchesFilters(session, uiState.filters));
  const sections = [
    [t("insight.retryTitle"), t("insight.retryDesc"), applyFilters(insights.retrying)],
    [t("insight.manualTitle"), t("insight.manualDesc"), applyFilters(insights.manual)],
    [t("insight.externalTitle"), t("insight.externalDesc"), applyFilters(insights.external)],
    [t("insight.docTitle"), t("insight.docDesc"), applyFilters(insights.incompleteDocAnalysis)],
  ];

  return `<section class="queue-grid">${sections.map(([title, description, sessions]) => `
    <article class="queue-card">
      <div class="panel-head">
        <div><div class="section-kicker">${escapeHtml(t("insight.kicker"))}</div><h3>${escapeHtml(title)}</h3></div>
        ${renderBadge(`${sessions.length}`, "accent")}
      </div>
      <p class="panel-copy">${escapeHtml(description)}</p>
      <div class="queue-list">${sessions.length ? sessions.map((session) => `
        <article class="trace-event">
          <strong>${escapeHtml(session.repoName)}</strong>
          <p>${escapeHtml(formatSessionStatusLabel(session, locale))} · ${escapeHtml(session.statusModel?.reason || currentActionText(session))}</p>
          <p>${escapeHtml(formatFailureSummary(session, locale))} · ${escapeHtml(formatWaitSummary(session, locale))}</p>
        </article>`).join("") : `<div class="empty-state">${escapeHtml(t("common.emptyTasks"))}</div>`}</div>
    </article>`).join("")}</section>`;
}

export function renderApp(snapshot, uiState) {
  const locale = uiState.locale || "zh-CN";
  const { sidebar, toolbar, t } = renderShell(snapshot, uiState);
  let content = "";

  if (uiState.view === "overview") {
    content = renderOverview(snapshot, uiState, locale, t);
  } else if (uiState.view === "tasks") {
    content = renderTaskView(snapshot, uiState, locale, t);
  } else if (uiState.view === "sessions") {
    const selected = ensureSelectedSession(snapshot, uiState);
    content = `<div class="session-layout">${renderSessionList(snapshot, uiState, locale, t)}${renderSessionDetail(selected, locale, t, uiState.filters)}</div>`;
  } else if (uiState.view === "dependencies") {
    content = renderDependenciesView(snapshot, uiState, locale, t);
  } else if (uiState.view === "trace") {
    content = renderTraceView(snapshot, uiState, locale, t);
  } else {
    content = renderInsightsView(snapshot, uiState, locale, t);
  }

  return `<div class="ops-layout">${sidebar}<section class="ops-content">${toolbar}${content}</section></div>`;
}

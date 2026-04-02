import { DASHBOARD_LOCALES, createTranslator } from "./dashboard_web_client_i18n.mjs";
import {
  VIEW_DEFS,
  buildDependencyRows,
  deriveInsights,
  ensureSelectedSession,
  escapeHtml,
  filterTaskRecords,
  formatStageLabel,
  formatTaskStatusLabel,
  getFilterOptions,
  listTaskRecords,
  sessionMatchesFilters,
} from "./dashboard_web_client_state.mjs";
import { renderBadge, renderMetricCard } from "./dashboard_web_client_render_parts.mjs";

function renderViewNav(snapshot, uiState, t) {
  const taskCount = filterTaskRecords(listTaskRecords(snapshot), uiState.filters).length;
  const dependencyCount = buildDependencyRows(snapshot, uiState.filters).length;
  const selected = ensureSelectedSession(snapshot, uiState);
  const attentionCount = deriveInsights(snapshot).attention.length;
  const countMap = {
    overview: snapshot.repoCount || 0,
    tasks: taskCount,
    sessions: (snapshot.sessions || []).filter((session) => sessionMatchesFilters(session, uiState.filters)).length,
    dependencies: dependencyCount,
    trace: selected ? 1 : 0,
    insights: attentionCount,
  };

  return `<aside class="ops-sidebar">
    <div class="sidebar-brand">
      <div class="section-kicker">${escapeHtml(t("brand.kicker"))}</div>
      <h2>HelloLoop</h2>
      <p>${escapeHtml(t("brand.description"))}</p>
    </div>
    <div class="sidebar-nav">${VIEW_DEFS.map((view) => `
      <button type="button" class="sidebar-nav-item ${uiState.view === view.key ? "active" : ""}" data-action="switch-view" data-view="${view.key}">
        <span>${escapeHtml(t(`view.${view.key}`))}</span>
        <span class="sidebar-nav-meta">${escapeHtml(String(countMap[view.key] || 0))}</span>
      </button>`).join("")}</div>
  </aside>`;
}

function renderToolbar(snapshot, uiState, t) {
  const options = getFilterOptions(snapshot);
  const visibleTasks = filterTaskRecords(listTaskRecords(snapshot), uiState.filters).length;
  return `<div class="toolbar-card">
    <div class="toolbar-grid">
      <label class="toolbar-field">
        <span>${escapeHtml(t("toolbar.search"))}</span>
        <input class="toolbar-input" type="search" placeholder="${escapeHtml(t("toolbar.searchPlaceholder"))}" value="${escapeHtml(uiState.filters.text)}" data-filter="text" />
      </label>
      <label class="toolbar-field">
        <span>${escapeHtml(t("toolbar.repo"))}</span>
        <select class="toolbar-select" data-filter="repo">
          <option value="all">${escapeHtml(t("toolbar.allRepos"))}</option>
          ${options.repos.map((repo) => `<option value="${escapeHtml(repo)}" ${uiState.filters.repo === repo ? "selected" : ""}>${escapeHtml(repo)}</option>`).join("")}
        </select>
      </label>
      <label class="toolbar-field">
        <span>${escapeHtml(t("toolbar.stage"))}</span>
        <select class="toolbar-select" data-filter="stage">
          <option value="all">${escapeHtml(t("toolbar.allStages"))}</option>
          ${options.stages.map((stage) => `<option value="${escapeHtml(stage)}" ${uiState.filters.stage === stage ? "selected" : ""}>${escapeHtml(formatStageLabel(stage, uiState.locale))}</option>`).join("")}
        </select>
      </label>
      <label class="toolbar-field">
        <span>${escapeHtml(t("toolbar.status"))}</span>
        <select class="toolbar-select" data-filter="status">
          <option value="all">${escapeHtml(t("toolbar.allStatuses"))}</option>
          ${options.statuses.map((status) => `<option value="${escapeHtml(status)}" ${uiState.filters.status === status ? "selected" : ""}>${escapeHtml(formatTaskStatusLabel(status, uiState.locale))}</option>`).join("")}
        </select>
      </label>
      <label class="toolbar-field">
        <span>${escapeHtml(t("toolbar.language"))}</span>
        <select class="toolbar-select" data-filter="locale">
          ${DASHBOARD_LOCALES.map((item) => `<option value="${escapeHtml(item.code)}" ${uiState.locale === item.code ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
        </select>
      </label>
      <div class="toolbar-actions">
        <button type="button" class="toolbar-button ${uiState.filters.attentionOnly ? "active" : ""}" data-action="toggle-attention">${escapeHtml(t("toolbar.attentionOnly"))}</button>
        <button type="button" class="toolbar-button" data-action="clear-filters">${escapeHtml(t("toolbar.clear"))}</button>
        ${renderBadge(t("toolbar.matchedTasks", { count: visibleTasks }), "accent")}
      </div>
    </div>
  </div>`;
}

export function renderStats(snapshot, locale = "zh-CN") {
  const t = createTranslator(locale);
  const totals = snapshot.taskTotals || {};
  const items = [
    [t("top.repoCount"), snapshot.repoCount || 0],
    [t("top.activeCount"), snapshot.activeCount || 0],
    [t("top.taskTotal"), totals.total || 0],
    [t("top.pending"), totals.pending || 0],
    [t("top.inProgress"), totals.inProgress || 0],
    [t("top.blocked"), totals.blocked || 0],
    [t("top.failed"), totals.failed || 0],
    [t("top.done"), totals.done || 0],
  ];
  return items.map(([label, value]) => `<div class="stat">${renderMetricCard(label, value)}</div>`).join("");
}

export function renderShell(snapshot, uiState) {
  const t = createTranslator(uiState.locale || "zh-CN");
  return {
    sidebar: renderViewNav(snapshot, uiState, t),
    toolbar: renderToolbar(snapshot, uiState, t),
    t,
  };
}

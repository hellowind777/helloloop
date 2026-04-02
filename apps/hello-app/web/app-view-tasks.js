import { escapeHtml, translate } from "./app-i18n.js";
import {
  applyTaskFilters,
  buildLaneRows,
  renderFlowNode,
  renderTasksSection,
} from "./app-view-shared.js";

export function renderTasksView(state, tasks) {
  const filteredTasks = applyTaskFilters(state, tasks);
  const laneChips = buildLaneRows(tasks, []).map((lane) => lane.name);
  return `
    <div class="view-stack">
      <section class="panel">
        <div class="section-header">
          <div>
            <div class="section-kicker">${escapeHtml(t(state, "tasks"))}</div>
            <h3 class="section-title">${escapeHtml(t(state, "dependencyGraph"))}</h3>
          </div>
        </div>
        <div class="filter-row">
          <button class="filter-chip ${state.filterLane || state.filterDependency ? "" : "active"}" data-clear-filters="true" type="button">${escapeHtml(t(state, "filterAll"))}</button>
          ${laneChips.map((lane) => `<button class="filter-chip ${state.filterLane === lane ? "active" : ""}" data-filter-lane="${escapeHtml(lane)}" type="button">${escapeHtml(lane)}</button>`).join("")}
        </div>
        <div class="flow-grid">
          ${filteredTasks.length ? filteredTasks.map((task) => renderFlowNode(state, task, tasks)).join("") : `<div class="empty">${escapeHtml(t(state, "noTasks"))}</div>`}
        </div>
      </section>
      ${renderTasksSection(state, filteredTasks, t(state, "taskBoard"))}
    </div>
  `;
}

function t(state, key) {
  return translate(state.locale, key);
}

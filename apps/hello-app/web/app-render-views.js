import { escapeHtml, translate } from "./app-i18n.js";
import { renderCommandCenterView } from "./app-view-command.js";
import { renderReviewView } from "./app-view-review.js";
import { renderSessionsView } from "./app-view-sessions.js";
import { renderSettingsView } from "./app-view-settings.js";
import { renderTasksView } from "./app-view-tasks.js";
import { renderWorkspacesView } from "./app-view-workspaces.js";
import { countBlocked, latestEventSummary, railPill } from "./app-view-shared.js";

export function renderMainView(state, snapshot, sessions, tasks) {
  const currentView = state.currentView || "command-center";
  switch (currentView) {
    case "workspaces":
      return renderWorkspacesView(state, snapshot, sessions, tasks);
    case "sessions":
      return renderSessionsView(state, sessions);
    case "tasks":
      return renderTasksView(state, tasks);
    case "review":
      return renderReviewView(state, sessions, tasks);
    case "settings":
      return renderSettingsView(state);
    case "command-center":
    default:
      return renderCommandCenterView(state, sessions, tasks);
  }
}

export function renderBottomBar(state, snapshot, sessions, tasks) {
  const latestEvent = state.events?.[0];
  const filters = [
    state.filterLane ? `${t(state, "filterLane")}: ${state.filterLane}` : "",
    state.filterDependency ? `${t(state, "filterDependency")}: ${state.filterDependency}` : "",
  ].filter(Boolean);
  const refreshEvery = state.settings?.refresh_interval_seconds || state.health?.context?.refresh_interval_seconds || 5;

  return `
    <footer class="bottom-bar">
      <div class="bottom-bar-group">
        ${railPill(t(state, "daemon"), state.health?.status || (state.connected ? "ok" : "degraded"), state.health?.status === "ok" || state.connected ? "ok" : "warn")}
        ${railPill(t(state, "sessionCount"), String(sessions.length), "accent")}
        ${railPill(t(state, "taskCount"), String(tasks.length), "neutral")}
        ${railPill(t(state, "blockedCount"), String(countBlocked(sessions, tasks)), countBlocked(sessions, tasks) ? "warn" : "ok")}
        ${railPill(t(state, "refreshInterval"), `${refreshEvery}s`, "neutral")}
      </div>
      <div class="bottom-bar-group grow">
        <span class="bottom-bar-label">${escapeHtml(t(state, "latestEvent"))}</span>
        <span class="bottom-bar-text">${escapeHtml(latestEventSummary(state, latestEvent, snapshot))}</span>
      </div>
      <div class="bottom-bar-group">
        ${filters.length ? filters.map((item) => railPill(item, "", "neutral")).join("") : railPill(t(state, "activeFilters"), t(state, "noneShort"), "neutral")}
      </div>
    </footer>
  `;
}

function t(state, key) {
  return translate(state.locale, key);
}

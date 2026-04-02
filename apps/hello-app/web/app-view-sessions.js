import { escapeHtml, translate } from "./app-i18n.js";
import {
  groupSessionsByState,
  renderSessionGroup,
  renderSessionsSection,
  renderTimelineSection,
} from "./app-view-shared.js";

export function renderSessionsView(state, sessions) {
  const grouped = groupSessionsByState(sessions);
  return `
    <div class="view-stack">
      <div class="grid">
        ${renderSessionsSection(state, sessions, t(state, "sessionMatrix"))}
        ${renderTimelineSection(state, t(state, "eventFeed"))}
      </div>
      <section class="panel">
        <div class="section-header">
          <div>
            <div class="section-kicker">${escapeHtml(t(state, "sessions"))}</div>
            <h3 class="section-title">${escapeHtml(t(state, "coordination"))}</h3>
          </div>
        </div>
        <div class="session-group-grid">
          ${Object.entries(grouped).map(([key, items]) => renderSessionGroup(state, key, items)).join("")}
        </div>
      </section>
    </div>
  `;
}

function t(state, key) {
  return translate(state.locale, key);
}

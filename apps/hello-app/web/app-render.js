import { escapeHtml, translate } from "./app-i18n.js";
import {
  renderFocusPanel,
  renderHero,
  renderSidebar,
} from "./app-render-parts.js";
import { renderBottomBar, renderMainView } from "./app-render-views.js";

export function renderApp(root, state) {
  const snapshot = state.snapshot;
  const sessions = snapshot?.sessions || [];
  const tasks = snapshot?.tasks || [];
  const selected = sessions.find((item) => item.id === state.selectedSessionId) || sessions[0] || null;
  const profile = state.workspace?.workflow?.profileLabel || snapshot?.methodology || t(state, "none");

  root.innerHTML = `
    <div class="app-scene">
      <div class="app-frame">
        <header class="window-bar">
          <div class="window-controls" aria-hidden="true">
            <span class="window-dot red"></span>
            <span class="window-dot yellow"></span>
            <span class="window-dot green"></span>
          </div>
          <div class="window-title">
            <div class="brand-kicker">${escapeHtml(t(state, "toolbarLabel"))}</div>
            <strong>${escapeHtml(snapshot?.workspace_label || "HelloLoop")}</strong>
          </div>
          <div class="window-status">${escapeHtml(profile)}</div>
        </header>
        <div class="shell">
          ${renderSidebar(state, snapshot, sessions, tasks)}
          <main class="main-shell">
            <div class="main-scroll">
              ${renderHero(state, snapshot, sessions, tasks)}
              ${renderMainView(state, snapshot, sessions, tasks)}
            </div>
            ${renderBottomBar(state, snapshot, sessions, tasks)}
          </main>
          ${renderFocusPanel(state, selected)}
        </div>
      </div>
    </div>
  `;
}

function t(state, key) {
  return translate(state.locale, key);
}

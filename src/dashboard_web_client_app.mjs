import { createTranslator, resolveDashboardLocale } from "./dashboard_web_client_i18n.mjs";
import {
  createInitialUiState,
  escapeHtml,
  findTaskRecord,
  formatCountdownValue,
  formatClock,
  formatFailureSummary,
  formatRelationLabel,
  formatRoleLabel,
  formatSessionStatusLabel,
  formatStageLabel,
  formatTaskStatusLabel,
  formatWaitSummary,
  badgeClass,
} from "./dashboard_web_client_state.mjs";
import { renderApp, renderStats } from "./dashboard_web_client_render.mjs";

const LOCALE_STORAGE_KEY = "helloloop.dashboard.locale";
const appEl = document.getElementById("app");
const statsEl = document.getElementById("stats");
const titleTextEl = document.getElementById("title-text");
const titleCopyEl = document.getElementById("title-copy");
const sessionPillEl = document.getElementById("session-pill");
const updatePillEl = document.getElementById("update-pill");
const drawerBackdropEl = document.getElementById("drawer-backdrop");
const drawerEl = document.getElementById("drawer");
const drawerContentEl = document.getElementById("drawer-content");
const drawerCloseEl = document.getElementById("drawer-close");

let currentSnapshot = window.__HELLOLOOP_INITIAL_SNAPSHOT__ || { sessions: [], taskTotals: {}, repoCount: 0, activeCount: 0, generatedAt: "" };
let heartbeatPulseTimer = 0;
let retryCountdownTimer = 0;
let activeDrawerRef = null;
let activeDrawerRecord = null;
const uiState = createInitialUiState(currentSnapshot);
uiState.locale = resolveDashboardLocale(
  new URLSearchParams(window.location.search).get("locale")
  || window.localStorage.getItem(LOCALE_STORAGE_KEY)
  || window.navigator.language,
);

function translator() {
  return createTranslator(uiState.locale);
}

function renderHeartbeat(payload = {}) {
  const t = translator();
  const pollMs = Math.max(500, Number(payload.pollMs || currentSnapshot?.pollMs || 1500));
  const heartbeatAt = payload.polledAt || payload.generatedAt || currentSnapshot?.generatedAt || "";
  const dataUpdatedAt = currentSnapshot?.generatedAt || payload.generatedAt || "";
  document.documentElement.lang = uiState.locale;
  document.title = t("shell.title");
  if (titleTextEl) titleTextEl.textContent = t("shell.title");
  if (titleCopyEl) titleCopyEl.textContent = t("shell.subtitle");
  if (drawerCloseEl) drawerCloseEl.textContent = t("drawer.close");
  updatePillEl.textContent = t("shell.heartbeatSummary", {
    heartbeat: formatClock(heartbeatAt, uiState.locale),
    data: formatClock(dataUpdatedAt, uiState.locale),
    interval: (pollMs / 1000).toFixed(pollMs % 1000 === 0 ? 0 : 1),
  });
  updatePillEl.classList.add("pill-live");
  window.clearTimeout(heartbeatPulseTimer);
  heartbeatPulseTimer = window.setTimeout(() => updatePillEl.classList.remove("pill-live"), Math.min(900, pollMs));
  sessionPillEl.textContent = t("shell.sessionPill", {
    repos: currentSnapshot.repoCount || 0,
    active: currentSnapshot.activeCount || 0,
  });
}

function syncRetryCountdowns() {
  document.querySelectorAll("[data-next-retry-at]").forEach((node) => {
    const nextRetryAt = node.getAttribute("data-next-retry-at") || "";
    const rendered = formatCountdownValue(nextRetryAt, uiState.locale);
    const targetTime = nextRetryAt ? new Date(nextRetryAt).getTime() : Number.NaN;
    node.textContent = `${node.getAttribute("data-countdown-prefix") || ""} ${rendered}`.trim();
    node.classList.toggle("is-expired", Number.isFinite(targetTime) && targetTime - Date.now() <= 0);
  });
}

function ensureRetryCountdownTimer() {
  if (retryCountdownTimer) {
    return;
  }
  retryCountdownTimer = window.setInterval(syncRetryCountdowns, 1000);
}

function renderTaskDrawer(record) {
  const t = translator();
  const docs = Array.isArray(record.docs) ? record.docs : [];
  const paths = Array.isArray(record.paths) ? record.paths : [];
  const artifacts = Array.isArray(record.artifacts) ? record.artifacts : [];
  const blockedBy = Array.isArray(record.blockedBy) ? record.blockedBy : [];
  const acceptance = Array.isArray(record.acceptance) ? record.acceptance : [];
  const renderList = (items, renderItem) => items.length
    ? items.map((item) => `<li>${renderItem(item)}</li>`).join("")
    : `<li>${escapeHtml(t("common.none"))}</li>`;

  drawerContentEl.innerHTML = `
    <h3>${escapeHtml(record.title || t("common.unknown"))}</h3>
    <div class="badge-row">
      <span class="badge accent">${escapeHtml(record.repoName || t("common.none"))}</span>
      <span class="badge accent">${escapeHtml(formatStageLabel(record.stage, uiState.locale))}</span>
      <span class="badge accent">${escapeHtml(formatRoleLabel(record.role, uiState.locale))}</span>
      <span class="badge ${badgeClass(record.status || "pending")}">${escapeHtml(formatTaskStatusLabel(record.status || "pending", uiState.locale))}</span>
      ${record.synthetic ? `<span class="badge warn">${escapeHtml(t("drawer.synthetic"))}</span>` : ""}
    </div>
    <div class="drawer-section"><h4>${escapeHtml(t("drawer.goal"))}</h4><div>${escapeHtml(record.goal || t("common.none"))}</div></div>
    <div class="drawer-section"><h4>${escapeHtml(t("common.currentAction"))}</h4><div>${escapeHtml(record.currentAction || t("common.none"))}</div></div>
    <div class="drawer-section"><h4>${escapeHtml(t("drawer.wait"))}</h4><div>${escapeHtml(formatWaitSummary(record, uiState.locale))}</div></div>
    <div class="drawer-section"><h4>${escapeHtml(t("drawer.failure"))}</h4><div>${escapeHtml(formatFailureSummary(record, uiState.locale))}</div></div>
    <div class="drawer-section"><h4>${escapeHtml(t("drawer.artifacts"))}</h4><ul class="drawer-list">${renderList(artifacts, (item) => escapeHtml(item))}</ul></div>
    <div class="drawer-section"><h4>${escapeHtml(t("drawer.blockers"))}</h4><ul class="drawer-list">${renderList(blockedBy, (item) => `${escapeHtml(formatRelationLabel(item.type || "blocked_task", uiState.locale))}: ${escapeHtml(item.label || item.id || t("common.none"))}${item.status ? ` (${escapeHtml(item.status)})` : ""}`)}</ul></div>
    <div class="drawer-section"><h4>${escapeHtml(t("drawer.docs"))}</h4><ul class="drawer-list">${renderList(docs, (item) => escapeHtml(item))}</ul></div>
    <div class="drawer-section"><h4>${escapeHtml(t("drawer.paths"))}</h4><ul class="drawer-list">${renderList(paths, (item) => escapeHtml(item))}</ul></div>
    <div class="drawer-section"><h4>${escapeHtml(t("drawer.acceptance"))}</h4><ul class="drawer-list">${renderList(acceptance, (item) => escapeHtml(item))}</ul></div>
    <div class="drawer-section"><h4>${escapeHtml(t("drawer.sessionState"))}</h4><div>${escapeHtml(formatSessionStatusLabel(record, uiState.locale))}</div></div>`;
}

function openDrawer(record) {
  activeDrawerRef = { sessionId: record.sessionId, taskId: record.id };
  activeDrawerRecord = record;
  renderTaskDrawer(record);
  drawerBackdropEl.classList.add("open");
  drawerEl.classList.add("open");
}

function closeDrawer() {
  activeDrawerRef = null;
  activeDrawerRecord = null;
  drawerEl.classList.remove("open");
  drawerBackdropEl.classList.remove("open");
}

function renderSnapshot(snapshot, heartbeatPayload = null) {
  currentSnapshot = snapshot;
  statsEl.innerHTML = renderStats(snapshot, uiState.locale);
  renderHeartbeat(heartbeatPayload || { generatedAt: snapshot.generatedAt || "", polledAt: snapshot.generatedAt || "" });
  appEl.innerHTML = renderApp(snapshot, uiState);
  if (activeDrawerRef) {
    activeDrawerRecord = findTaskRecord(currentSnapshot, activeDrawerRef.sessionId, activeDrawerRef.taskId) || activeDrawerRecord;
    if (activeDrawerRecord) {
      renderTaskDrawer(activeDrawerRecord);
    }
  }
  syncRetryCountdowns();
}

function persistLocale(locale) {
  uiState.locale = resolveDashboardLocale(locale);
  window.localStorage.setItem(LOCALE_STORAGE_KEY, uiState.locale);
}

function updateFilter(filterName, value) {
  if (filterName === "locale") {
    persistLocale(value);
    renderSnapshot(currentSnapshot);
    return;
  }
  uiState.filters[filterName] = filterName === "attentionOnly" ? Boolean(value) : value;
  renderSnapshot(currentSnapshot);
}

appEl.addEventListener("click", (event) => {
  const actionEl = event.target.closest("[data-action]");
  if (!actionEl) {
    return;
  }
  const action = actionEl.getAttribute("data-action");
  if (action === "switch-view") {
    uiState.view = actionEl.getAttribute("data-view") || "overview";
    renderSnapshot(currentSnapshot);
    return;
  }
  if (action === "goto-view") {
    uiState.view = actionEl.getAttribute("data-view") || "overview";
    uiState.selectedSessionId = decodeURIComponent(actionEl.getAttribute("data-session") || uiState.selectedSessionId || "");
    renderSnapshot(currentSnapshot);
    return;
  }
  if (action === "select-session") {
    uiState.selectedSessionId = decodeURIComponent(actionEl.getAttribute("data-session") || "");
    renderSnapshot(currentSnapshot);
    return;
  }
  if (action === "toggle-attention") {
    uiState.filters.attentionOnly = !uiState.filters.attentionOnly;
    renderSnapshot(currentSnapshot);
    return;
  }
  if (action === "clear-filters") {
    uiState.filters = { text: "", repo: "all", stage: "all", status: "all", attentionOnly: false };
    renderSnapshot(currentSnapshot);
    return;
  }
  if (action === "open-task") {
    const sessionId = decodeURIComponent(actionEl.getAttribute("data-session") || "");
    const taskId = decodeURIComponent(actionEl.getAttribute("data-task") || "");
    const record = findTaskRecord(currentSnapshot, sessionId, taskId);
    if (record) {
      openDrawer(record);
    }
  }
});

appEl.addEventListener("input", (event) => {
  const filterName = event.target?.getAttribute?.("data-filter");
  if (!filterName) {
    return;
  }
  updateFilter(filterName, event.target.value);
});

appEl.addEventListener("change", (event) => {
  const filterName = event.target?.getAttribute?.("data-filter");
  if (!filterName || filterName === "text") {
    return;
  }
  updateFilter(filterName, event.target.value);
});

drawerCloseEl.addEventListener("click", closeDrawer);
drawerBackdropEl.addEventListener("click", closeDrawer);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeDrawer();
  }
});

function connectEvents() {
  const source = new EventSource("/events");
  source.onmessage = (event) => {
    try {
      renderSnapshot(JSON.parse(event.data));
    } catch (error) {
      console.error("snapshot parse failed", error);
    }
  };
  source.addEventListener("heartbeat", (event) => {
    try {
      renderHeartbeat(JSON.parse(event.data));
    } catch (error) {
      console.error("heartbeat parse failed", error);
    }
  });
  source.onerror = () => {
    source.close();
    window.setTimeout(connectEvents, 1500);
  };
}

renderSnapshot(currentSnapshot);
ensureRetryCountdownTimer();
connectEvents();

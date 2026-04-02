import { resolveLocale, resolveTheme, translate } from "./app-i18n.js";
import {
  fetchJson,
  fetchJsonOptional,
  postJson,
  putJson,
} from "./app-http.js";
import { renderApp } from "./app-render.js";
import {
  createEmptyWorkspaceSelection,
  controlNotice,
  defaultSettings,
  inferWorkspaceSelection,
  normalizeSettings,
  normalizeWorkspaceSelection,
  normalizeWorkspaceSnapshot,
  readSettingValue,
  resolveView,
} from "./app-state-support.js";

const state = {
  locale: resolveLocale(),
  theme: resolveTheme(),
  snapshot: null,
  workspace: null,
  sessionDetail: null,
  settings: null,
  health: null,
  hosts: [],
  events: [],
  connected: false,
  error: "",
  notice: "",
  currentView: resolveView(),
  selectedSessionId: "",
  filterLane: "",
  filterDependency: "",
  eventSource: null,
  refreshTimer: 0,
  refreshInFlight: false,
  initialPreferencesApplied: false,
  isSavingSettings: false,
  workspaceSelection: createEmptyWorkspaceSelection(),
  isSavingWorkspaceSelection: false,
  isAnalyzingWorkspace: false,
};

const appNode = document.querySelector("#app");

boot();

async function boot() {
  applyTheme();
  exposeShellBridge();
  bindEvents();
  render();
  await refreshAll();
  connectEvents();
}

function exposeShellBridge() {
  window.__HELLO_APP_NAVIGATE = async (view, sessionId = "") => {
    await navigateToView(view, sessionId);
  };

  window.addEventListener("hello-app:navigate", (event) => {
    const detail = event.detail || {};
    void navigateToView(detail.view, detail.sessionId || "");
  });
}

function bindEvents() {
  document.addEventListener("click", async (event) => {
    if (event.target.closest("[data-action='refresh']")) {
      await requestRefresh();
      return;
    }

    if (event.target.closest("[data-action='locale']")) {
      setLocale(state.locale === "zh-CN" ? "en-US" : "zh-CN");
      await persistSettings(true);
      return;
    }

    if (event.target.closest("[data-action='theme']")) {
      setTheme(state.theme === "light" ? "dark" : "light");
      await persistSettings(true);
      return;
    }

    if (event.target.closest("[data-save-settings]")) {
      await persistSettings();
      return;
    }

    if (event.target.closest("[data-save-workspace-selection]")) {
      await persistWorkspaceSelection();
      return;
    }

    if (event.target.closest("[data-analyze-workspace]")) {
      await analyzeWorkspace();
      return;
    }

    const sessionCard = event.target.closest("[data-session-id]");
    if (sessionCard) {
      state.selectedSessionId = sessionCard.dataset.sessionId || "";
      state.currentView ||= "sessions";
      await loadSessionDetail();
      render();
      return;
    }

    const navTarget = event.target.closest("[data-view]");
    if (navTarget) {
      await navigateToView(navTarget.dataset.view || "command-center");
      return;
    }

    const laneTarget = event.target.closest("[data-filter-lane]");
    if (laneTarget) {
      state.currentView = "tasks";
      state.filterLane = state.filterLane === laneTarget.dataset.filterLane ? "" : (laneTarget.dataset.filterLane || "");
      localStorage.setItem("hello-app-view", state.currentView);
      render();
      return;
    }

    const dependencyTarget = event.target.closest("[data-dependency-filter]");
    if (dependencyTarget) {
      state.currentView = "tasks";
      state.filterDependency = state.filterDependency === dependencyTarget.dataset.dependencyFilter ? "" : (dependencyTarget.dataset.dependencyFilter || "");
      localStorage.setItem("hello-app-view", state.currentView);
      render();
      return;
    }

    if (event.target.closest("[data-clear-filters]")) {
      state.filterLane = "";
      state.filterDependency = "";
      state.currentView = "tasks";
      localStorage.setItem("hello-app-view", state.currentView);
      render();
      return;
    }

    const controlAction = event.target.closest("[data-control-endpoint]");
    if (controlAction) {
      try {
        const result = await postJson(controlAction.dataset.controlEndpoint);
        state.notice = controlNotice(state.locale, result);
        state.error = "";
      } catch (error) {
        state.notice = "";
        state.error = `${t("syncIssue")} · ${error.message}`;
      }
      await refreshAll();
    }
  });

  document.addEventListener("change", (event) => {
    const workspaceField = event.target?.dataset?.workspaceField;
    if (workspaceField) {
      state.workspaceSelection = normalizeWorkspaceSelection({
        ...(state.workspaceSelection || createEmptyWorkspaceSelection()),
        [workspaceField]: event.target.value,
      });
      render();
      return;
    }

    const field = event.target?.dataset?.settingField;
    if (!field) {
      return;
    }

    state.settings = normalizeSettings(state, {
      ...defaultSettings(state),
      ...(state.settings || {}),
      [field]: readSettingValue(field, event.target),
    });

    if (field === "locale") {
      setLocale(state.settings.locale);
    }
    if (field === "theme") {
      setTheme(state.settings.theme);
    }
    syncRefreshTimer();
    render();
  });

  window.addEventListener("beforeunload", () => {
    if (state.eventSource) {
      state.eventSource.close();
    }
    if (state.refreshTimer) {
      window.clearInterval(state.refreshTimer);
    }
  });
}

async function refreshAll() {
  if (state.refreshInFlight) {
    return;
  }

  state.refreshInFlight = true;
  try {
    const [snapshot, hosts, events, health, settings] = await Promise.all([
      fetchJson("/api/v1/command-center"),
      fetchJson("/api/v1/hosts"),
      fetchJson("/api/v1/events/recent?limit=16"),
      fetchJson("/healthz"),
      fetchJson("/api/v1/settings"),
    ]);
    const workspaceSelection = await fetchJsonOptional("/api/v1/workspaces/selection", [404]);

    state.snapshot = snapshot;
    state.hosts = Array.isArray(hosts) ? hosts : [];
    state.events = Array.isArray(events) ? events : [];
    state.health = health;
    state.settings = normalizeSettings(state, settings);
    state.workspaceSelection = normalizeWorkspaceSelection(
      workspaceSelection || inferWorkspaceSelection(state.workspace, health),
    );
    applyLoadedSettings(state.settings);
    state.connected = true;
    state.error = "";

    if (!state.selectedSessionId && snapshot?.sessions?.[0]?.id) {
      state.selectedSessionId = snapshot.sessions[0].id;
    }

    state.workspace = await loadWorkspaceSnapshot();
    state.workspaceSelection = normalizeWorkspaceSelection(
      workspaceSelection || inferWorkspaceSelection(state.workspace, health),
    );
    await loadSessionDetail();
  } catch (error) {
    state.connected = false;
    state.error = `${t("syncIssue")} · ${error.message}`;
  } finally {
    state.refreshInFlight = false;
    syncRefreshTimer();
    render();
  }
}

function connectEvents() {
  if (state.eventSource) {
    state.eventSource.close();
  }

  const eventSource = new EventSource("/api/v1/events");
  eventSource.addEventListener("command_center", (event) => {
    state.connected = true;
    state.error = "";
    state.snapshot = JSON.parse(event.data);
    if (!state.selectedSessionId && state.snapshot?.sessions?.[0]?.id) {
      state.selectedSessionId = state.snapshot.sessions[0].id;
    }
    state.events = [{
      id: Date.now(),
      event_type: "command_center",
      payload: state.snapshot,
      created_at: state.snapshot.updated_at,
    }, ...state.events].slice(0, 16);
    void Promise.all([loadSessionDetail(), loadWorkspaceSnapshot().then((workspace) => {
      state.workspace = workspace;
    })]).finally(() => render());
  });
  eventSource.onerror = () => {
    state.connected = false;
    state.error ||= state.locale === "zh-CN"
      ? "事件流断开，等待重连"
      : "Event stream disconnected, waiting to reconnect";
    render();
  };
  state.eventSource = eventSource;
}

function render() {
  applyTheme();
  renderApp(appNode, state);
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
}

function syncRefreshTimer() {
  if (state.refreshTimer) {
    window.clearInterval(state.refreshTimer);
  }
  const seconds = state.settings?.refresh_interval_seconds || state.health?.context?.refresh_interval_seconds || 5;
  state.refreshTimer = window.setInterval(() => {
    void refreshAll();
  }, Math.max(3, Number(seconds) || 5) * 1000);
}

async function requestRefresh() {
  try {
    await postJson("/api/v1/control/refresh");
    state.notice = t("refreshRequested");
  } catch (error) {
    state.notice = "";
    state.error = `${t("syncIssue")} · ${error.message}`;
  }
  await refreshAll();
}

async function loadSessionDetail() {
  if (!state.selectedSessionId) {
    state.sessionDetail = null;
    return;
  }

  try {
    state.sessionDetail = await fetchJson(`/api/v1/sessions/${encodeURIComponent(state.selectedSessionId)}`);
  } catch (error) {
    state.sessionDetail = null;
    state.error ||= `${t("syncIssue")} · ${error.message}`;
  }
}

async function loadWorkspaceSnapshot() {
  try {
    const workspace = await fetchJsonOptional("/api/v1/workspaces/current", [404, 409]);
    return workspace ? normalizeWorkspaceSnapshot(workspace) : null;
  } catch (error) {
    state.error ||= `${t("syncIssue")} · ${error.message}`;
    return null;
  }
}

async function persistSettings(fromToolbar = false) {
  state.isSavingSettings = true;
  render();
  try {
    const payload = normalizeSettings(state, {
      ...defaultSettings(state),
      ...(state.settings || {}),
      locale: state.locale,
      theme: state.theme,
    });
    state.settings = await putJson("/api/v1/settings", payload);
    state.settings = normalizeSettings(state, state.settings);
    state.notice = fromToolbar ? t("actionSubmitted") : t("settingsSaved");
    state.error = "";
    applyLoadedSettings(state.settings, true);
  } catch (error) {
    state.notice = "";
    state.error = `${t("settingsSyncIssue")} · ${error.message}`;
  } finally {
    state.isSavingSettings = false;
    syncRefreshTimer();
    render();
  }
}

async function persistWorkspaceSelection() {
  state.isSavingWorkspaceSelection = true;
  render();
  try {
    const payload = normalizeWorkspaceSelection(state.workspaceSelection);
    state.workspaceSelection = normalizeWorkspaceSelection(
      await putJson("/api/v1/workspaces/selection", payload),
    );
    state.notice = t("workspaceSelectionSaved");
    state.error = "";
    await refreshAll();
  } catch (error) {
    state.notice = "";
    state.error = `${t("workspaceSelectionIssue")} · ${error.message}`;
  } finally {
    state.isSavingWorkspaceSelection = false;
    render();
  }
}

async function analyzeWorkspace() {
  state.isAnalyzingWorkspace = true;
  render();
  try {
    const result = await postJson("/api/v1/workspaces/current/analyze");
    state.notice = controlNotice(state.locale, result);
    state.error = "";
    await refreshAll();
  } catch (error) {
    state.notice = "";
    state.error = `${t("workspaceAnalysisIssue")} · ${error.message}`;
  } finally {
    state.isAnalyzingWorkspace = false;
    render();
  }
}

function applyLoadedSettings(settings, force = false) {
  const storedLocale = localStorage.getItem("hello-app-locale");
  const storedTheme = localStorage.getItem("hello-app-theme");
  if (!state.initialPreferencesApplied || force) {
    state.locale = storedLocale || settings.locale || state.locale;
    state.theme = storedTheme || settings.theme || state.theme;
    state.initialPreferencesApplied = true;
  }
}

function setLocale(locale) {
  state.locale = locale;
  localStorage.setItem("hello-app-locale", state.locale);
  state.settings = normalizeSettings(state, {
    ...defaultSettings(state),
    ...(state.settings || {}),
    locale,
  });
}

function setTheme(theme) {
  state.theme = theme;
  localStorage.setItem("hello-app-theme", state.theme);
  state.settings = normalizeSettings(state, {
    ...defaultSettings(state),
    ...(state.settings || {}),
    theme,
  });
  applyTheme();
}

function t(key) {
  return translate(state.locale, key);
}

async function navigateToView(view, sessionId = "") {
  state.currentView = view || "command-center";
  localStorage.setItem("hello-app-view", state.currentView);
  if (sessionId) {
    state.selectedSessionId = sessionId;
    await loadSessionDetail();
  }
  render();
}

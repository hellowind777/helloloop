import { escapeHtml, translate } from "./app-i18n.js";
import { infoCard, renderHostsSection } from "./app-view-shared.js";

export function renderSettingsView(state) {
  const context = state.health?.context || {};
  const settings = state.settings || fallbackSettings(state);

  return `
    <div class="view-stack">
      <div class="grid">
        <section class="panel">
          <div class="section-header">
            <div>
              <div class="section-kicker">${escapeHtml(t(state, "settings"))}</div>
              <h3 class="section-title">${escapeHtml(t(state, "systemSettings"))}</h3>
            </div>
          </div>
          <div class="workspace-grid">
            ${infoCard(t(state, "preferredHost"), hostLabel(state, settings.preferred_host))}
            ${infoCard(t(state, "schedulerModeField"), schedulerLabel(state, settings.scheduler_mode))}
            ${infoCard(t(state, "retryPolicy"), retryLabel(state, settings.retry_policy))}
            ${infoCard(t(state, "refreshInterval"), `${settings.refresh_interval_seconds}s`)}
          </div>
        </section>
        ${renderHostsSection(state)}
      </div>
      <section class="panel">
        <div class="section-header">
          <div>
            <div class="section-kicker">${escapeHtml(t(state, "settings"))}</div>
            <h3 class="section-title">${escapeHtml(t(state, "automationProfile"))}</h3>
          </div>
        </div>
        <form class="settings-form" data-settings-form="true">
          <div class="form-grid">
            ${selectField(state, "appearance", "theme", settings.theme, [
              { value: "light", label: t(state, "themeLight") },
              { value: "dark", label: t(state, "themeDark") },
            ])}
            ${selectField(state, "i18n", "locale", settings.locale, [
              { value: "zh-CN", label: "简体中文" },
              { value: "en-US", label: "English" },
            ])}
            ${selectField(state, "preferredHost", "preferred_host", settings.preferred_host, hostOptions(state))}
            ${selectField(state, "schedulerModeField", "scheduler_mode", settings.scheduler_mode, [
              { value: "central_supervisor", label: schedulerLabel(state, "central_supervisor") },
              { value: "balanced_parallel", label: schedulerLabel(state, "balanced_parallel") },
              { value: "strict_stage_gate", label: schedulerLabel(state, "strict_stage_gate") },
            ])}
            ${selectField(state, "retryPolicy", "retry_policy", settings.retry_policy, [
              { value: "conservative", label: retryLabel(state, "conservative") },
              { value: "balanced", label: retryLabel(state, "balanced") },
              { value: "aggressive", label: retryLabel(state, "aggressive") },
            ])}
            ${selectField(state, "refreshInterval", "refresh_interval_seconds", String(settings.refresh_interval_seconds), [
              { value: "3", label: "3s" },
              { value: "5", label: "5s" },
              { value: "10", label: "10s" },
              { value: "30", label: "30s" },
            ])}
          </div>
          <div class="toggle-grid">
            ${toggleField(state, "notifications", "notifications_enabled", settings.notifications_enabled)}
            ${toggleField(state, "trayLaunchOnStart", "tray_launch_on_start", settings.tray_launch_on_start)}
            ${toggleField(state, "daemonAutoStart", "daemon_auto_start", settings.daemon_auto_start)}
          </div>
          <div class="settings-actions">
            <button class="button primary" data-save-settings="true" type="button">${escapeHtml(state.isSavingSettings ? t(state, "savingSettings") : t(state, "saveSettings"))}</button>
          </div>
        </form>
      </section>
      <section class="panel">
        <div class="section-header">
          <div>
            <div class="section-kicker">${escapeHtml(t(state, "settings"))}</div>
            <h3 class="section-title">${escapeHtml(t(state, "runtimeContext"))}</h3>
          </div>
        </div>
        <div class="workspace-grid">
          ${infoCard(t(state, "daemonUrl"), state.health?.listen_addr ? `http://${state.health.listen_addr}` : t(state, "none"))}
          ${infoCard(t(state, "listenAddress"), state.health?.listen_addr || t(state, "none"))}
          ${infoCard(t(state, "bindSource"), context.bind_source || t(state, "none"))}
          ${infoCard(t(state, "activeRecord"), context.active_record_path || t(state, "none"))}
          ${infoCard(t(state, "currentWorkspace"), context.workspace_root || t(state, "none"))}
          ${infoCard(t(state, "toolRoot"), context.tool_root || t(state, "none"))}
          ${infoCard(t(state, "dbPath"), context.db_path || t(state, "none"))}
          ${infoCard(t(state, "configDir"), context.config_dir_name || t(state, "none"))}
          ${infoCard(t(state, "bridgeMode"), context.bridge_mode || t(state, "none"))}
          ${infoCard(t(state, "bootstrapSource"), context.bootstrap_source || t(state, "none"))}
        </div>
      </section>
    </div>
  `;
}

function fallbackSettings(state) {
  return {
    locale: state.locale,
    theme: state.theme,
    preferred_host: "codex",
    scheduler_mode: "central_supervisor",
    retry_policy: "balanced",
    notifications_enabled: true,
    tray_launch_on_start: true,
    daemon_auto_start: true,
    refresh_interval_seconds: 5,
  };
}

function hostOptions(state) {
  const hosts = state.hosts.map((host) => ({
    value: host.kind,
    label: host.display_name,
  }));
  return hosts.length
    ? hosts
    : [
        { value: "codex", label: hostLabel(state, "codex") },
        { value: "claude", label: hostLabel(state, "claude") },
        { value: "gemini", label: hostLabel(state, "gemini") },
      ];
}

function selectField(state, labelKey, field, value, options) {
  return `
    <label class="field-group">
      <span class="field-label">${escapeHtml(t(state, labelKey))}</span>
      <select class="field-control" data-setting-field="${escapeHtml(field)}">
        ${options.map((option) => `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(value) ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
      </select>
    </label>
  `;
}

function toggleField(state, labelKey, field, checked) {
  return `
    <label class="toggle-card">
      <span>
        <span class="field-label">${escapeHtml(t(state, labelKey))}</span>
        <span class="field-help">${escapeHtml(checked ? t(state, "optionEnabled") : t(state, "optionDisabled"))}</span>
      </span>
      <input type="checkbox" class="toggle-control" data-setting-field="${escapeHtml(field)}" ${checked ? "checked" : ""} />
    </label>
  `;
}

function hostLabel(state, value) {
  const key = `host.${value}`;
  return t(state, key) === key ? value : t(state, key);
}

function schedulerLabel(state, value) {
  const key = `scheduler.${value}`;
  return t(state, key) === key ? value : t(state, key);
}

function retryLabel(state, value) {
  const key = `retry.${value}`;
  return t(state, key) === key ? value : t(state, key);
}

function t(state, key) {
  return translate(state.locale, key);
}

import { escapeHtml, translate } from "./app-i18n.js";

export function renderWorkspaceOnboardingSection(state, selection, workspace) {
  return `
    <section class="panel">
      <div class="section-header">
        <div>
          <div class="section-kicker">${escapeHtml(t(state, "workspaces"))}</div>
          <h3 class="section-title">${escapeHtml(t(state, "workspaceOnboarding"))}</h3>
        </div>
      </div>
      <div class="workspace-grid">
        ${detailCard(t(state, "repoRoot"), selection.repo_root || t(state, "none"))}
        ${detailCard(t(state, "docsPath"), selection.docs_path || t(state, "none"))}
        ${detailCard(t(state, "configDir"), selection.config_dir_name || t(state, "none"))}
        ${detailCard(t(state, "preferredEngine"), selection.preferred_engine || t(state, "none"))}
      </div>
      <form class="settings-form" data-workspace-form="true">
        <div class="form-grid">
          ${textField(state, "repoRoot", "repo_root", selection.repo_root, "D:\\GitHub\\dev\\example")}
          ${textField(state, "docsPath", "docs_path", selection.docs_path, "docs")}
          ${textField(state, "configDir", "config_dir_name", selection.config_dir_name, ".helloloop")}
          ${selectField(state, "preferredEngine", "preferred_engine", selection.preferred_engine, [
            { value: "codex", label: hostLabel(state, "codex") },
            { value: "claude", label: hostLabel(state, "claude") },
            { value: "gemini", label: hostLabel(state, "gemini") },
          ])}
        </div>
        <div class="settings-actions workspace-actions">
          <button class="button primary" data-save-workspace-selection="true" type="button">
            ${escapeHtml(state.isSavingWorkspaceSelection ? t(state, "savingWorkspaceSelection") : t(state, "saveWorkspaceSelection"))}
          </button>
          <button class="button" data-analyze-workspace="true" type="button">
            ${escapeHtml(state.isAnalyzingWorkspace ? t(state, "analyzingWorkspace") : t(state, "analyzeWorkspace"))}
          </button>
          <button class="ghost-button" data-control-endpoint="/api/v1/control/pause-mainline" type="button">
            ${escapeHtml(t(state, "pauseMainline"))}
          </button>
          <button class="ghost-button" data-control-endpoint="/api/v1/control/continue-mainline" type="button">
            ${escapeHtml(t(state, "continueMainline"))}
          </button>
        </div>
      </form>
      <div class="workspace-callout">${escapeHtml(workspace?.workflow?.mainlineSummary || t(state, "workspaceOnboardingHint"))}</div>
    </section>
  `;
}

export function renderStoryCard(state, title, copy, meta = "") {
  return `
    <article class="story-card">
      <div class="detail-key">${escapeHtml(title)}</div>
      <div class="story-copy">${escapeHtml(copy || t(state, "none"))}</div>
      ${meta ? `<div class="story-meta">${escapeHtml(meta)}</div>` : ""}
    </article>
  `;
}

export function renderBulletCard(state, title, items) {
  const values = Array.isArray(items) && items.length ? items : [t(state, "none")];
  return `
    <article class="story-card">
      <div class="detail-key">${escapeHtml(title)}</div>
      <ul class="bullet-list">
        ${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </article>
  `;
}

export function formatTodoProgress(todo) {
  if (!todo) {
    return "";
  }
  if (typeof todo.total === "number" && typeof todo.completed === "number") {
    return `${todo.completed}/${todo.total}`;
  }
  return "";
}

export function joinLabels(items, limit) {
  return (Array.isArray(items) ? items : [])
    .slice(0, limit)
    .map((item) => item?.label)
    .filter(Boolean)
    .join(" · ");
}

export function joinValues(values, separator) {
  return (Array.isArray(values) ? values : [])
    .filter(Boolean)
    .join(separator);
}

function textField(state, labelKey, field, value, placeholder) {
  return `
    <label class="field-group">
      <span class="field-label">${escapeHtml(t(state, labelKey))}</span>
      <input
        class="field-control"
        data-workspace-field="${escapeHtml(field)}"
        type="text"
        value="${escapeHtml(value || "")}"
        placeholder="${escapeHtml(placeholder)}"
      />
    </label>
  `;
}

function selectField(state, labelKey, field, value, options) {
  return `
    <label class="field-group">
      <span class="field-label">${escapeHtml(t(state, labelKey))}</span>
      <select class="field-control" data-workspace-field="${escapeHtml(field)}">
        ${options.map((option) => `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(value) ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
      </select>
    </label>
  `;
}

function detailCard(label, value) {
  return `
    <div class="detail-card">
      <div class="detail-key">${escapeHtml(label)}</div>
      <div class="detail-value">${escapeHtml(value)}</div>
    </div>
  `;
}

function hostLabel(state, value) {
  const key = `host.${value}`;
  return t(state, key) === key ? value : t(state, key);
}

function t(state, key) {
  return translate(state.locale, key);
}

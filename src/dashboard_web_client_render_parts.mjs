import {
  badgeClass,
  escapeHtml,
  formatRoleLabel,
  formatStageLabel,
  formatTaskStatusLabel,
  formatWaitSummary,
} from "./dashboard_web_client_state.mjs";

export function renderBadge(label, tone = "accent", extraClass = "") {
  return `<span class="badge ${tone} ${extraClass}">${escapeHtml(label)}</span>`;
}

export function renderMetricCard(label, value, detail = "") {
  return `<article class="metric-card"><div class="metric-label">${escapeHtml(label)}</div><div class="metric-value">${escapeHtml(value)}</div>${detail ? `<div class="metric-detail">${escapeHtml(detail)}</div>` : ""}</article>`;
}

export function renderRetryCountdown(session, t) {
  const nextRetryAt = session.statusModel?.failure?.nextRetryAt || session.runtime?.nextRetryAt || "";
  if (!nextRetryAt) {
    return "";
  }
  return `<span class="badge warn retry-countdown" data-next-retry-at="${escapeHtml(nextRetryAt)}" data-countdown-prefix="${escapeHtml(t("common.nextRetry"))}"></span>`;
}

export function renderTaskCard(record, locale, t, options = {}) {
  const compact = options.compact === true;
  const cardClass = ["task-card", record.isCurrent || record.status === "in_progress" ? "task-card-current" : ""].filter(Boolean).join(" ");
  const subtitle = compact ? record.repoName : record.repoRoot || record.repoName;
  const goal = record.goal || record.currentAction || formatWaitSummary(record, locale) || t("common.none");
  const footer = compact
    ? `${escapeHtml(goal)}`
    : `lane ${escapeHtml(record.lane || "mainline")} · docs ${record.docsCount || 0} · paths ${record.pathsCount || 0} · artifacts ${record.artifactsCount || 0}`;

  return `<button type="button" class="${cardClass}" data-action="open-task" data-session="${encodeURIComponent(record.sessionId || "")}" data-task="${encodeURIComponent(record.id || "")}">
    <div class="task-card-head">
      <div>
        <div class="task-title">${escapeHtml(record.title || record.id || t("common.unknown"))}</div>
        <div class="task-subtitle">${escapeHtml(subtitle || "")}</div>
      </div>
      <div class="badge-row">
        ${renderBadge(record.repoName, "accent")}
        ${renderBadge(formatStageLabel(record.stage, locale), "accent")}
        ${renderBadge(formatRoleLabel(record.role, locale), "accent")}
        ${renderBadge(formatTaskStatusLabel(record.status || "pending", locale), badgeClass(record.status || "pending"))}
        ${record.synthetic ? renderBadge(t("common.statusSignal"), "warn") : ""}
      </div>
    </div>
    <div class="task-body">
      <div class="task-copy">${escapeHtml(goal)}</div>
      <div class="task-footer">${footer}</div>
    </div>
  </button>`;
}

export function renderQueueSection(title, description, records, locale, t) {
  return `<section class="queue-card">
    <div class="panel-head">
      <div><div class="section-kicker">${escapeHtml(description)}</div><h3>${escapeHtml(title)}</h3></div>
      ${renderBadge(`${records.length}`, "accent")}
    </div>
    <div class="queue-list">${records.length ? records.map((record) => renderTaskCard(record, locale, t, { compact: true })).join("") : `<div class="empty-state">${escapeHtml(t("common.emptyTasks"))}</div>`}</div>
  </section>`;
}

export function renderQueueSummary(records, locale, t, emptyText) {
  if (!records.length) {
    return `<div class="empty-state compact">${escapeHtml(emptyText || t("common.emptyTasks"))}</div>`;
  }
  return `<div class="mini-task-list">${records.map((record) => renderTaskCard(record, locale, t, { compact: true })).join("")}</div>`;
}

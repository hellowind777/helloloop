import {
  FAILURE_CODE_LABELS,
  HTTP_STATUS_LABELS,
  RELATION_LABELS,
  ROLE_LABELS,
  SCHEDULER_LABELS,
  SCHEDULER_MODE_LABELS,
  SESSION_STATUS_LABELS,
  STAGE_LABELS,
  STATUS_LABELS,
  WAIT_LABELS,
} from "./dashboard_web_client_locale_labels.mjs";

function resolveLocale(locale) {
  return String(locale || "").trim() === "en-US" ? "en-US" : "zh-CN";
}

function fallbackText(locale, zhText, enText) {
  return resolveLocale(locale) === "en-US" ? enText : zhText;
}

function pickLabel(map, key, locale, zhFallback, enFallback) {
  const resolved = resolveLocale(locale);
  return map[resolved]?.[key]
    || map["zh-CN"]?.[key]
    || key
    || fallbackText(resolved, zhFallback, enFallback);
}

export function formatClock(value, locale = "zh-CN") {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return "--:--:--";
  }
  return date.toLocaleTimeString(resolveLocale(locale), { hour12: false });
}

export function formatStageLabel(stage, locale = "zh-CN") {
  return pickLabel(STAGE_LABELS, stage, locale, "开发实现", "Implementation");
}

export function formatRoleLabel(role, locale = "zh-CN") {
  return pickLabel(ROLE_LABELS, role, locale, "开发实现", "Developer");
}

export function formatSchedulerMode(mode, locale = "zh-CN") {
  return pickLabel(SCHEDULER_MODE_LABELS, mode, locale, "待命", "Idle");
}

export function formatRelationLabel(value, locale = "zh-CN") {
  return pickLabel(RELATION_LABELS, value, locale, "关系", "Relation");
}

export function formatTaskStatusLabel(status, locale = "zh-CN") {
  return pickLabel(STATUS_LABELS, status, locale, "待处理", "Pending");
}

export function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function badgeClass(kind) {
  if (["done", "running", "ready", "completed", "active", "active_task", "ready_next_task"].includes(kind)) {
    return "ok";
  }
  if (["blocked", "failed", "blocked_failed", "paused_manual", "stopped_host_closed", "manual_fix_required", "host_closed"].includes(kind)) {
    return "danger";
  }
  if ([
    "paused_operator",
    "retry_waiting",
    "probe_waiting",
    "probe_running",
    "recovering",
    "watchdog_waiting",
    "watchdog_terminating",
    "lease_terminating",
    "blocked_manual_input",
    "blocked_stage_gates",
    "blocked_dependencies",
    "blocked_external",
    "waiting_stage_gate",
    "waiting_dependency",
    "waiting_external_dependency",
    "waiting_manual_input",
    "blocked_risk",
    "waiting_risk_release",
  ].includes(kind)) {
    return "warn";
  }
  return "accent";
}

export function statusBadgeClass(subject) {
  const severity = subject.statusModel?.severity || "accent";
  return severity === "ok" ? "ok" : severity === "warn" ? "warn" : severity === "danger" ? "danger" : "accent";
}

export function failureBadgeClass(subject) {
  if (!subject.statusModel?.failure?.label) {
    return "accent";
  }
  return subject.statusModel.failure.retryable ? "warn" : "danger";
}

export function formatSessionStatusLabel(subject, locale = "zh-CN") {
  const code = String(subject.statusModel?.code || subject.sessionStatusCode || subject.runtime?.status || "").trim();
  return pickLabel(
    SESSION_STATUS_LABELS,
    code,
    locale,
    subject.sessionStatusLabel || subject.runtime?.status || "未知",
    subject.sessionStatusLabel || subject.runtime?.status || "Unknown",
  );
}

function formatSchedulerLabel(subject, locale = "zh-CN") {
  const state = String(subject.statusModel?.scheduler?.state || "").trim();
  return pickLabel(SCHEDULER_LABELS, state, locale, "未知", "Unknown");
}

function formatFailureLabel(subject, locale = "zh-CN") {
  const failure = subject.statusModel?.failure || subject.failure || null;
  if (!failure && subject.failureSummary) {
    return subject.failureSummary;
  }
  if (failure?.httpStatusCode && HTTP_STATUS_LABELS[resolveLocale(locale)][failure.httpStatusCode]) {
    return HTTP_STATUS_LABELS[resolveLocale(locale)][failure.httpStatusCode];
  }
  if (failure?.code && FAILURE_CODE_LABELS[resolveLocale(locale)][failure.code]) {
    return FAILURE_CODE_LABELS[resolveLocale(locale)][failure.code];
  }
  return failure?.label || fallbackText(locale, "无", "None");
}

export function formatFailureSummary(subject, locale = "zh-CN") {
  if (!subject.statusModel?.failure && subject.failureSummary) {
    return subject.failureSummary;
  }
  const detail = subject.statusModel?.failure?.detail || "";
  return [formatFailureLabel(subject, locale), detail].filter(Boolean).join(" · ") || fallbackText(locale, "无", "None");
}

function formatWaitLabel(subject, locale = "zh-CN") {
  const wait = subject.statusModel?.wait || subject.wait || {};
  if (!subject.statusModel?.wait && subject.waitSummary && !wait.type) {
    return subject.waitSummary;
  }
  return pickLabel(WAIT_LABELS, wait.type, locale, "无", "None");
}

export function formatWaitSummary(subject, locale = "zh-CN") {
  if (!subject.statusModel?.wait && subject.waitSummary) {
    return subject.waitSummary;
  }
  return [formatWaitLabel(subject, locale), subject.statusModel?.waitTargetLabel || subject.waitTargetLabel]
    .filter(Boolean)
    .join(" · ")
    || fallbackText(locale, "无", "None");
}

export function formatSchedulerSummary(subject, locale = "zh-CN") {
  if (!subject.statusModel?.scheduler && subject.schedulerSummary) {
    return subject.schedulerSummary;
  }
  const scheduler = subject.statusModel?.scheduler || {};
  if (!scheduler.label && !scheduler.state) {
    return fallbackText(locale, "无", "None");
  }
  const details = [formatSchedulerLabel(subject, locale)];
  if (scheduler.mode) {
    details.push(formatSchedulerMode(scheduler.mode, locale));
  }
  if (scheduler.willAutoResume === true) {
    details.push(fallbackText(locale, "满足条件后自动继续", "auto-resumes when conditions are met"));
  }
  return details.join(" · ");
}

export function currentActionText(subject) {
  return subject.currentAction
    || subject.statusModel?.currentAction
    || subject.currentActionLabel
    || subject.activity?.current?.label
    || subject.latestStatus?.message
    || subject.runtime?.failureReason
    || "等待新事件";
}

export function formatCountdownValue(target, locale = "zh-CN") {
  const targetTime = target ? new Date(target).getTime() : Number.NaN;
  if (!Number.isFinite(targetTime)) {
    return "--:--";
  }
  const remainingMs = targetTime - Date.now();
  if (remainingMs <= 0) {
    return fallbackText(locale, "即将重试", "Retrying soon");
  }
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

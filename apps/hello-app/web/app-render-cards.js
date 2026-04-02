import { escapeHtml, formatDate, translate } from "./app-i18n.js";

export function renderConnectionPill(state) {
  return `
    <div class="status-chip">
      <span class="status-dot ${state.connected ? "online" : "offline"}"></span>
      <span>${escapeHtml(state.connected ? t(state, "connected") : t(state, "disconnected"))}</span>
    </div>
  `;
}

export function navCard(view, title, subtitle, active) {
  return `<button class="nav-item ${active ? "active" : ""}" data-view="${escapeHtml(view)}" type="button"><strong>${escapeHtml(title)}</strong><span class="brand-subtitle">${escapeHtml(subtitle)}</span></button>`;
}

export function miniMetric(label, value) {
  return `<div class="mini-metric"><span class="meta-label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

export function metricCard(label, value, copy) {
  return `<div class="metric-card"><div class="meta-label">${escapeHtml(label)}</div><div class="metric-value">${escapeHtml(value)}</div><div class="meta-value">${escapeHtml(copy)}</div></div>`;
}

export function renderSessionCard(state, session) {
  const detail = [session.current_action, session.current_task].filter(Boolean).join(" · ") || t(state, "none");
  return `
    <article class="session-card ${session.id === state.selectedSessionId ? "active" : ""} ${sessionStateClass(session.state)}" data-session-id="${escapeHtml(session.id)}">
      <div class="card-topline">
        <strong class="card-title">${escapeHtml(session.title)}</strong>
        <span class="badge ${stateBadgeClass(session.state)}">${escapeHtml(stateText(state, session.state))}</span>
      </div>
      <p class="task-copy">${escapeHtml(session.reason_label || t(state, "none"))}</p>
      <div class="detail-inline">
        <span>${escapeHtml(detail)}</span>
        <span>${escapeHtml(formatDate(state.locale, session.last_heartbeat_at) || t(state, "none"))}</span>
      </div>
      <div class="badges wrap">${sessionBadges(session)}</div>
    </article>
  `;
}

export function taskColumn(state, title, tasks) {
  return `
    <div class="task-column">
      <div class="task-column-head">
        <h4 class="task-column-title">${escapeHtml(title)}</h4>
        <span class="badge neutral">${escapeHtml(String(tasks.length))}</span>
      </div>
      <div class="task-stack">${tasks.length ? tasks.map((task) => renderTaskCard(state, task)).join("") : `<div class="empty">${escapeHtml(t(state, "noTasks"))}</div>`}</div>
    </div>
  `;
}

export function renderEventCard(state, event) {
  const payload = event.payload || {};
  return `
    <article class="timeline-item">
      <div class="timeline-meta">
        <strong class="card-title">${escapeHtml(event.event_type || "command_center")}</strong>
        <span class="timeline-label">${escapeHtml(formatDate(state.locale, event.created_at || payload.updated_at) || t(state, "none"))}</span>
      </div>
      <p class="timeline-copy">${escapeHtml(payload.focus_summary || payload.workspace_label || t(state, "none"))}</p>
    </article>
  `;
}

export function renderHostCard(host) {
  return `
    <article class="capability-card">
      <strong class="card-title">${escapeHtml(host.display_name)}</strong>
      <p class="capability-copy">${escapeHtml(host.notes || "")}</p>
      <div class="badges wrap">
        ${badge(host.supports_background ? "background" : "foreground", host.supports_background ? "ok" : "warn")}
        ${badge(host.supports_streaming ? "streaming" : "batch", host.supports_streaming ? "ok" : "warn")}
        ${badge(host.supports_worktree ? "worktree" : "single-tree", host.supports_worktree ? "ok" : "neutral")}
      </div>
    </article>
  `;
}

export function renderFocusWorkspace(state, detail) {
  if (!detail) {
    return `<div class="empty">${escapeHtml(t(state, "noSessions"))}</div>`;
  }
  const blockerState = detail.blocker_signature
    ? (detail.blocker_acknowledged
      ? `${t(state, "reviewed")} · ${formatDate(state.locale, detail.blocker_acknowledged_at) || t(state, "noneShort")}`
      : t(state, "pendingReview"))
    : t(state, "noneShort");
  const failureSummary = [
    detail.session.failure?.http_status_label,
    detail.session.failure?.label,
    detail.session.failure?.detail,
  ].filter(Boolean).join(" · ") || t(state, "none");
  const waitSummary = [
    detail.session.wait?.label,
    detail.session.wait?.target_label,
    detail.session.wait?.until ? formatDate(state.locale, detail.session.wait.until) : "",
  ].filter(Boolean).join(" · ") || t(state, "none");
  const schedulerSummary = [
    detail.session.scheduler?.label,
    detail.session.scheduler?.reason,
    detail.session.scheduler?.mode,
  ].filter(Boolean).join(" · ") || t(state, "none");
  const controlPosture = detail.session.scheduler?.will_auto_resume
    ? t(state, "willAutoResume")
    : t(state, "manualFollowup");

  return `
    <div class="focus-sections">
      <section class="focus-section">
        <div class="section-kicker">${escapeHtml(t(state, "detailSummary"))}</div>
        <div class="detail-grid">
          ${detailRow(state, "host", formatHostName(detail.session.host) || t(state, "none"))}
          ${detailRow(state, "role", detail.session.role || t(state, "none"))}
          ${detailRow(state, "lane", detail.session.lane || t(state, "none"))}
          ${detailRow(state, "severity", detail.session.severity || t(state, "none"))}
          ${detailRow(state, "scheduler", detail.session.scheduler?.label || t(state, "none"))}
          ${detailRow(state, "heartbeat", formatDate(state.locale, detail.session.last_heartbeat_at) || t(state, "none"))}
        </div>
      </section>
      <section class="focus-section">
        <div class="section-kicker">${escapeHtml(t(state, "statusSemantics"))}</div>
        <div class="summary-grid">
          ${summaryCard(t(state, "stateLabel"), stateText(state, detail.session.state))}
          ${summaryCard(t(state, "reasonLabel"), detail.session.reason_label || t(state, "none"))}
          ${summaryCard(t(state, "controlPosture"), controlPosture)}
          ${summaryCard(t(state, "blockerState"), blockerState)}
        </div>
        <div class="semantic-grid">
          ${semanticCard(state, "schedulerMode", schedulerSummary, detail.session.scheduler?.will_auto_resume ? "ok" : "warn")}
          ${semanticCard(state, "waitStatus", waitSummary, detail.session.wait?.resumes_automatically ? "accent" : "warn")}
          ${semanticCard(state, "failureStatus", failureSummary, detail.session.failure?.http_status ? (detail.session.failure.http_status >= 500 ? "danger" : "warn") : "neutral")}
          ${semanticCard(state, "autoResume", detail.session.auto_action || t(state, "none"), detail.session.scheduler?.will_auto_resume ? "ok" : "neutral")}
        </div>
      </section>
      <section class="focus-section">
        <div class="section-kicker">${escapeHtml(t(state, "recoverySummary"))}</div>
        <div class="summary-grid">
          ${summaryCard(t(state, "currentAction"), detail.session.current_action || t(state, "none"))}
          ${summaryCard(t(state, "nextActionSummary"), detail.next_action_summary || t(state, "none"))}
          ${summaryCard(t(state, "recoverySummary"), detail.recovery_summary || t(state, "none"))}
          ${summaryCard(t(state, "dependsOn"), detail.blocker_labels.join("、") || t(state, "none"))}
          ${summaryCard(t(state, "currentTask"), detail.session.current_task || t(state, "none"))}
          ${summaryCard(t(state, "nextTask"), detail.session.next_task || t(state, "none"))}
          ${summaryCard(t(state, "acknowledgment"), blockerState)}
          ${summaryCard(t(state, "scheduler"), schedulerSummary)}
        </div>
      </section>
      <section class="focus-section">
        <div class="section-kicker">${escapeHtml(t(state, "operatorActions"))}</div>
        <div class="action-grid">
          ${detail.available_actions.length ? detail.available_actions.map((action) => renderActionCard(state, action)).join("") : `<div class="empty">${escapeHtml(t(state, "none"))}</div>`}
        </div>
      </section>
      <section class="focus-section">
        <div class="section-kicker">${escapeHtml(t(state, "sessionTasks"))}</div>
        <div class="focus-task-groups">
          ${focusTaskList(state, t(state, "runningTasks"), detail.running_tasks)}
          ${focusTaskList(state, t(state, "waitingTasks"), detail.blocked_tasks)}
          ${focusTaskList(state, t(state, "readyTasks"), detail.ready_tasks)}
          ${focusTaskList(state, t(state, "completedTasks"), detail.completed_tasks)}
        </div>
      </section>
      <section class="focus-section">
        <div class="section-kicker">${escapeHtml(t(state, "dependencyMap"))}</div>
        <div class="dependency-list">
          ${renderDependencyGroup(state, t(state, "dependencyMap"), detail.dependency_labels)}
          ${renderDependencyGroup(state, t(state, "blockerMap"), detail.blocker_labels)}
        </div>
      </section>
    </div>
  `;
}

export function sessionBadges(session) {
  return [
    badge(formatHostName(session.host), "accent"),
    session.role ? badge(session.role, "neutral") : "",
    session.lane ? badge(session.lane, "neutral") : "",
    session.http_status ? badge(`HTTP ${session.http_status}`, session.http_status >= 500 ? "danger" : "warn") : "",
  ].filter(Boolean).join("");
}

export function countWaitingSessions(sessions) {
  return sessions.filter((item) => ["waiting_dependency", "waiting_external_signal", "retry_scheduled", "rate_limited", "failed_recoverable", "failed_terminal", "human_input_required"].includes(item.state)).length;
}

export function summarizeRisk(state, sessions) {
  const danger = sessions.filter((item) => ["failed_terminal", "failed_recoverable", "human_input_required"].includes(item.state)).length;
  const waiting = sessions.filter((item) => ["waiting_dependency", "waiting_external_signal", "retry_scheduled", "rate_limited"].includes(item.state)).length;
  return state.locale === "zh-CN"
    ? `${danger} 严重 · ${waiting} 等待`
    : `${danger} critical · ${waiting} waiting`;
}

export function summarizeHosts(state) {
  return state.hosts.map((item) => item.kind).join(" · ") || t(state, "none");
}

function renderTaskCard(state, task) {
  const meta = [task.stage, task.owner_role, task.lane, task.priority].filter(Boolean).join(" · ");
  return `
    <article class="task-card">
      <div class="task-meta">
        <strong class="card-title">${escapeHtml(task.title)}</strong>
        <span class="badge ${stateBadgeClass(task.state)}">${escapeHtml(stateText(state, task.state))}</span>
      </div>
      <p class="task-copy">${escapeHtml(meta || t(state, "none"))}</p>
      ${task.depends_on?.length ? `<div class="task-deps">${escapeHtml(task.depends_on.join("、"))}</div>` : ""}
    </article>
  `;
}

function focusTaskList(state, title, tasks) {
  return `
    <div class="focus-task-list">
      <div class="task-column-head">
        <strong>${escapeHtml(title)}</strong>
        <span class="badge neutral">${escapeHtml(String(tasks.length))}</span>
      </div>
      <div class="mini-stack">${tasks.length ? tasks.map((task) => renderTaskCard(state, task)).join("") : `<div class="empty">${escapeHtml(t(state, "noTasks"))}</div>`}</div>
    </div>
  `;
}

function renderDependencyGroup(state, title, items) {
  return `
    <div class="dependency-card">
      <strong class="card-title">${escapeHtml(title)}</strong>
      <div class="token-list">
        ${(items?.length ? items : [t(state, "noDependencies")]).map((item) => items?.length
          ? `<button class="token-button" data-dependency-filter="${escapeHtml(item)}" type="button">${escapeHtml(item)}</button>`
          : `<span class="token">${escapeHtml(item)}</span>`).join("")}
      </div>
    </div>
  `;
}

function renderActionCard(state, action) {
  const label = t(state, `action.${action.key}`) === `action.${action.key}` ? action.label : t(state, `action.${action.key}`);
  const localizedReason = t(state, `action_reason.${action.key}`) === `action_reason.${action.key}`
    ? (action.reason || t(state, "none"))
    : t(state, `action_reason.${action.key}`);
  const canTrigger = action.implemented && action.method === "POST";
  return `
    <div class="action-card">
      <div class="card-topline">
        <strong class="card-title">${escapeHtml(label)}</strong>
        <span class="badge ${action.implemented ? "ok" : "warn"}">${escapeHtml(action.implemented ? t(state, "availableNow") : t(state, "comingSoon"))}</span>
      </div>
      <p class="task-copy">${escapeHtml(localizedReason)}</p>
      <div class="action-meta">${escapeHtml(action.method)} · ${escapeHtml(action.endpoint)}</div>
      <button class="button ${action.kind === "primary" ? "primary" : ""}" ${canTrigger ? `data-control-endpoint="${escapeHtml(action.endpoint)}"` : "disabled"}>${escapeHtml(label)}</button>
    </div>
  `;
}

function summaryCard(label, value) {
  return `<div class="summary-card"><div class="detail-key">${escapeHtml(label)}</div><div class="detail-value">${escapeHtml(value)}</div></div>`;
}

function semanticCard(state, labelKey, value, tone = "neutral") {
  return `
    <div class="semantic-card ${tone}">
      <div class="detail-key">${escapeHtml(t(state, labelKey))}</div>
      <div class="detail-value">${escapeHtml(value || t(state, "none"))}</div>
    </div>
  `;
}

function detailRow(state, labelKey, value) {
  return `<div class="detail-card"><div class="detail-key">${escapeHtml(t(state, labelKey))}</div><div class="detail-value">${escapeHtml(value)}</div></div>`;
}

function badge(text, kind) {
  return `<span class="badge ${kind}">${escapeHtml(text)}</span>`;
}

function stateText(state, value) {
  const translationKey = `session_state.${value}`;
  return t(state, translationKey) === translationKey ? String(value || "") : t(state, translationKey);
}

function formatHostName(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  if (normalized === "codex") {
    return "Codex";
  }
  if (normalized === "claude") {
    return "Claude";
  }
  if (normalized === "gemini") {
    return "Gemini";
  }
  return value;
}

function stateBadgeClass(value) {
  if (value === "completed") {
    return "ok";
  }
  if (value === "running") {
    return "accent";
  }
  if (["failed_terminal", "failed_recoverable", "human_input_required"].includes(value)) {
    return "danger";
  }
  return "warn";
}

function sessionStateClass(value) {
  if (value === "running") {
    return "is-running";
  }
  if (["failed_terminal", "failed_recoverable", "human_input_required"].includes(value)) {
    return "is-danger";
  }
  return "";
}

function t(state, key) {
  return translate(state.locale, key);
}

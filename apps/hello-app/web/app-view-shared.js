import { escapeHtml, formatDate, translate } from "./app-i18n.js";
import {
  renderEventCard,
  renderHostCard,
  renderSessionCard,
  taskColumn,
} from "./app-render-cards.js";

export function renderSessionsSection(state, sessions, title) {
  return `
    <section class="panel">
      <div class="section-header">
        <div>
          <div class="section-kicker">${escapeHtml(t(state, "sessions"))}</div>
          <h3 class="section-title">${escapeHtml(title)}</h3>
        </div>
      </div>
      <div class="session-list">
        ${sessions.length ? sessions.map((session) => renderSessionCard(state, session)).join("") : `<div class="empty">${escapeHtml(t(state, "noSessions"))}</div>`}
      </div>
    </section>
  `;
}

export function renderHostsSection(state) {
  return `
    <section class="panel">
      <div class="section-header">
        <div>
          <div class="section-kicker">${escapeHtml(t(state, "hosts"))}</div>
          <h3 class="section-title">${escapeHtml(t(state, "capabilities"))}</h3>
        </div>
      </div>
      <div class="capability-list">
        ${state.hosts.length ? state.hosts.map(renderHostCard).join("") : `<div class="empty">${escapeHtml(t(state, "none"))}</div>`}
      </div>
    </section>
  `;
}

export function renderTasksSection(state, tasks, title) {
  return `
    <section class="panel">
      <div class="section-header">
        <div>
          <div class="section-kicker">${escapeHtml(t(state, "tasks"))}</div>
          <h3 class="section-title">${escapeHtml(title)}</h3>
        </div>
      </div>
      <div class="task-columns">
        ${taskColumn(state, t(state, "ready"), tasks.filter((item) => item.state === "ready"))}
        ${taskColumn(state, t(state, "running"), tasks.filter((item) => item.state === "running"))}
        ${taskColumn(state, t(state, "blocked"), tasks.filter((item) => !["ready", "running", "completed"].includes(item.state)))}
        ${taskColumn(state, t(state, "completed"), tasks.filter((item) => item.state === "completed"))}
      </div>
    </section>
  `;
}

export function renderTimelineSection(state, title) {
  return `
    <section class="panel">
      <div class="section-header">
        <div>
          <div class="section-kicker">${escapeHtml(t(state, "timeline"))}</div>
          <h3 class="section-title">${escapeHtml(title)}</h3>
        </div>
      </div>
      <div class="timeline-list">
        ${state.events.length ? state.events.map((item) => renderEventCard(state, item)).join("") : `<div class="empty">${escapeHtml(t(state, "noEvents"))}</div>`}
      </div>
    </section>
  `;
}

export function renderLaneCard(state, lane) {
  return `
    <div class="lane-card">
      <div class="card-topline">
        <strong class="card-title">${escapeHtml(lane.name)}</strong>
        <button class="filter-chip ${state.filterLane === lane.name ? "active" : ""}" data-filter-lane="${escapeHtml(lane.name)}" type="button">${escapeHtml(String(lane.tasks.length))}</button>
      </div>
      <p class="task-copy">${escapeHtml([`${lane.tasks.length} ${t(state, "tasks")}`, `${lane.sessions.length} ${t(state, "sessions")}`].join(" · "))}</p>
      <div class="badges wrap">
        ${railPill(t(state, "running"), String(lane.runningCount), lane.runningCount ? "accent" : "neutral")}
        ${railPill(t(state, "blocked"), String(lane.blockedCount), lane.blockedCount ? "warn" : "neutral")}
        ${railPill(t(state, "completed"), String(lane.completedCount), lane.completedCount ? "ok" : "neutral")}
      </div>
      <div class="detail-inline">
        <span>${escapeHtml(t(state, "nextTask"))}</span>
        <span>${escapeHtml(lane.nextTask || t(state, "none"))}</span>
      </div>
    </div>
  `;
}

export function renderSessionGroup(state, groupKey, items) {
  const label = t(state, `session_state.${groupKey}`) === `session_state.${groupKey}`
    ? groupKey
    : t(state, `session_state.${groupKey}`);
  return `
    <div class="focus-task-list">
      <div class="task-column-head">
        <strong>${escapeHtml(label)}</strong>
        <span class="badge neutral">${escapeHtml(String(items.length))}</span>
      </div>
      <div class="mini-stack">
        ${items.length ? items.map((session) => renderSessionCard(state, session)).join("") : `<div class="empty">${escapeHtml(t(state, "noSessions"))}</div>`}
      </div>
    </div>
  `;
}

export function renderFlowNode(state, task, allTasks) {
  const dependencyLabels = dependencyTitles(task, allTasks);
  return `
    <article class="flow-node ${task.state}">
      <div class="card-topline">
        <strong class="card-title">${escapeHtml(task.title)}</strong>
        <button class="filter-chip ${state.filterLane === taskLane(task) ? "active" : ""}" data-filter-lane="${escapeHtml(taskLane(task))}" type="button">${escapeHtml(taskLane(task))}</button>
      </div>
      <p class="task-copy">${escapeHtml([task.stage, task.owner_role, task.priority].filter(Boolean).join(" · ") || t(state, "none"))}</p>
      <div class="token-list">
        ${dependencyLabels.length
          ? dependencyLabels.map((item) => `<button class="token-button" data-dependency-filter="${escapeHtml(item)}" type="button">${escapeHtml(item)}</button>`).join("")
          : `<span class="token">${escapeHtml(t(state, "noDependencies"))}</span>`}
      </div>
    </article>
  `;
}

export function infoCard(label, value, helper = "") {
  return `
    <div class="detail-card">
      <div class="detail-key">${escapeHtml(label)}</div>
      <div class="detail-value">${escapeHtml(String(value || ""))}</div>
      ${helper ? `<div class="meta-value">${escapeHtml(helper)}</div>` : ""}
    </div>
  `;
}

export function railPill(label, value, tone) {
  const content = value ? `${label} · ${value}` : label;
  return `<span class="badge ${tone}">${escapeHtml(content)}</span>`;
}

export function buildLaneRows(tasks, sessions) {
  const lanes = new Map();
  for (const task of tasks) {
    const name = taskLane(task);
    ensureLane(lanes, name).tasks.push(task);
  }
  for (const session of sessions) {
    const name = session.lane || session.role || "mainline";
    ensureLane(lanes, name).sessions.push(session);
  }
  return [...lanes.values()].map((lane) => {
    const states = lane.tasks.map((task) => task.state);
    return {
      ...lane,
      runningCount: states.filter((state) => state === "running").length,
      blockedCount: states.filter((state) => !["ready", "running", "completed"].includes(state)).length,
      completedCount: states.filter((state) => state === "completed").length,
      nextTask: lane.tasks.find((task) => task.state !== "completed")?.title || "",
    };
  });
}

export function applyTaskFilters(state, tasks) {
  return tasks.filter((task) => {
    const laneMatches = !state.filterLane || taskLane(task) === state.filterLane;
    const dependencyLabels = dependencyTitles(task, tasks);
    const dependencyMatches = !state.filterDependency
      || dependencyLabels.includes(state.filterDependency)
      || String(task.title || "") === state.filterDependency;
    return laneMatches && dependencyMatches;
  });
}

export function dependencyTitles(task, allTasks) {
  return (task.depends_on || []).map((dependencyId) => {
    const matched = allTasks.find((item) => item.id === dependencyId || item.title === dependencyId);
    return matched?.title || dependencyId;
  });
}

export function latestEventSummary(state, event, snapshot) {
  if (event?.payload?.focus_summary) {
    return event.payload.focus_summary;
  }
  if (event?.event_type) {
    return `${event.event_type} · ${formatDate(state.locale, event.created_at) || t(state, "noneShort")}`;
  }
  return `${snapshot?.workspace_label || "HelloLoop"} · ${formatDate(state.locale, snapshot?.updated_at) || t(state, "noneShort")}`;
}

export function groupSessionsByState(sessions) {
  return sessions.reduce((groups, session) => {
    const key = session.state || "unknown";
    groups[key] ||= [];
    groups[key].push(session);
    return groups;
  }, {});
}

export function countBlocked(sessions, tasks) {
  return sessions.filter((item) => !["ready", "running", "completed"].includes(item.state)).length
    + tasks.filter((item) => !["ready", "running", "completed"].includes(item.state)).length;
}

function ensureLane(lanes, name) {
  if (!lanes.has(name)) {
    lanes.set(name, { name, tasks: [], sessions: [] });
  }
  return lanes.get(name);
}

function taskLane(task) {
  return task.lane || task.owner_role || "mainline";
}

function t(state, key) {
  return translate(state.locale, key);
}

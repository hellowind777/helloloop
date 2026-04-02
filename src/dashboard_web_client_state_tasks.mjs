import { PRIORITY_RANK, STAGE_ORDER } from "./dashboard_web_client_locale_labels.mjs";
import {
  currentActionText,
  formatFailureSummary,
  formatSchedulerSummary,
  formatWaitSummary,
} from "./dashboard_web_client_state_format.mjs";

function normalizeText(value) {
  return String(value || "").trim();
}

function stageRank(stage) {
  const index = STAGE_ORDER.indexOf(String(stage || ""));
  return index >= 0 ? index : STAGE_ORDER.length + 1;
}

function priorityRank(priority) {
  return PRIORITY_RANK[String(priority || "P9").toUpperCase()] ?? 99;
}

function isCurrentTask(session, task) {
  if (!task) {
    return false;
  }
  if (task.status === "in_progress") {
    return true;
  }
  if (session.latestStatus?.taskId && task.id === session.latestStatus.taskId) {
    return true;
  }
  return Boolean(!session.latestStatus?.taskId && session.latestStatus?.taskTitle && task.title === session.latestStatus.taskTitle);
}

function buildTaskRecord(session, task, options = {}) {
  const blockedBy = Array.isArray(task.blockedBy) ? task.blockedBy : [];
  return {
    ...task,
    synthetic: options.synthetic === true,
    queueKind: options.queueKind || "",
    sessionId: session.sessionId,
    sessionKey: session.sessionKey,
    repoName: session.repoName,
    repoRoot: session.repoRoot,
    displaySessionId: session.displaySessionId || session.sessionId || "",
    statusModel: session.statusModel || null,
    runtime: session.runtime || {},
    workflow: session.workflow || null,
    docAnalysis: session.docAnalysis || null,
    hostResumeLabel: session.hostResumeLabel || "",
    currentAction: currentActionText(session),
    sessionStatusCode: session.statusModel?.code || session.runtime?.status || "",
    sessionStatusLabel: session.statusModel?.label || session.runtime?.status || "",
    isCurrent: options.synthetic === true ? options.queueKind === "current" : isCurrentTask(session, task),
    docsCount: Array.isArray(task.docs) ? task.docs.length : 0,
    pathsCount: Array.isArray(task.paths) ? task.paths.length : 0,
    artifactsCount: Array.isArray(task.artifacts) ? task.artifacts.length : 0,
    blockedCount: blockedBy.length,
  };
}

export function toTaskRecord(session, task, options = {}) {
  return buildTaskRecord(session, task, options);
}

function buildSyntheticQueueRecord(session, queueKind) {
  if (queueKind === "current" && (session.latestStatus?.taskTitle || session.statusModel?.currentAction)) {
    return buildTaskRecord(session, {
      id: `synthetic-current-${session.sessionId}`,
      title: session.latestStatus?.taskTitle || session.statusModel?.currentAction || "当前执行中",
      status: "in_progress",
      stage: session.latestStatus?.stage || "implementation",
      role: "supervisor",
      lane: "mainline",
      priority: "P1",
      risk: "low",
      goal: currentActionText(session),
      acceptance: [],
      docs: [],
      paths: [],
      blockedBy: [],
      artifacts: [],
    }, { synthetic: true, queueKind });
  }

  if (queueKind === "blocked" && (session.statusModel?.waitTargetLabel || session.statusModel?.reason || session.statusModel?.failure?.label)) {
    return buildTaskRecord(session, {
      id: `synthetic-blocked-${session.sessionId}`,
      title: session.statusModel?.waitTargetLabel || session.statusModel?.reason || session.statusModel?.failure?.label || "等待处理",
      status: session.statusModel?.severity === "danger" ? "failed" : "blocked",
      stage: session.latestStatus?.stage || "implementation",
      role: "supervisor",
      lane: "mainline",
      priority: "P1",
      risk: "medium",
      goal: [session.statusModel?.reason, session.statusModel?.failure?.detail].filter(Boolean).join(" · "),
      acceptance: [],
      docs: [],
      paths: [],
      blockedBy: [],
      artifacts: [],
    }, { synthetic: true, queueKind });
  }

  return null;
}

function sortTaskRecords(records, { newestDone = false } = {}) {
  return [...records].sort((left, right) => {
    const byStage = stageRank(left.stage) - stageRank(right.stage);
    if (byStage !== 0) {
      return byStage;
    }
    const byPriority = priorityRank(left.priority) - priorityRank(right.priority);
    if (byPriority !== 0) {
      return byPriority;
    }
    if (newestDone) {
      return String(right.finishedAt || right.updatedAt || "").localeCompare(String(left.finishedAt || left.updatedAt || ""), "zh-CN");
    }
    return String(left.title || "").localeCompare(String(right.title || ""), "zh-CN");
  });
}

function recordMatchesText(record, query) {
  const needle = normalizeText(query).toLowerCase();
  if (!needle) {
    return true;
  }
  const haystack = [
    record.repoName,
    record.repoRoot,
    record.title,
    record.goal,
    record.stage,
    record.role,
    record.lane,
    record.currentAction,
    record.workflow?.currentFocus,
    record.docAnalysis?.summary,
    record.statusModel?.reason,
    record.statusModel?.waitTargetLabel,
    record.statusModel?.failure?.label,
    record.statusModel?.failure?.detail,
    ...(Array.isArray(record.acceptance) ? record.acceptance : []),
    ...(Array.isArray(record.docs) ? record.docs : []),
    ...(Array.isArray(record.paths) ? record.paths : []),
  ]
    .map((item) => normalizeText(item).toLowerCase())
    .join("\n");
  return haystack.includes(needle);
}

function listSessionTaskRecords(session) {
  return Array.isArray(session.tasks) ? session.tasks.map((task) => buildTaskRecord(session, task)) : [];
}

export function listTaskRecords(snapshot) {
  return (snapshot.sessions || []).flatMap((session) => listSessionTaskRecords(session));
}

export function filterTaskRecords(records, filters = {}) {
  return records.filter((record) => {
    if (filters.repo && filters.repo !== "all" && record.repoName !== filters.repo) {
      return false;
    }
    if (filters.stage && filters.stage !== "all" && String(record.stage || "") !== filters.stage) {
      return false;
    }
    if (filters.status && filters.status !== "all" && String(record.status || "pending") !== filters.status) {
      return false;
    }
    if (
      filters.attentionOnly
      && !["blocked", "failed", "in_progress"].includes(String(record.status || ""))
      && !record.isCurrent
      && !["warn", "danger"].includes(String(record.statusModel?.severity || ""))
    ) {
      return false;
    }
    return recordMatchesText(record, filters.text);
  });
}

function buildSessionSearchRecord(session) {
  return buildTaskRecord(session, {
    id: `session-${session.sessionId}`,
    title: session.repoName,
    status: "pending",
    stage: session.latestStatus?.stage || "",
    role: "supervisor",
    lane: "mainline",
    goal: [
      session.workflow?.currentFocus,
      session.statusModel?.reason,
      session.docAnalysis?.summary,
      currentActionText(session),
    ].filter(Boolean).join(" · "),
  }, { synthetic: true });
}

export function sessionMatchesFilters(session, filters = {}) {
  if (filters.repo && filters.repo !== "all" && session.repoName !== filters.repo) {
    return false;
  }

  const records = listSessionTaskRecords(session);
  if (filterTaskRecords(records, { ...filters, repo: session.repoName }).length) {
    return true;
  }

  if (filters.stage && filters.stage !== "all") {
    return false;
  }
  if (filters.status && filters.status !== "all") {
    return false;
  }
  if (filters.attentionOnly && !["warn", "danger"].includes(String(session.statusModel?.severity || ""))) {
    return false;
  }
  if (!normalizeText(filters.text)) {
    return true;
  }
  return recordMatchesText(buildSessionSearchRecord(session), filters.text);
}

export function buildSessionQueues(session, filters = {}) {
  const records = filterTaskRecords(listSessionTaskRecords(session), { ...filters, repo: session.repoName });
  const current = sortTaskRecords(records.filter((record) => record.isCurrent)).slice(0, 3);
  const next = sortTaskRecords(records.filter((record) => record.status === "pending")).slice(0, 4);
  const blocked = sortTaskRecords(records.filter((record) => ["blocked", "failed"].includes(record.status))).slice(0, 4);
  const done = sortTaskRecords(records.filter((record) => record.status === "done"), { newestDone: true }).slice(0, 4);

  if (!current.length) {
    const synthetic = buildSyntheticQueueRecord(session, "current");
    if (synthetic && filterTaskRecords([synthetic], { ...filters, repo: session.repoName }).length) {
      current.push(synthetic);
    }
  }
  if (!blocked.length) {
    const synthetic = buildSyntheticQueueRecord(session, "blocked");
    if (synthetic && filterTaskRecords([synthetic], { ...filters, repo: session.repoName }).length) {
      blocked.push(synthetic);
    }
  }

  return { current, next, blocked, done };
}

export function buildGlobalQueues(snapshot, filters = {}) {
  const sessions = (snapshot.sessions || []).filter((session) => sessionMatchesFilters(session, filters));
  const current = [];
  const next = [];
  const blocked = [];
  const done = [];

  for (const session of sessions) {
    const queues = buildSessionQueues(session, filters);
    current.push(...queues.current);
    next.push(...queues.next.slice(0, 2));
    blocked.push(...queues.blocked.slice(0, 2));
    done.push(...queues.done.slice(0, 2));
  }

  return {
    current: sortTaskRecords(current).slice(0, 10),
    next: sortTaskRecords(next).slice(0, 12),
    blocked: sortTaskRecords(blocked).slice(0, 12),
    done: sortTaskRecords(done, { newestDone: true }).slice(0, 12),
  };
}

export function findTaskRecord(snapshot, sessionId, taskId) {
  for (const session of snapshot.sessions || []) {
    if (session.sessionId !== sessionId) {
      continue;
    }
    const task = (session.tasks || []).find((item) => item.id === taskId);
    if (task) {
      return buildTaskRecord(session, task);
    }
    const currentSynthetic = buildSyntheticQueueRecord(session, "current");
    if (currentSynthetic?.id === taskId) {
      return currentSynthetic;
    }
    const blockedSynthetic = buildSyntheticQueueRecord(session, "blocked");
    if (blockedSynthetic?.id === taskId) {
      return blockedSynthetic;
    }
  }
  return null;
}

import { rankTaskStage, resolveTaskTrackKey } from "./workflow_model.mjs";

const priorityRank = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

const riskRank = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function rankPriority(priority) {
  return priorityRank[String(priority || "P2").toUpperCase()] ?? priorityRank.P2;
}

function sortTasks(backlog, tasks) {
  return [...tasks].sort((left, right) => {
    const byPriority = rankPriority(left.priority) - rankPriority(right.priority);
    if (byPriority !== 0) return byPriority;
    const byStage = rankTaskStage(left.stage) - rankTaskStage(right.stage);
    if (byStage !== 0) return byStage;
    return backlog.tasks.findIndex((item) => item.id === left.id)
      - backlog.tasks.findIndex((item) => item.id === right.id);
  });
}

export function summarizeBacklog(backlog) {
  const summary = {
    total: backlog.tasks.length,
    pending: 0,
    inProgress: 0,
    done: 0,
    failed: 0,
    blocked: 0,
  };

  for (const task of backlog.tasks) {
    const status = String(task.status || "pending");
    if (status === "pending") summary.pending += 1;
    if (status === "in_progress") summary.inProgress += 1;
    if (status === "done") summary.done += 1;
    if (status === "failed") summary.failed += 1;
    if (status === "blocked") summary.blocked += 1;
  }

  return summary;
}

export function dependenciesSatisfied(backlog, task) {
  return unresolvedDependencies(backlog, task).length === 0;
}

export function unresolvedDependencies(backlog, task) {
  const deps = Array.isArray(task.dependsOn) ? task.dependsOn : [];
  const explicit = deps.filter(
    (depId) => !backlog.tasks.some((item) => item.id === depId && item.status === "done"),
  );
  const trackKey = resolveTaskTrackKey(task);
  const taskStageRank = rankTaskStage(task?.stage);
  const implicit = backlog.tasks
    .filter((item) => (
      item.id !== task.id
      && resolveTaskTrackKey(item) === trackKey
      && rankTaskStage(item?.stage) < taskStageRank
      && String(item.status || "pending") !== "done"
    ))
    .map((item) => item.id);
  return [...new Set([...explicit, ...implicit])];
}

function unresolvedDependencyRefs(backlog, task) {
  const deps = Array.isArray(task.dependsOn) ? task.dependsOn : [];
  const explicit = deps
    .filter((depId) => !backlog.tasks.some((item) => item.id === depId && item.status === "done"))
    .map((depId) => ({ id: depId, kind: "dependency" }));
  const trackKey = resolveTaskTrackKey(task);
  const taskStageRank = rankTaskStage(task?.stage);
  const implicit = backlog.tasks
    .filter((item) => (
      item.id !== task.id
      && resolveTaskTrackKey(item) === trackKey
      && rankTaskStage(item?.stage) < taskStageRank
      && String(item.status || "pending") !== "done"
    ))
    .map((item) => ({ id: item.id, kind: "stage_gate" }));
  return [...explicit, ...implicit].filter((item, index, items) => (
    items.findIndex((candidate) => candidate.id === item.id && candidate.kind === item.kind) === index
  ));
}

function openBlockingSignals(task) {
  return (Array.isArray(task?.blockedBy) ? task.blockedBy : [])
    .filter((item) => item && item.status !== "resolved");
}

function classifyBlockingSignals(task) {
  const items = openBlockingSignals(task);
  const hasManual = items.some((item) => ["manual_input", "approval"].includes(String(item.type || "")));
  const hasExternal = items.some((item) => ["repo", "artifact", "external_system"].includes(String(item.type || "")));
  if (hasManual) {
    return "manual";
  }
  if (hasExternal) {
    return "external";
  }
  return items.length ? "task" : "";
}

export function isHighRiskTask(task) {
  return ["medium", "high", "critical"].includes(String(task.risk || "low"));
}

function withinRiskThreshold(task, threshold = "low") {
  const taskRisk = String(task.risk || "low").toLowerCase();
  const normalizedThreshold = String(threshold || "low").toLowerCase();
  return (riskRank[taskRisk] ?? riskRank.low) <= (riskRank[normalizedThreshold] ?? riskRank.low);
}

export function analyzeExecution(backlog, options = {}) {
  const allowHighRisk = Boolean(options.allowHighRisk);
  const maxRisk = options.maxRisk || "low";
  const pendingTasks = backlog.tasks.filter((task) => String(task.status || "pending") === "pending");
  const readyTasks = pendingTasks.filter((task) => dependenciesSatisfied(backlog, task));
  const unblockedReadyTasks = readyTasks.filter((task) => !openBlockingSignals(task).length);
  const executableTasks = unblockedReadyTasks.filter((task) => allowHighRisk || withinRiskThreshold(task, maxRisk));

  if (executableTasks.length) {
    return {
      state: "ready",
      task: sortTasks(backlog, executableTasks)[0],
      blockedTask: null,
      blockedReason: "",
      unresolved: [],
    };
  }

  const activeTask = backlog.tasks.find((task) => String(task.status || "pending") === "in_progress");
  if (activeTask) {
    return {
      state: "blocked_in_progress",
      task: null,
      blockedTask: activeTask,
      blockedReason: `存在未收束的进行中任务：${activeTask.title}`,
      unresolved: [],
    };
  }

  const failedTask = backlog.tasks.find((task) => ["failed", "blocked"].includes(String(task.status || "pending")));
  if (failedTask) {
    return {
      state: "blocked_failed",
      task: null,
      blockedTask: failedTask,
      blockedReason: `存在需要人工介入的失败/阻塞任务：${failedTask.title}`,
      unresolved: [],
    };
  }

  const externalBlockedTask = sortTasks(backlog, readyTasks.filter((task) => classifyBlockingSignals(task) === "external"))[0];
  if (externalBlockedTask) {
    return {
      state: "blocked_external",
      task: null,
      blockedTask: externalBlockedTask,
      blockedReason: `任务 ${externalBlockedTask.title} 正等待外部依赖或产物就绪。`,
      blockingSignals: openBlockingSignals(externalBlockedTask),
      unresolved: [],
      unresolvedRefs: [],
    };
  }

  const manualBlockedTask = sortTasks(backlog, readyTasks.filter((task) => classifyBlockingSignals(task) === "manual"))[0];
  if (manualBlockedTask) {
    return {
      state: "blocked_manual_input",
      task: null,
      blockedTask: manualBlockedTask,
      blockedReason: `任务 ${manualBlockedTask.title} 正等待人工输入、审批或放行。`,
      blockingSignals: openBlockingSignals(manualBlockedTask),
      unresolved: [],
      unresolvedRefs: [],
    };
  }

  if (unblockedReadyTasks.length) {
    const riskBlockedTask = sortTasks(backlog, unblockedReadyTasks)[0];
    return {
      state: "blocked_risk",
      task: null,
      blockedTask: riskBlockedTask,
      blockedReason: `后续任务风险超过自动驾驶阈值：${riskBlockedTask.title}`,
      unresolved: [],
    };
  }

  if (pendingTasks.length) {
    const dependencyBlockedTask = sortTasks(backlog, pendingTasks)[0];
    const unresolved = unresolvedDependencies(backlog, dependencyBlockedTask);
    const unresolvedRefs = unresolvedDependencyRefs(backlog, dependencyBlockedTask);
    const hasStageGate = unresolvedRefs.some((item) => item.kind === "stage_gate");
    return {
      state: hasStageGate ? "blocked_stage_gates" : "blocked_dependencies",
      task: null,
      blockedTask: dependencyBlockedTask,
      blockedReason: unresolved.length
        ? (hasStageGate
          ? `任务 ${dependencyBlockedTask.title} 仍需等待更早阶段任务完成：${unresolved.join(", ")}`
          : `任务 ${dependencyBlockedTask.title} 仍依赖未完成任务：${unresolved.join(", ")}`)
        : `任务 ${dependencyBlockedTask.title} 当前不可执行，请检查依赖与状态。`,
      unresolved,
      unresolvedRefs,
    };
  }

  return {
    state: "done",
    task: null,
    blockedTask: null,
    blockedReason: "",
    unresolved: [],
  };
}

export function selectNextTask(backlog, options = {}) {
  return analyzeExecution(backlog, options).task;
}

export function analyzeAutomationExecution(backlog, options = {}) {
  return analyzeExecution(backlog, {
    ...options,
    allowHighRisk: true,
    fullAutoMainline: true,
  });
}

export function selectAutomationNextTask(backlog, options = {}) {
  return analyzeAutomationExecution(backlog, options).task;
}

export function getTask(backlog, taskId) {
  return backlog.tasks.find((task) => task.id === taskId) || null;
}

export function updateTask(backlog, taskId, patch) {
  backlog.tasks = backlog.tasks.map((task) => (
    task.id === taskId
      ? { ...task, ...patch }
      : task
  ));
}

export function renderTaskSummary(task) {
  return [
    `任务：${task.title}`,
    `编号：${task.id}`,
    `状态：${task.status || "pending"}`,
    `优先级：${task.priority || "P2"}`,
    `风险：${task.risk || "low"}`,
    `阶段：${task.stage || "implementation"}`,
    `角色：${task.role || "developer"}`,
    `lane：${task.lane || "mainline"}`,
  ].join("\n");
}

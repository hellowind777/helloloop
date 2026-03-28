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
  const deps = Array.isArray(task.dependsOn) ? task.dependsOn : [];
  if (!deps.length) return true;
  return deps.every((depId) => backlog.tasks.some((item) => item.id === depId && item.status === "done"));
}

export function unresolvedDependencies(backlog, task) {
  const deps = Array.isArray(task.dependsOn) ? task.dependsOn : [];
  return deps.filter(
    (depId) => !backlog.tasks.some((item) => item.id === depId && item.status === "done"),
  );
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
  const executableTasks = readyTasks.filter((task) => allowHighRisk || withinRiskThreshold(task, maxRisk));

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

  if (readyTasks.length) {
    const riskBlockedTask = sortTasks(backlog, readyTasks)[0];
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
    return {
      state: "blocked_dependencies",
      task: null,
      blockedTask: dependencyBlockedTask,
      blockedReason: unresolved.length
        ? `任务 ${dependencyBlockedTask.title} 仍依赖未完成任务：${unresolved.join(", ")}`
        : `任务 ${dependencyBlockedTask.title} 当前不可执行，请检查依赖与状态。`,
      unresolved,
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
  ].join("\n");
}

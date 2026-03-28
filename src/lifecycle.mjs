export const sessionStatus = Object.freeze({
  running: "running",
  needsInput: "needs_input",
  done: "done",
  stopped: "stopped",
});

export const turnState = Object.freeze({
  ready: "ready",
  done: "done",
  blockedMissingBacklog: "blocked_missing_backlog",
  blockedInProgress: "blocked_in_progress",
  blockedFailed: "blocked_failed",
  blockedRisk: "blocked_risk",
  blockedDependencies: "blocked_dependencies",
});

const turnStateLabels = Object.freeze({
  [turnState.ready]: "可执行",
  [turnState.done]: "已完成",
  [turnState.blockedMissingBacklog]: "缺少 backlog",
  [turnState.blockedInProgress]: "存在未收束任务",
  [turnState.blockedFailed]: "存在失败或阻塞任务",
  [turnState.blockedRisk]: "风险门限阻塞",
  [turnState.blockedDependencies]: "依赖阻塞",
});

export function isBlockedTurnState(state) {
  return String(state || "").startsWith("blocked_");
}

export function isReadyTurnState(state) {
  return String(state || "") === turnState.ready;
}

export function isDoneTurnState(state) {
  return String(state || "") === turnState.done;
}

export function renderTurnStateLabel(state) {
  return turnStateLabels[String(state || "")] || "未知状态";
}

export function deriveSessionStatusFromTurnState(state) {
  if (isReadyTurnState(state)) {
    return sessionStatus.running;
  }

  if (isDoneTurnState(state)) {
    return sessionStatus.done;
  }

  if (isBlockedTurnState(state)) {
    return sessionStatus.needsInput;
  }

  return sessionStatus.needsInput;
}

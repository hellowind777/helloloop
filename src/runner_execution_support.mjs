import {
  rememberEngineSelection,
  resolveEngineSelection,
} from "./engine_selection.mjs";
import { nowIso } from "./common.mjs";
import {
  loadBacklog,
  loadPolicy,
  loadProjectConfig,
  loadRepoStateText,
  loadVerifyCommands,
  saveBacklog,
} from "./config.mjs";
import { getTask, selectNextTask, unresolvedDependencies, updateTask } from "./backlog.mjs";
import { makeRunDir } from "./runner_status.mjs";
import { resolveRuntimeRecoveryPolicy } from "./runtime_recovery.mjs";

function resolveTask(backlog, options) {
  if (options.taskId) {
    const task = getTask(backlog, options.taskId);
    if (!task) {
      throw new Error(`未找到任务：${options.taskId}`);
    }
    return task;
  }
  return selectNextTask(backlog, options);
}

export async function resolveExecutionSetup(context, options = {}) {
  const policy = loadPolicy(context);
  const projectConfig = loadProjectConfig(context);
  const backlog = loadBacklog(context);
  const task = resolveTask(backlog, options);
  if (!task) {
    return {
      idleResult: { ok: true, kind: "idle", task: null },
    };
  }

  const unresolved = unresolvedDependencies(backlog, task);
  if (unresolved.length) {
    throw new Error(`任务 ${task.id} 仍有未完成依赖：${unresolved.join(", ")}`);
  }

  const verifyCommands = Array.isArray(task.verify) && task.verify.length
    ? task.verify
    : loadVerifyCommands(context);
  const maxAttemptsPerStrategy = Math.max(1, Number(options.maxAttempts || policy.maxTaskAttempts || 1));
  const configuredStrategies = Math.max(1, Number(options.maxStrategies || policy.maxTaskStrategies || 1));
  const engineResolution = options.engineResolution?.ok
    ? options.engineResolution
    : await resolveEngineSelection({
      context,
      policy,
      options,
      interactive: !options.yes,
    });

  return {
    context,
    options,
    policy,
    backlog,
    projectConfig,
    repoStateText: loadRepoStateText(context),
    task,
    verifyCommands,
    runDir: makeRunDir(context, task.id),
    requiredDocs: [...(projectConfig.requiredDocs || []), ...(options.requiredDocs || [])],
    constraints: [...(projectConfig.constraints || []), ...(options.constraints || [])],
    maxAttemptsPerStrategy,
    maxStrategies: policy.stopOnFailure ? 1 : configuredStrategies,
    engineResolution,
  };
}

function updateTaskAndBuildResult(execution, status, result) {
  updateTask(execution.backlog, execution.task.id, {
    status,
    finishedAt: nowIso(),
    lastFailure: result.ok ? "" : (result.summary || ""),
    attempts: result.attempts,
  });
  saveBacklog(execution.context, execution.backlog);
  return result;
}

export function buildFailureResult(execution, kind, summary, attempts, engineResolution) {
  return updateTaskAndBuildResult(execution, "failed", {
    ok: false,
    kind,
    task: execution.task,
    runDir: execution.runDir,
    summary,
    attempts,
    engineResolution,
  });
}

export function buildBlockedResult(execution, summary, attempts, engineResolution) {
  return updateTaskAndBuildResult(execution, "blocked", {
    ok: false,
    kind: "task-blocked",
    task: execution.task,
    runDir: execution.runDir,
    summary,
    attempts,
    engineResolution,
  });
}

export function buildDoneResult(execution, finalMessage, attempts, engineResolution) {
  return updateTaskAndBuildResult(execution, "done", {
    ok: true,
    kind: "done",
    task: execution.task,
    runDir: execution.runDir,
    finalMessage,
    attempts,
    engineResolution,
  });
}

export async function maybeSwitchEngine(execution, engineResolution, previousFailure, phaseLabel) {
  const recoveryPolicy = resolveRuntimeRecoveryPolicy(execution.policy);
  if (!recoveryPolicy.allowEngineSwitch) {
    return null;
  }
  return null;
}

export function recordFailure(failureHistory, strategyIndex, attemptIndex, kind, summary) {
  failureHistory.push({
    strategyIndex,
    attemptIndex,
    kind,
    summary,
  });
}

export function buildAttemptState(runDir, strategyIndex, attemptIndex, makeAttemptDir) {
  return {
    strategyIndex,
    attemptIndex,
    attemptDir: makeAttemptDir(runDir, strategyIndex, attemptIndex),
  };
}

export function bumpFailureForNextStrategy(previousFailure, maxAttemptsPerStrategy) {
  return [
    previousFailure,
    "",
    `上一种策略已连续失败 ${maxAttemptsPerStrategy} 次。下一轮必须明确更换实现或排查思路，不能重复原路径。`,
  ].join("\n").trim();
}

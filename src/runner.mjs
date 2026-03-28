import path from "node:path";

import {
  ensureDir,
  nowIso,
  sanitizeId,
  tailText,
  timestampForFile,
  writeText,
} from "./common.mjs";
import {
  loadBacklog,
  loadPolicy,
  loadProjectConfig,
  loadRepoStateText,
  loadVerifyCommands,
  saveBacklog,
  writeStateMarkdown,
  writeStatus,
} from "./config.mjs";
import {
  getTask,
  renderTaskSummary,
  selectNextTask,
  summarizeBacklog,
  unresolvedDependencies,
  updateTask,
} from "./backlog.mjs";
import { buildTaskPrompt } from "./prompt.mjs";
import { runCodexExec, runVerifyCommands } from "./process.mjs";

function makeRunDir(context, taskId) {
  return path.join(context.runsDir, `${timestampForFile()}-${sanitizeId(taskId)}`);
}

function makeAttemptDir(runDir, strategyIndex, attemptIndex) {
  return path.join(
    runDir,
    `strategy-${String(strategyIndex).padStart(2, "0")}-attempt-${String(attemptIndex).padStart(2, "0")}`,
  );
}

function isHardStopFailure(kind, summary) {
  const normalized = String(summary || "").toLowerCase();
  if (!normalized) {
    return false;
  }

  if (kind === "codex" && normalized.includes("enoent")) {
    return true;
  }

  return [
    "command not found",
    "is not recognized",
    "无法将",
    "找不到路径",
    "no such file or directory",
    "permission denied",
    "access is denied",
  ].some((signal) => normalized.includes(signal));
}

function buildExhaustedSummary({
  failureHistory,
  maxStrategies,
  maxAttemptsPerStrategy,
}) {
  const lastFailure = failureHistory.at(-1)?.summary || "未知失败。";
  return [
    `已按 Ralph Loop 执行 ${maxStrategies} 轮策略、每轮最多 ${maxAttemptsPerStrategy} 次重试，当前任务仍未收敛。`,
    "",
    "最后一次失败信息：",
    lastFailure,
  ].join("\n").trim();
}

function renderStatusMarkdown(context, { summary, currentTask, lastResult, nextTask }) {
  return [
    "## 当前状态",
    `- backlog 文件：${context.backlogFile.replaceAll("\\", "/")}`,
    `- 总任务数：${summary.total}`,
    `- 已完成：${summary.done}`,
    `- 待处理：${summary.pending}`,
    `- 进行中：${summary.inProgress}`,
    `- 失败：${summary.failed}`,
    `- 阻塞：${summary.blocked}`,
    `- 当前任务：${currentTask ? currentTask.title : "无"}`,
    `- 最近结果：${lastResult || "暂无"}`,
    `- 下一建议：${nextTask ? nextTask.title : "暂无可执行任务"}`,
  ].join("\n");
}

function resolveTask(backlog, options) {
  if (options.taskId) {
    const task = getTask(backlog, options.taskId);
    if (!task) throw new Error(`未找到任务：${options.taskId}`);
    return task;
  }
  return selectNextTask(backlog, options);
}

function buildFailureSummary(kind, payload) {
  if (kind === "codex") {
    return [
      `Codex 执行失败，退出码：${payload.code}`,
      "",
      "stdout 尾部：",
      tailText(payload.stdout, 60),
      "",
      "stderr 尾部：",
      tailText(payload.stderr, 60),
    ].join("\n").trim();
  }
  return payload.summary;
}

async function executeSingleTask(context, options = {}) {
  const policy = loadPolicy(context);
  const projectConfig = loadProjectConfig(context);
  const backlog = loadBacklog(context);
  const repoStateText = loadRepoStateText(context);
  const task = resolveTask(backlog, options);

  if (!task) {
    const summary = summarizeBacklog(backlog);
    writeStatus(context, { ok: true, stage: "idle", summary });
    writeStateMarkdown(context, renderStatusMarkdown(context, {
      summary,
      currentTask: null,
      lastResult: "没有可执行任务",
      nextTask: null,
    }));
    return { ok: true, kind: "idle", task: null };
  }

  const unresolved = unresolvedDependencies(backlog, task);
  if (unresolved.length) {
    throw new Error(`任务 ${task.id} 仍有未完成依赖：${unresolved.join(", ")}`);
  }

  const verifyCommands = Array.isArray(task.verify) && task.verify.length
    ? task.verify
    : loadVerifyCommands(context);
  const runDir = makeRunDir(context, task.id);
  const requiredDocs = [
    ...(projectConfig.requiredDocs || []),
    ...(options.requiredDocs || []),
  ];
  const constraints = [
    ...(projectConfig.constraints || []),
    ...(options.constraints || []),
  ];
  const maxAttemptsPerStrategy = Math.max(1, Number(options.maxAttempts || policy.maxTaskAttempts || 1));
  const configuredStrategies = Math.max(1, Number(options.maxStrategies || policy.maxTaskStrategies || 1));
  const maxStrategies = policy.stopOnFailure ? 1 : configuredStrategies;

  if (options.dryRun) {
    const prompt = buildTaskPrompt({
      task,
      repoStateText,
      verifyCommands,
      requiredDocs,
      constraints,
      strategyIndex: 1,
      maxStrategies,
      attemptIndex: 1,
      maxAttemptsPerStrategy,
    });
    ensureDir(runDir);
    writeText(path.join(runDir, "codex-prompt.md"), prompt);
    return { ok: true, kind: "dry-run", task, runDir, prompt, verifyCommands };
  }

  updateTask(backlog, task.id, { status: "in_progress", startedAt: nowIso() });
  saveBacklog(context, backlog);

  let previousFailure = "";
  const failureHistory = [];

  for (let strategyIndex = 1; strategyIndex <= maxStrategies; strategyIndex += 1) {
    for (let attemptIndex = 1; attemptIndex <= maxAttemptsPerStrategy; attemptIndex += 1) {
      const prompt = buildTaskPrompt({
        task,
        repoStateText,
        verifyCommands,
        requiredDocs,
        constraints,
        previousFailure,
        failureHistory,
        strategyIndex,
        maxStrategies,
        attemptIndex,
        maxAttemptsPerStrategy,
      });
      const attemptDir = makeAttemptDir(runDir, strategyIndex, attemptIndex);
      const codexResult = await runCodexExec({ context, prompt, runDir: attemptDir, policy });

      if (!codexResult.ok) {
        previousFailure = buildFailureSummary("codex", codexResult);
        failureHistory.push({
          strategyIndex,
          attemptIndex,
          kind: "codex",
          summary: previousFailure,
        });
        if (isHardStopFailure("codex", previousFailure)) {
          updateTask(backlog, task.id, {
            status: "failed",
            finishedAt: nowIso(),
            lastFailure: previousFailure,
            attempts: failureHistory.length,
          });
          saveBacklog(context, backlog);
          return { ok: false, kind: "codex-failed", task, runDir, summary: previousFailure };
        }
        continue;
      }

      const verifyResult = await runVerifyCommands(context, verifyCommands, attemptDir);
      if (verifyResult.ok) {
        updateTask(backlog, task.id, {
          status: "done",
          finishedAt: nowIso(),
          lastFailure: "",
          attempts: failureHistory.length + 1,
        });
        saveBacklog(context, backlog);
        return {
          ok: true,
          kind: "done",
          task,
          runDir,
          finalMessage: codexResult.finalMessage,
        };
      }

      previousFailure = buildFailureSummary("verify", verifyResult);
      failureHistory.push({
        strategyIndex,
        attemptIndex,
        kind: "verify",
        summary: previousFailure,
      });
      if (isHardStopFailure("verify", previousFailure)) {
        updateTask(backlog, task.id, {
          status: "failed",
          finishedAt: nowIso(),
          lastFailure: previousFailure,
          attempts: failureHistory.length,
        });
        saveBacklog(context, backlog);
        return { ok: false, kind: "verify-failed", task, runDir, summary: previousFailure };
      }
    }

    previousFailure = [
      previousFailure,
      "",
      `上一种策略已连续失败 ${maxAttemptsPerStrategy} 次。下一轮必须明确更换实现或排查思路，不能重复原路径。`,
    ].join("\n").trim();
  }

  const exhaustedSummary = buildExhaustedSummary({
    failureHistory,
    maxStrategies,
    maxAttemptsPerStrategy,
  });
  updateTask(backlog, task.id, {
    status: "failed",
    finishedAt: nowIso(),
    lastFailure: exhaustedSummary,
    attempts: failureHistory.length,
  });
  saveBacklog(context, backlog);
  return { ok: false, kind: "strategy-exhausted", task, runDir, summary: exhaustedSummary };
}

export async function runOnce(context, options = {}) {
  const result = await executeSingleTask(context, options);
  const backlog = loadBacklog(context);
  const summary = summarizeBacklog(backlog);
  const nextTask = selectNextTask(backlog, options);

  writeStatus(context, {
    ok: result.ok,
    stage: result.kind,
    taskId: result.task?.id || null,
    taskTitle: result.task?.title || "",
    runDir: result.runDir || "",
    summary,
    message: result.summary || result.finalMessage || "",
  });
  writeStateMarkdown(context, renderStatusMarkdown(context, {
    summary,
    currentTask: result.task,
    lastResult: result.ok ? "本轮成功" : (result.summary || result.kind),
    nextTask,
  }));

  return result;
}

export async function runLoop(context, options = {}) {
  const policy = loadPolicy(context);
  const maxTasks = Math.max(1, Number(options.maxTasks || policy.maxLoopTasks || 1));
  const results = [];

  for (let index = 0; index < maxTasks; index += 1) {
    const result = await runOnce(context, options);
    results.push(result);
    if (options.dryRun) break;
    if (!result.ok || !result.task) break;
    const backlog = loadBacklog(context);
    if (!selectNextTask(backlog, options)) break;
  }

  return results;
}

export function renderStatusText(context, options = {}) {
  const backlog = loadBacklog(context);
  const summary = summarizeBacklog(backlog);
  const nextTask = selectNextTask(backlog, options);

  return [
    "Autoloop 状态",
    "============",
    `仓库：${context.repoRoot}`,
    `总任务：${summary.total}`,
    `已完成：${summary.done}`,
    `待处理：${summary.pending}`,
    `进行中：${summary.inProgress}`,
    `失败：${summary.failed}`,
    `阻塞：${summary.blocked}`,
    "",
    nextTask ? "下一任务：" : "下一任务：无",
    nextTask ? renderTaskSummary(nextTask) : "",
  ].filter(Boolean).join("\n");
}


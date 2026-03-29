import path from "node:path";

import {
  classifySwitchableEngineFailure,
  promptEngineFallbackAfterFailure,
  rememberEngineSelection,
  resolveEngineSelection,
} from "./engine_selection.mjs";
import { getEngineDisplayName } from "./engine_metadata.mjs";
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
import { reviewTaskCompletion } from "./completion_review.mjs";
import {
  getTask,
  renderTaskSummary,
  selectNextTask,
  summarizeBacklog,
  unresolvedDependencies,
  updateTask,
} from "./backlog.mjs";
import { reanalyzeCurrentWorkspace } from "./analyzer.mjs";
import { buildTaskPrompt } from "./prompt.mjs";
import { runEngineExec, runVerifyCommands } from "./process.mjs";

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

  if (kind === "engine" && normalized.includes("enoent")) {
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
  if (kind === "engine") {
    const displayName = getEngineDisplayName(payload.engine);
    return [
      `${displayName} 执行失败，退出码：${payload.code}`,
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
  let engineResolution = options.engineResolution?.ok
    ? options.engineResolution
    : await resolveEngineSelection({
      context,
      policy,
      options,
      interactive: !options.yes,
    });

  if (!engineResolution.ok) {
    return {
      ok: false,
      kind: "engine-selection-failed",
      task,
      summary: engineResolution.message,
      engineResolution,
    };
  }

  rememberEngineSelection(context, engineResolution, options);

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
    writeText(path.join(runDir, `${engineResolution.engine}-prompt.md`), prompt);
    return { ok: true, kind: "dry-run", task, runDir, prompt, verifyCommands, engineResolution };
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
      const engineResult = await runEngineExec({
        engine: engineResolution.engine,
        context,
        prompt,
        runDir: attemptDir,
        policy,
      });

      if (!engineResult.ok) {
        previousFailure = buildFailureSummary("engine", {
          ...engineResult,
          engine: engineResolution.engine,
        });
        failureHistory.push({
          strategyIndex,
          attemptIndex,
          kind: engineResolution.engine,
          summary: previousFailure,
        });
        const switchableFailure = classifySwitchableEngineFailure(previousFailure);
        if (switchableFailure && !options.yes) {
          const fallback = await promptEngineFallbackAfterFailure({
            failedEngine: engineResolution.engine,
            hostContext: engineResolution.hostContext,
            probes: engineResolution.probes,
            failureSummary: switchableFailure.reason,
          });
          if (fallback.ok) {
            engineResolution = {
              ...engineResolution,
              engine: fallback.engine,
              displayName: getEngineDisplayName(fallback.engine),
              source: "interactive_fallback",
              sourceLabel: "故障后交互切换",
              basis: [
                `${getEngineDisplayName(engineResolution.engine)} 执行阶段失败。`,
                switchableFailure.reason,
                `用户改为选择 ${getEngineDisplayName(fallback.engine)}。`,
              ],
            };
            rememberEngineSelection(context, engineResolution, options);
            continue;
          }
        }

        if (isHardStopFailure("engine", previousFailure)) {
          updateTask(backlog, task.id, {
            status: "failed",
            finishedAt: nowIso(),
            lastFailure: previousFailure,
            attempts: failureHistory.length,
          });
          saveBacklog(context, backlog);
          return {
            ok: false,
            kind: "engine-failed",
            task,
            runDir,
            summary: previousFailure,
            engineResolution,
          };
        }
        continue;
      }

      const verifyResult = await runVerifyCommands(context, verifyCommands, attemptDir);
      if (verifyResult.ok) {
        const reviewResult = await reviewTaskCompletion({
          engine: engineResolution.engine,
          context,
          task,
          requiredDocs,
          constraints,
          repoStateText,
          engineFinalMessage: engineResult.finalMessage,
          verifyResult,
          runDir: attemptDir,
          policy,
        });

        if (!reviewResult.ok) {
          previousFailure = reviewResult.summary;
          failureHistory.push({
            strategyIndex,
            attemptIndex,
            kind: "task_review",
            summary: previousFailure,
          });
          const switchableFailure = classifySwitchableEngineFailure(previousFailure);
          if (switchableFailure && !options.yes) {
            const fallback = await promptEngineFallbackAfterFailure({
              failedEngine: engineResolution.engine,
              hostContext: engineResolution.hostContext,
              probes: engineResolution.probes,
              failureSummary: switchableFailure.reason,
            });
            if (fallback.ok) {
              engineResolution = {
                ...engineResolution,
                engine: fallback.engine,
                displayName: getEngineDisplayName(fallback.engine),
                source: "interactive_fallback",
                sourceLabel: "故障后交互切换",
                basis: [
                  `${getEngineDisplayName(engineResolution.engine)} 任务复核阶段失败。`,
                  switchableFailure.reason,
                  `用户改为选择 ${getEngineDisplayName(fallback.engine)}。`,
                ],
              };
              rememberEngineSelection(context, engineResolution, options);
              continue;
            }
          }

          if (isHardStopFailure("review", previousFailure)) {
            updateTask(backlog, task.id, {
              status: "failed",
              finishedAt: nowIso(),
              lastFailure: previousFailure,
              attempts: failureHistory.length,
            });
            saveBacklog(context, backlog);
            return {
              ok: false,
              kind: "task-review-failed",
              task,
              runDir,
              summary: previousFailure,
              engineResolution,
            };
          }

          continue;
        }

        if (!reviewResult.review.isComplete) {
          previousFailure = reviewResult.summary;
          failureHistory.push({
            strategyIndex,
            attemptIndex,
            kind: reviewResult.review.verdict === "blocked" ? "blocked" : "task_incomplete",
            summary: previousFailure,
          });

          if (reviewResult.review.verdict === "blocked") {
            updateTask(backlog, task.id, {
              status: "blocked",
              finishedAt: nowIso(),
              lastFailure: previousFailure,
              attempts: failureHistory.length,
            });
            saveBacklog(context, backlog);
            return {
              ok: false,
              kind: "task-blocked",
              task,
              runDir,
              summary: previousFailure,
              engineResolution,
            };
          }

          continue;
        }

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
          finalMessage: engineResult.finalMessage,
          engineResolution,
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
        return {
          ok: false,
          kind: "verify-failed",
          task,
          runDir,
          summary: previousFailure,
          engineResolution,
        };
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
  return {
    ok: false,
    kind: "strategy-exhausted",
    task,
    runDir,
    summary: exhaustedSummary,
    engineResolution,
  };
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
  const explicitMaxTasks = Number(options.maxTasks);
  const fullAutoMainline = Boolean(options.fullAutoMainline);
  const maxTasks = Number.isFinite(explicitMaxTasks) && explicitMaxTasks > 0
    ? explicitMaxTasks
    : (fullAutoMainline ? Number.POSITIVE_INFINITY : Math.max(1, Number(policy.maxLoopTasks || 1)));
  const maxReanalysisPasses = Math.max(0, Number(options.maxReanalysisPasses || policy.maxReanalysisPasses || 0));
  const results = [];
  let engineResolution = options.engineResolution || null;
  let completedTasks = 0;
  let reanalysisPasses = 0;

  while (completedTasks < maxTasks) {
    const result = await runOnce(context, {
      ...options,
      engineResolution,
    });
    results.push(result);
    if (result.engineResolution?.ok) {
      engineResolution = result.engineResolution;
    }
    if (options.dryRun) break;
    if (!result.ok || !result.task) break;
    completedTasks += 1;
    const backlog = loadBacklog(context);
    if (selectNextTask(backlog, options)) {
      continue;
    }

    const summary = summarizeBacklog(backlog);
    const shouldReanalyze = fullAutoMainline
      && summary.pending === 0
      && summary.inProgress === 0
      && summary.failed === 0
      && summary.blocked === 0
      && reanalysisPasses < maxReanalysisPasses;

    if (!shouldReanalyze) {
      break;
    }

    reanalysisPasses += 1;
    const continuation = await reanalyzeCurrentWorkspace(context, {
      ...options,
      engineResolution,
      yes: true,
    });

    if (continuation.engineResolution?.ok) {
      engineResolution = continuation.engineResolution;
    }

    if (!continuation.ok) {
      results.push({
        ok: false,
        kind: "mainline-reanalysis-failed",
        task: null,
        summary: continuation.summary || "主线终态复核失败。",
        engineResolution,
      });
      break;
    }

    const continuedBacklog = loadBacklog(context);
    const continuedNextTask = selectNextTask(continuedBacklog, options);

    if (continuedNextTask) {
      results.push({
        ok: true,
        kind: "mainline-reopened",
        task: null,
        summary: [
          "主线终态复核发现仍有剩余工作，已自动重建 backlog 并继续推进。",
          `下一任务：${continuedNextTask.title}`,
        ].join("\n"),
        engineResolution,
      });
      continue;
    }

    results.push({
      ok: true,
      kind: "mainline-complete",
      task: null,
      summary: "主线终态复核通过：开发文档目标已闭合，没有发现新的剩余任务。",
      engineResolution,
    });
    break;
  }

  return results;
}

export function renderStatusText(context, options = {}) {
  const backlog = loadBacklog(context);
  const summary = summarizeBacklog(backlog);
  const nextTask = selectNextTask(backlog, options);

  return [
    "HelloLoop 状态",
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


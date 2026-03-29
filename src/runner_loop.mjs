import { selectNextTask, summarizeBacklog } from "./backlog.mjs";
import { loadBacklog, loadPolicy } from "./config.mjs";
import { reanalyzeCurrentWorkspace } from "./analyzer.mjs";
import { runOnce } from "./runner_once.mjs";

function shouldRunMainlineReanalysis(options, summary, reanalysisPasses, maxReanalysisPasses) {
  return Boolean(options.fullAutoMainline)
    && summary.pending === 0
    && summary.inProgress === 0
    && summary.failed === 0
    && summary.blocked === 0
    && reanalysisPasses < maxReanalysisPasses;
}

function buildMainlineReopenedResult(nextTask, engineResolution) {
  return {
    ok: true,
    kind: "mainline-reopened",
    task: null,
    summary: [
      "主线终态复核发现仍有剩余工作，已自动重建 backlog 并继续推进。",
      `下一任务：${nextTask.title}`,
    ].join("\n"),
    engineResolution,
  };
}

function buildMainlineCompleteResult(engineResolution) {
  return {
    ok: true,
    kind: "mainline-complete",
    task: null,
    summary: "主线终态复核通过：开发文档目标已闭合，没有发现新的剩余任务。",
    engineResolution,
  };
}

function buildMainlineFailureResult(continuation, engineResolution) {
  return {
    ok: false,
    kind: "mainline-reanalysis-failed",
    task: null,
    summary: continuation.summary || "主线终态复核失败。",
    engineResolution,
  };
}

export async function runLoop(context, options = {}) {
  const policy = loadPolicy(context);
  const explicitMaxTasks = Number(options.maxTasks);
  const maxTasks = Number.isFinite(explicitMaxTasks) && explicitMaxTasks > 0
    ? explicitMaxTasks
    : (options.fullAutoMainline ? Number.POSITIVE_INFINITY : Math.max(1, Number(policy.maxLoopTasks || 1)));
  const maxReanalysisPasses = Math.max(0, Number(options.maxReanalysisPasses || policy.maxReanalysisPasses || 0));
  const results = [];
  let engineResolution = options.engineResolution || null;
  let completedTasks = 0;
  let reanalysisPasses = 0;

  while (completedTasks < maxTasks) {
    const result = await runOnce(context, { ...options, engineResolution });
    results.push(result);
    if (result.engineResolution?.ok) {
      engineResolution = result.engineResolution;
    }
    if (options.dryRun || !result.ok || !result.task) {
      break;
    }

    completedTasks += 1;
    const backlog = loadBacklog(context);
    if (selectNextTask(backlog, options)) {
      continue;
    }

    const summary = summarizeBacklog(backlog);
    if (!shouldRunMainlineReanalysis(options, summary, reanalysisPasses, maxReanalysisPasses)) {
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
      results.push(buildMainlineFailureResult(continuation, engineResolution));
      break;
    }

    const continuedNextTask = selectNextTask(loadBacklog(context), options);
    if (continuedNextTask) {
      results.push(buildMainlineReopenedResult(continuedNextTask, engineResolution));
      continue;
    }

    results.push(buildMainlineCompleteResult(engineResolution));
    break;
  }

  return results;
}

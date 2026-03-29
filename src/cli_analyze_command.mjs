import { analyzeExecution } from "./backlog.mjs";
import { renderAnalyzeConfirmation, resolveAutoRunMaxTasks } from "./analyze_confirmation.mjs";
import {
  confirmAutoExecution,
  confirmRepoConflictResolution,
  renderAnalyzeStopMessage,
  renderAutoRunSummary,
  renderRepoConflictStopMessage,
} from "./cli_support.mjs";
import { analyzeWorkspace } from "./analyzer.mjs";
import {
  hasBlockingInputIssues,
  renderBlockingInputIssueMessage,
} from "./analyze_user_input.mjs";
import { loadBacklog } from "./config.mjs";
import { createDiscoveryPromptSession, resolveDiscoveryFailureInteractively } from "./discovery_prompt.mjs";
import { resetRepoForRebuild } from "./rebuild.mjs";
import { runLoop } from "./runner.mjs";
import { renderRebuildSummary } from "./cli_render.mjs";
import { shouldConfirmRepoRebuild } from "./cli_support.mjs";

async function analyzeWithResolvedDiscovery(options) {
  let currentOptions = { ...options };
  let lastResult = null;
  let promptSession = null;

  function getPromptSession() {
    if (currentOptions.yes) {
      return null;
    }
    if (!promptSession) {
      promptSession = createDiscoveryPromptSession();
    }
    return promptSession;
  }

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      lastResult = await analyzeWorkspace({
        cwd: process.cwd(),
        inputPath: currentOptions.inputPath,
        repoRoot: currentOptions.repoRoot,
        docsPath: currentOptions.docsPath,
        configDirName: currentOptions.configDirName,
        allowNewRepoRoot: currentOptions.allowNewRepoRoot,
        engine: currentOptions.engine,
        engineSource: currentOptions.engineSource,
        engineResolution: currentOptions.engineResolution,
        hostContext: currentOptions.hostContext,
        userRequestText: currentOptions.userRequestText,
        yes: currentOptions.yes,
        selectionSources: currentOptions.selectionSources,
        userIntent: currentOptions.userIntent,
      });

      if (lastResult.ok) {
        return { options: currentOptions, result: lastResult };
      }

      const nextOptions = await resolveDiscoveryFailureInteractively(
        lastResult,
        currentOptions,
        process.cwd(),
        !currentOptions.yes,
        getPromptSession(),
      );
      if (!nextOptions) {
        break;
      }
      currentOptions = nextOptions;
    }
  } finally {
    promptSession?.close();
  }

  return { options: currentOptions, result: lastResult };
}

function printAnalyzeConfirmation(result, activeOptions) {
  console.log(renderAnalyzeConfirmation(
    result.context,
    result.analysis,
    result.backlog,
    activeOptions,
    result.discovery,
  ));
  console.log("");
}

async function resolveRepoConflict(analyzed, result, activeOptions) {
  if (!shouldConfirmRepoRebuild(result.analysis, result.discovery)) {
    return { state: "ready", analyzed, result, activeOptions };
  }

  if (activeOptions.rebuildExisting) {
    const resetSummary = resetRepoForRebuild(result.context, result.discovery);
    console.log(renderRebuildSummary(resetSummary));
    console.log("");
    return {
      state: "reanalyze",
      options: {
        ...activeOptions,
        repoRoot: result.context.repoRoot,
        rebuildExisting: false,
      },
    };
  }

  if (activeOptions.yes) {
    console.log(renderRepoConflictStopMessage(result.analysis));
    return { state: "exit", exitCode: 1 };
  }

  const repoConflictDecision = await confirmRepoConflictResolution(result.analysis);
  if (repoConflictDecision === "cancel") {
    console.log("已取消自动执行；分析结果与 backlog 已保留在 .helloloop/。");
    return { state: "done" };
  }
  if (repoConflictDecision === "continue") {
    return { state: "ready", analyzed, result, activeOptions };
  }

  const resetSummary = resetRepoForRebuild(result.context, result.discovery);
  console.log(renderRebuildSummary(resetSummary));
  console.log("");
  return {
    state: "reanalyze",
    options: {
      ...activeOptions,
      repoRoot: result.context.repoRoot,
      rebuildExisting: false,
    },
  };
}

async function prepareAnalyzeExecution(initialOptions) {
  let analyzed = await analyzeWithResolvedDiscovery(initialOptions);
  let result = analyzed.result;
  let activeOptions = analyzed.options;

  while (true) {
    if (!result.ok) {
      console.error(result.summary);
      return { exitCode: 1 };
    }
    if (result.engineResolution?.ok) {
      activeOptions = {
        ...activeOptions,
        engineResolution: result.engineResolution,
      };
    }

    printAnalyzeConfirmation(result, activeOptions);
    const conflictResolution = await resolveRepoConflict(analyzed, result, activeOptions);
    if (conflictResolution.state === "ready") {
      return { result, activeOptions };
    }
    if (conflictResolution.state === "done" || conflictResolution.state === "exit") {
      return { exitCode: conflictResolution.exitCode || 0 };
    }

    analyzed = await analyzeWithResolvedDiscovery(conflictResolution.options);
    result = analyzed.result;
    activeOptions = analyzed.options;
  }
}

async function maybeRunAutoExecution(result, activeOptions) {
  const execution = analyzeExecution(result.backlog, activeOptions);

  if (activeOptions.dryRun) {
    console.log("已按 --dry-run 跳过自动执行。");
    return 0;
  }
  if (execution.state !== "ready") {
    console.log(renderAnalyzeStopMessage(execution.blockedReason || "当前 backlog 已无可自动执行任务。"));
    return 0;
  }

  const approved = activeOptions.yes ? true : await confirmAutoExecution();
  if (!approved) {
    console.log("已取消自动执行；分析结果与 backlog 已保留在 .helloloop/。");
    return 0;
  }

  console.log("");
  console.log("开始自动接续执行...");
  const results = await runLoop(result.context, {
    ...activeOptions,
    engineResolution: result.engineResolution?.ok ? result.engineResolution : activeOptions.engineResolution,
    maxTasks: resolveAutoRunMaxTasks(result.backlog, activeOptions) || undefined,
    fullAutoMainline: true,
  });
  const refreshedBacklog = loadBacklog(result.context);
  console.log(renderAutoRunSummary(result.context, refreshedBacklog, results, activeOptions));
  return results.some((item) => !item.ok) ? 1 : 0;
}

export async function handleAnalyzeCommand(options) {
  if (hasBlockingInputIssues(options.inputIssues)) {
    console.error(renderBlockingInputIssueMessage(options.inputIssues));
    return 1;
  }

  const prepared = await prepareAnalyzeExecution(options);
  if (!prepared.result) {
    return prepared.exitCode || 0;
  }

  return maybeRunAutoExecution(prepared.result, prepared.activeOptions);
}

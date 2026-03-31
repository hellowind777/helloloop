import { analyzeExecution } from "./backlog.mjs";
import { renderAnalyzeConfirmation, resolveAutoRunMaxTasks } from "./analyze_confirmation.mjs";
import {
  confirmAutoExecution,
  confirmRepoConflictResolution,
  renderAnalyzeStopMessage,
  renderRepoConflictStopMessage,
} from "./cli_support.mjs";
import { analyzeWorkspace } from "./analyzer.mjs";
import {
  hasBlockingInputIssues,
  renderBlockingInputIssueMessage,
} from "./analyze_user_input.mjs";
import { loadPolicy } from "./config.mjs";
import { createContext } from "./context.mjs";
import { createDiscoveryPromptSession, resolveDiscoveryFailureInteractively } from "./discovery_prompt.mjs";
import { resolveEngineSelection } from "./engine_selection.mjs";
import { shouldPromptForEngineSelection } from "./execution_interactivity.mjs";
import { resetRepoForRebuild } from "./rebuild.mjs";
import { renderRebuildSummary } from "./cli_render.mjs";
import { shouldConfirmRepoRebuild } from "./cli_support.mjs";
import { launchAndMaybeWatchSupervisedCommand } from "./supervisor_cli_support.mjs";
import { resolveFullAutoMainlineOptions } from "./auto_execution_options.mjs";

async function resolveAnalyzeEngineSelection(options) {
  if (options.engineResolution?.ok) {
    return options.engineResolution;
  }

  const provisionalContext = createContext({
    repoRoot: options.repoRoot || process.cwd(),
    configDirName: options.configDirName,
  });
  return resolveEngineSelection({
    context: provisionalContext,
    policy: loadPolicy(provisionalContext),
    options,
    interactive: shouldPromptForEngineSelection(options),
  });
}

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
    const engineResolution = await resolveAnalyzeEngineSelection(currentOptions);
    if (!engineResolution.ok) {
      return {
        options: currentOptions,
        result: {
          ok: false,
          code: engineResolution.code,
          summary: engineResolution.message,
          discovery: null,
          engineResolution,
        },
      };
    }
    currentOptions = {
      ...currentOptions,
      engineResolution,
    };

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
  const autoOptions = resolveFullAutoMainlineOptions({
    ...activeOptions,
    engineResolution: result.engineResolution?.ok ? result.engineResolution : activeOptions.engineResolution,
  });
  const execution = analyzeExecution(result.backlog, autoOptions);

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
  const payload = await launchAndMaybeWatchSupervisedCommand(result.context, "run-loop", {
    ...autoOptions,
    maxTasks: resolveAutoRunMaxTasks(result.backlog, activeOptions) || undefined,
  });
  return payload.exitCode || 0;
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

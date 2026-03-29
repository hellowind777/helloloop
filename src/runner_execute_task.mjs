import path from "node:path";

import { rememberEngineSelection } from "./engine_selection.mjs";
import { getEngineDisplayName } from "./engine_metadata.mjs";
import { ensureDir, nowIso, writeText } from "./common.mjs";
import { saveBacklog } from "./config.mjs";
import { reviewTaskCompletion } from "./completion_review.mjs";
import { updateTask } from "./backlog.mjs";
import { buildTaskPrompt } from "./prompt.mjs";
import { runEngineExec, runVerifyCommands } from "./process.mjs";
import {
  buildAttemptState,
  buildBlockedResult,
  buildDoneResult,
  buildFailureResult,
  bumpFailureForNextStrategy,
  maybeSwitchEngine,
  recordFailure,
  resolveExecutionSetup,
} from "./runner_execution_support.mjs";
import {
  buildExhaustedSummary,
  buildFailureSummary,
  isHardStopFailure,
  makeAttemptDir,
} from "./runner_status.mjs";

async function handleEngineFailure(execution, state, attemptState, engineResult) {
  const previousFailure = buildFailureSummary("engine", {
    ...engineResult,
    displayName: getEngineDisplayName(state.engineResolution.engine),
  });
  recordFailure(
    state.failureHistory,
    attemptState.strategyIndex,
    attemptState.attemptIndex,
    state.engineResolution.engine,
    previousFailure,
  );

  const nextResolution = await maybeSwitchEngine(execution, state.engineResolution, previousFailure, "执行阶段");
  if (nextResolution) {
    return { action: "switch", previousFailure, engineResolution: nextResolution };
  }
  if (engineResult.recoveryFailure?.recoverable === false) {
    return {
      action: "return",
      result: buildFailureResult(
        execution,
        "engine-failed",
        previousFailure,
        state.failureHistory.length,
        state.engineResolution,
      ),
    };
  }
  if (isHardStopFailure("engine", previousFailure)) {
    return {
      action: "return",
      result: buildFailureResult(
        execution,
        "engine-failed",
        previousFailure,
        state.failureHistory.length,
        state.engineResolution,
      ),
    };
  }
  return { action: "continue", previousFailure };
}

function handleVerifyFailure(execution, state, attemptState, verifyResult) {
  const previousFailure = buildFailureSummary("verify", verifyResult);
  recordFailure(state.failureHistory, attemptState.strategyIndex, attemptState.attemptIndex, "verify", previousFailure);

  if (isHardStopFailure("verify", previousFailure)) {
    return {
      action: "return",
      result: buildFailureResult(
        execution,
        "verify-failed",
        previousFailure,
        state.failureHistory.length,
        state.engineResolution,
      ),
    };
  }
  return { action: "continue", previousFailure };
}

async function handleReviewFailure(execution, state, attemptState, reviewResult) {
  const previousFailure = reviewResult.summary;
  recordFailure(state.failureHistory, attemptState.strategyIndex, attemptState.attemptIndex, "task_review", previousFailure);

  const nextResolution = await maybeSwitchEngine(execution, state.engineResolution, previousFailure, "任务复核阶段");
  if (nextResolution) {
    return { action: "switch", previousFailure, engineResolution: nextResolution };
  }
  if (reviewResult.raw?.recoveryFailure?.recoverable === false) {
    return {
      action: "return",
      result: buildFailureResult(
        execution,
        "task-review-failed",
        previousFailure,
        state.failureHistory.length,
        state.engineResolution,
      ),
    };
  }
  if (isHardStopFailure("review", previousFailure)) {
    return {
      action: "return",
      result: buildFailureResult(
        execution,
        "task-review-failed",
        previousFailure,
        state.failureHistory.length,
        state.engineResolution,
      ),
    };
  }
  return { action: "continue", previousFailure };
}

function handleIncompleteReview(execution, state, attemptState, reviewResult) {
  const previousFailure = reviewResult.summary;
  recordFailure(
    state.failureHistory,
    attemptState.strategyIndex,
    attemptState.attemptIndex,
    reviewResult.review.verdict === "blocked" ? "blocked" : "task_incomplete",
    previousFailure,
  );

  if (reviewResult.review.verdict === "blocked") {
    return {
      action: "return",
      result: buildBlockedResult(
        execution,
        previousFailure,
        state.failureHistory.length,
        state.engineResolution,
      ),
    };
  }
  return { action: "continue", previousFailure };
}

async function handleVerifyAndReview(execution, state, attemptState, engineResult) {
  const verifyResult = await runVerifyCommands(execution.context, execution.verifyCommands, attemptState.attemptDir);
  if (!verifyResult.ok) {
    return handleVerifyFailure(execution, state, attemptState, verifyResult);
  }

  const reviewResult = await reviewTaskCompletion({
    engine: state.engineResolution.engine,
    context: execution.context,
    task: execution.task,
    requiredDocs: execution.requiredDocs,
    constraints: execution.constraints,
    repoStateText: execution.repoStateText,
    engineFinalMessage: engineResult.finalMessage,
    verifyResult,
    runDir: attemptState.attemptDir,
    policy: execution.policy,
  });
  if (!reviewResult.ok) {
    return handleReviewFailure(execution, state, attemptState, reviewResult);
  }
  if (!reviewResult.review.isComplete) {
    return handleIncompleteReview(execution, state, attemptState, reviewResult);
  }

  return {
    action: "return",
    result: buildDoneResult(
      execution,
      engineResult.finalMessage,
      state.failureHistory.length + 1,
      state.engineResolution,
    ),
  };
}

async function runAttempt(execution, state, attemptState) {
  const prompt = buildTaskPrompt({
    task: execution.task,
    repoStateText: execution.repoStateText,
    verifyCommands: execution.verifyCommands,
    requiredDocs: execution.requiredDocs,
    constraints: execution.constraints,
    previousFailure: state.previousFailure,
    failureHistory: state.failureHistory,
    strategyIndex: attemptState.strategyIndex,
    maxStrategies: execution.maxStrategies,
    attemptIndex: attemptState.attemptIndex,
    maxAttemptsPerStrategy: execution.maxAttemptsPerStrategy,
  });

  const engineResult = await runEngineExec({
    engine: state.engineResolution.engine,
    context: execution.context,
    prompt,
    runDir: attemptState.attemptDir,
    policy: execution.policy,
  });
  if (!engineResult.ok) {
    return handleEngineFailure(execution, state, attemptState, engineResult);
  }
  return handleVerifyAndReview(execution, state, attemptState, engineResult);
}

export async function executeSingleTask(context, options = {}) {
  const execution = await resolveExecutionSetup(context, options);
  if (execution.idleResult) {
    return execution.idleResult;
  }
  if (!execution.engineResolution.ok) {
    return {
      ok: false,
      kind: "engine-selection-failed",
      task: execution.task,
      summary: execution.engineResolution.message,
      engineResolution: execution.engineResolution,
    };
  }

  rememberEngineSelection(context, execution.engineResolution, options);
  if (options.dryRun) {
    const prompt = buildTaskPrompt({
      task: execution.task,
      repoStateText: execution.repoStateText,
      verifyCommands: execution.verifyCommands,
      requiredDocs: execution.requiredDocs,
      constraints: execution.constraints,
      strategyIndex: 1,
      maxStrategies: execution.maxStrategies,
      attemptIndex: 1,
      maxAttemptsPerStrategy: execution.maxAttemptsPerStrategy,
    });
    ensureDir(execution.runDir);
    writeText(path.join(execution.runDir, `${execution.engineResolution.engine}-prompt.md`), prompt);
    return {
      ok: true,
      kind: "dry-run",
      task: execution.task,
      runDir: execution.runDir,
      prompt,
      verifyCommands: execution.verifyCommands,
      engineResolution: execution.engineResolution,
    };
  }

  updateTask(execution.backlog, execution.task.id, { status: "in_progress", startedAt: nowIso() });
  saveBacklog(context, execution.backlog);

  const state = {
    engineResolution: execution.engineResolution,
    previousFailure: "",
    failureHistory: [],
  };

  for (let strategyIndex = 1; strategyIndex <= execution.maxStrategies; strategyIndex += 1) {
    for (let attemptIndex = 1; attemptIndex <= execution.maxAttemptsPerStrategy; attemptIndex += 1) {
      const outcome = await runAttempt(
        execution,
        state,
        buildAttemptState(execution.runDir, strategyIndex, attemptIndex, makeAttemptDir),
      );
      if (outcome.action === "switch") {
        state.previousFailure = outcome.previousFailure;
        state.engineResolution = outcome.engineResolution;
        continue;
      }
      if (outcome.action === "continue") {
        state.previousFailure = outcome.previousFailure;
        continue;
      }
      return outcome.result;
    }

    state.previousFailure = bumpFailureForNextStrategy(
      state.previousFailure,
      execution.maxAttemptsPerStrategy,
    );
  }

  const exhaustedSummary = buildExhaustedSummary({
    failureHistory: state.failureHistory,
    maxStrategies: execution.maxStrategies,
    maxAttemptsPerStrategy: execution.maxAttemptsPerStrategy,
  });
  return buildFailureResult(
    execution,
    "strategy-exhausted",
    exhaustedSummary,
    state.failureHistory.length,
    state.engineResolution,
  );
}

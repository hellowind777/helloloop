import path from "node:path";

import { ensureDir, nowIso, tailText, writeJson, writeText } from "./common.mjs";
import { getEngineDisplayName, normalizeEngineName } from "./engine_metadata.mjs";
import { resolveEngineInvocation } from "./engine_process_support.mjs";
import { refreshHostContinuationArtifacts } from "./host_continuation.mjs";
import { isHostLeaseAlive } from "./host_lease.mjs";
import {
  buildRuntimeRecoveryPrompt,
  classifyRuntimeRecoveryFailure,
  renderRuntimeRecoverySummary,
  resolveRuntimeRecoveryPolicy,
  selectRuntimeRecoveryDelayMs,
} from "./runtime_recovery.mjs";
import {
  buildHostLeaseStoppedResult,
  buildNotificationNote,
  createRuntimeStatusWriter,
  maybeSendStopNotification,
  resolveEnginePolicy,
  runEngineAttempt,
  runEngineHealthProbe,
  sleepWithLease,
  writeEngineRunArtifacts,
} from "./runtime_engine_support.mjs";

export async function runEngineTask({
  engine = "codex",
  context,
  prompt,
  runDir,
  policy = {},
  executionMode = "analyze",
  outputSchemaFile = "",
  outputPrefix = "",
  ephemeral = false,
  skipGitRepoCheck = false,
  env = {},
  hostLease = null,
}) {
  ensureDir(runDir);

  const normalizedEngine = normalizeEngineName(engine) || "codex";
  const resolvedPolicy = resolveEnginePolicy(policy, normalizedEngine);
  const prefix = outputPrefix || normalizedEngine;
  const invocation = resolveEngineInvocation(normalizedEngine, resolvedPolicy.executable);
  const recoveryPolicy = resolveRuntimeRecoveryPolicy(policy);
  const runtimeStatusFile = path.join(runDir, `${prefix}-runtime.json`);
  const writeRuntimeStatus = createRuntimeStatusWriter(runtimeStatusFile, {
    engine: normalizedEngine,
    engineDisplayName: getEngineDisplayName(normalizedEngine),
    phase: executionMode,
    outputPrefix: prefix,
    hardRetryBudget: recoveryPolicy.hardRetryDelaysSeconds.length,
    softRetryBudget: recoveryPolicy.softRetryDelaysSeconds.length,
  }, () => {
    try {
      refreshHostContinuationArtifacts(context);
    } catch {
      // ignore continuation snapshot refresh failures during heartbeat writes
    }
  });

  const recoveryHistory = [];
  let currentPrompt = prompt;
  let currentRecoveryCount = 0;
  let activeFailure = null;

  while (true) {
    if (!isHostLeaseAlive(hostLease)) {
      const stopped = buildHostLeaseStoppedResult("检测到宿主窗口已关闭，HelloLoop 已停止本轮自动执行。");
      writeRuntimeStatus("stopped_host_closed", {
        attemptPrefix: prefix,
        recoveryCount: recoveryHistory.length,
        recoveryHistory,
        code: stopped.code,
        failureCode: "host_closed",
        failureFamily: "host_lease",
        failureReason: stopped.leaseReason,
      });
      return {
        ...stopped,
        finalMessage: "",
        recoveryCount: recoveryHistory.length,
        recoveryHistory,
        recoverySummary: "",
        recoveryFailure: null,
        notification: null,
      };
    }

    const attemptPrefix = currentRecoveryCount === 0
      ? prefix
      : `${prefix}-recovery-${String(currentRecoveryCount).padStart(2, "0")}`;
    const taskAttempt = await runEngineAttempt({
      engine: normalizedEngine,
      invocation,
      context,
      prompt: currentPrompt,
      runDir,
      attemptPrefix,
      resolvedPolicy,
      executionMode,
      outputSchemaFile,
      env,
      recoveryPolicy,
      writeRuntimeStatus,
      recoveryCount: currentRecoveryCount,
      recoveryHistory,
      hostLease,
      ephemeral,
      skipGitRepoCheck,
      probeMode: false,
    });
    if (taskAttempt.result.leaseExpired) {
      writeText(path.join(runDir, `${prefix}-prompt.md`), currentPrompt);
      writeEngineRunArtifacts(runDir, prefix, taskAttempt.result, taskAttempt.finalMessage);
      writeRuntimeStatus("stopped_host_closed", {
        attemptPrefix,
        recoveryCount: recoveryHistory.length,
        recoveryHistory,
        finalMessage: taskAttempt.finalMessage,
        code: taskAttempt.result.code,
        failureCode: "host_closed",
        failureFamily: "host_lease",
        failureReason: taskAttempt.result.leaseReason,
      });
      return {
        ...taskAttempt.result,
        finalMessage: taskAttempt.finalMessage,
        recoveryCount: recoveryHistory.length,
        recoveryHistory,
        recoverySummary: "",
        recoveryFailure: null,
        notification: null,
      };
    }

    const taskFailure = classifyRuntimeRecoveryFailure({
      result: {
        ...taskAttempt.result,
        finalMessage: taskAttempt.finalMessage,
      },
    });

    if (taskAttempt.result.ok || !recoveryPolicy.enabled) {
      const finalRecoverySummary = taskAttempt.result.ok
        ? ""
        : renderRuntimeRecoverySummary(recoveryHistory, taskFailure);
      const notification = taskAttempt.result.ok
        ? null
        : await maybeSendStopNotification({
          context,
          runDir,
          engine: normalizedEngine,
          executionMode,
          failure: taskFailure,
          result: taskAttempt.result,
          recoveryHistory,
        });
      const notificationNote = taskAttempt.result.ok ? "" : buildNotificationNote(notification);
      const finalizedResult = taskAttempt.result.ok
        ? taskAttempt.result
        : {
          ...taskAttempt.result,
          stderr: [
            taskAttempt.result.stderr,
            "",
            finalRecoverySummary,
            notificationNote,
          ].filter(Boolean).join("\n").trim(),
        };

      writeText(path.join(runDir, `${prefix}-prompt.md`), currentPrompt);
      writeEngineRunArtifacts(runDir, prefix, finalizedResult, taskAttempt.finalMessage);
      if (normalizedEngine === "codex" && taskAttempt.finalMessage) {
        writeText(path.join(runDir, `${prefix}-last-message.txt`), taskAttempt.finalMessage);
      }
      writeRuntimeStatus(taskAttempt.result.ok ? "completed" : "paused_manual", {
        attemptPrefix,
        recoveryCount: recoveryHistory.length,
        recoveryHistory,
        recoverySummary: finalRecoverySummary,
        finalMessage: taskAttempt.finalMessage,
        code: finalizedResult.code,
        failureCode: taskFailure.code,
        failureFamily: taskFailure.family,
        failureReason: taskFailure.reason,
        notification,
      });

      return {
        ...finalizedResult,
        finalMessage: taskAttempt.finalMessage,
        recoveryCount: recoveryHistory.length,
        recoveryHistory,
        recoverySummary: finalRecoverySummary,
        recoveryFailure: taskAttempt.result.ok
          ? null
          : {
            ...taskFailure,
            shouldStopTask: true,
            exhausted: true,
          },
        notification,
      };
    }

    activeFailure = taskFailure;
    while (true) {
      const nextRecoveryIndex = recoveryHistory.length + 1;
      const recoveryPrompt = buildRuntimeRecoveryPrompt({
        basePrompt: prompt,
        engine: normalizedEngine,
        phaseLabel: executionMode === "analyze" ? "分析/复核" : "执行",
        failure: activeFailure,
        result: {
          ...taskAttempt.result,
          finalMessage: taskAttempt.finalMessage,
        },
        nextRecoveryIndex,
        maxRecoveries: recoveryPolicy[activeFailure.family === "hard" ? "hardRetryDelaysSeconds" : "softRetryDelaysSeconds"].length,
      });
      writeText(
        path.join(runDir, `${prefix}-auto-recovery-${String(nextRecoveryIndex).padStart(2, "0")}-prompt.md`),
        recoveryPrompt,
      );
      const delayMs = selectRuntimeRecoveryDelayMs(recoveryPolicy, activeFailure.family, nextRecoveryIndex);
      if (delayMs < 0) {
        const finalRecoverySummary = renderRuntimeRecoverySummary(recoveryHistory, activeFailure);
        const notification = await maybeSendStopNotification({
          context,
          runDir,
          engine: normalizedEngine,
          executionMode,
          failure: activeFailure,
          result: taskAttempt.result,
          recoveryHistory,
        });
        const notificationNote = buildNotificationNote(notification);
        const finalizedResult = {
          ...taskAttempt.result,
          stderr: [
            taskAttempt.result.stderr,
            "",
            finalRecoverySummary,
            notificationNote,
          ].filter(Boolean).join("\n").trim(),
        };

        writeText(path.join(runDir, `${prefix}-prompt.md`), currentPrompt);
        writeEngineRunArtifacts(runDir, prefix, finalizedResult, taskAttempt.finalMessage);
        writeRuntimeStatus("paused_manual", {
          attemptPrefix,
          recoveryCount: recoveryHistory.length,
          recoveryHistory,
          recoverySummary: finalRecoverySummary,
          finalMessage: taskAttempt.finalMessage,
          code: finalizedResult.code,
          failureCode: activeFailure.code,
          failureFamily: activeFailure.family,
          failureReason: activeFailure.reason,
          notification,
        });

        return {
          ...finalizedResult,
          finalMessage: taskAttempt.finalMessage,
          recoveryCount: recoveryHistory.length,
          recoveryHistory,
          recoverySummary: finalRecoverySummary,
          recoveryFailure: {
            ...activeFailure,
            shouldStopTask: true,
            exhausted: true,
          },
          notification,
        };
      }

      writeRuntimeStatus("retry_waiting", {
        attemptPrefix,
        recoveryCount: nextRecoveryIndex,
        recoveryHistory,
        nextRetryDelayMs: delayMs,
        nextRetryAt: new Date(Date.now() + delayMs).toISOString(),
        failureCode: activeFailure.code,
        failureFamily: activeFailure.family,
        failureReason: activeFailure.reason,
      });
      if (delayMs > 0) {
        const canContinue = await sleepWithLease(delayMs, hostLease);
        if (!canContinue) {
          const stopped = buildHostLeaseStoppedResult("检测到宿主窗口已关闭，HelloLoop 已停止等待中的自动恢复。");
          writeRuntimeStatus("stopped_host_closed", {
            attemptPrefix,
            recoveryCount: recoveryHistory.length,
            recoveryHistory,
            code: stopped.code,
            failureCode: "host_closed",
            failureFamily: "host_lease",
            failureReason: stopped.leaseReason,
          });
          return {
            ...stopped,
            finalMessage: taskAttempt.finalMessage,
            recoveryCount: recoveryHistory.length,
            recoveryHistory,
            recoverySummary: "",
            recoveryFailure: null,
            notification: null,
          };
        }
      }

      const probeAttempt = await runEngineHealthProbe({
        engine: normalizedEngine,
        invocation,
        context,
        runDir,
        resolvedPolicy,
        recoveryPolicy,
        writeRuntimeStatus,
        recoveryCount: nextRecoveryIndex,
        recoveryHistory,
        hostLease,
        env,
        probeIndex: nextRecoveryIndex,
      });
      if (probeAttempt.result.leaseExpired) {
        writeRuntimeStatus("stopped_host_closed", {
          attemptPrefix: probeAttempt.attemptPrefix,
          recoveryCount: recoveryHistory.length,
          recoveryHistory,
          code: probeAttempt.result.code,
          failureCode: "host_closed",
          failureFamily: "host_lease",
          failureReason: probeAttempt.result.leaseReason,
        });
        return {
          ...probeAttempt.result,
          finalMessage: probeAttempt.finalMessage,
          recoveryCount: recoveryHistory.length,
          recoveryHistory,
          recoverySummary: "",
          recoveryFailure: null,
          notification: null,
        };
      }
      const recoveryRecord = {
        recoveryIndex: nextRecoveryIndex,
        family: activeFailure.family,
        code: activeFailure.code,
        reason: activeFailure.reason,
        delaySeconds: Math.floor(delayMs / 1000),
        taskStatus: "failed",
        taskCode: taskAttempt.result.code,
        taskAttemptPrefix: attemptPrefix,
        probeStatus: probeAttempt.result.ok ? "ok" : "failed",
        probeCode: probeAttempt.result.code,
        probeAttemptPrefix: probeAttempt.attemptPrefix,
        probeFailureCode: probeAttempt.failure?.code || "",
        probeFailureFamily: probeAttempt.failure?.family || "",
        probeFailureReason: probeAttempt.failure?.reason || "",
        watchdogTriggered: taskAttempt.result.watchdogTriggered === true || probeAttempt.result.watchdogTriggered === true,
      };
      recoveryHistory.push(recoveryRecord);
      writeJson(path.join(
        runDir,
        `${prefix}-auto-recovery-${String(nextRecoveryIndex).padStart(2, "0")}.json`,
      ), {
        ...recoveryRecord,
        engine: normalizedEngine,
        phase: executionMode,
        stdoutTail: tailText(taskAttempt.result.stdout, 20),
        stderrTail: tailText(taskAttempt.result.stderr, 20),
        finalMessageTail: tailText(taskAttempt.finalMessage, 20),
        probeStdoutTail: tailText(probeAttempt.result.stdout, 20),
        probeStderrTail: tailText(probeAttempt.result.stderr, 20),
        probeFinalMessageTail: tailText(probeAttempt.finalMessage, 20),
        createdAt: nowIso(),
      });

      if (!probeAttempt.result.ok) {
        activeFailure = probeAttempt.failure;
        writeRuntimeStatus("probe_failed", {
          attemptPrefix: probeAttempt.attemptPrefix,
          recoveryCount: nextRecoveryIndex,
          recoveryHistory,
          failureCode: activeFailure.code,
          failureFamily: activeFailure.family,
          failureReason: activeFailure.reason,
        });
        continue;
      }

      currentPrompt = recoveryPrompt;
      currentRecoveryCount = nextRecoveryIndex;
      break;
    }
  }
}

import fs from "node:fs";
import path from "node:path";

import { ensureDir, nowIso, tailText, writeJson, writeText } from "./common.mjs";
import { getEngineDisplayName, normalizeEngineName } from "./engine_metadata.mjs";
import {
  buildClaudeArgs,
  buildCodexArgs,
  buildGeminiArgs,
  resolveEngineInvocation,
  resolveVerifyInvocation,
  runChild,
} from "./engine_process_support.mjs";
import { sendRuntimeStopNotification } from "./email_notification.mjs";
import { loadGlobalConfig } from "./global_config.mjs";
import {
  buildEngineHealthProbePrompt,
  buildRuntimeRecoveryPrompt,
  classifyRuntimeRecoveryFailure,
  renderRuntimeRecoverySummary,
  resolveRuntimeRecoveryPolicy,
  selectRuntimeRecoveryDelayMs,
} from "./runtime_recovery.mjs";

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createRuntimeStatusWriter(runtimeStatusFile, baseState) {
  return function writeRuntimeStatus(status, extra = {}) {
    writeJson(runtimeStatusFile, {
      ...baseState,
      ...extra,
      status,
      updatedAt: nowIso(),
    });
  };
}

function writeEngineRunArtifacts(runDir, prefix, result, finalMessage) {
  writeText(path.join(runDir, `${prefix}-stdout.log`), result.stdout);
  writeText(path.join(runDir, `${prefix}-stderr.log`), result.stderr);
  writeText(path.join(runDir, `${prefix}-summary.txt`), [
    `ok=${result.ok}`,
    `code=${result.code}`,
    `finished_at=${nowIso()}`,
    "",
    finalMessage,
  ].join("\n"));
}

function resolveEnginePolicy(policy = {}, engine) {
  if (engine === "codex") {
    return policy.codex || {};
  }
  if (engine === "claude") {
    return policy.claude || {};
  }
  if (engine === "gemini") {
    return policy.gemini || {};
  }
  return {};
}

function buildEngineArgs({
  engine,
  context,
  resolvedPolicy,
  executionMode,
  outputSchemaFile,
  ephemeral,
  skipGitRepoCheck,
  lastMessageFile,
  probeMode = false,
}) {
  if (engine === "codex") {
    return buildCodexArgs({
      context,
      model: resolvedPolicy.model,
      sandbox: resolvedPolicy.sandbox,
      dangerouslyBypassSandbox: resolvedPolicy.dangerouslyBypassSandbox,
      jsonOutput: probeMode ? false : (resolvedPolicy.jsonOutput !== false),
      outputSchemaFile: probeMode ? "" : outputSchemaFile,
      ephemeral,
      skipGitRepoCheck,
      lastMessageFile,
    });
  }

  if (engine === "claude") {
    return buildClaudeArgs({
      model: resolvedPolicy.model,
      outputSchemaFile: probeMode ? "" : outputSchemaFile,
      executionMode: probeMode ? "execute" : executionMode,
      policy: resolvedPolicy,
    });
  }

  return buildGeminiArgs({
    model: resolvedPolicy.model,
    executionMode: probeMode ? "execute" : executionMode,
    policy: resolvedPolicy,
  });
}

function readEngineFinalMessage(engine, lastMessageFile, result) {
  if (engine === "codex") {
    return fs.existsSync(lastMessageFile)
      ? fs.readFileSync(lastMessageFile, "utf8").trim()
      : "";
  }
  return String(result.stdout || "").trim();
}

async function runEngineAttempt({
  engine,
  invocation,
  context,
  prompt,
  runDir,
  attemptPrefix,
  resolvedPolicy,
  executionMode,
  outputSchemaFile,
  env,
  recoveryPolicy,
  writeRuntimeStatus,
  recoveryCount,
  recoveryHistory,
  ephemeral = false,
  skipGitRepoCheck = false,
  probeMode = false,
}) {
  const attemptPromptFile = path.join(runDir, `${attemptPrefix}-prompt.md`);
  const attemptLastMessageFile = path.join(runDir, `${attemptPrefix}-last-message.txt`);

  if (invocation.error) {
    const result = {
      ok: false,
      code: 1,
      stdout: "",
      stderr: invocation.error,
      signal: "",
      startedAt: nowIso(),
      finishedAt: nowIso(),
      idleTimeout: false,
      watchdogTriggered: false,
      watchdogReason: "",
    };
    writeText(attemptPromptFile, prompt);
    writeEngineRunArtifacts(runDir, attemptPrefix, result, "");
    return {
      result,
      finalMessage: "",
      attemptPrefix,
    };
  }

  const finalArgs = [
    ...invocation.argsPrefix,
    ...buildEngineArgs({
      engine,
      context,
      resolvedPolicy,
      executionMode,
      outputSchemaFile,
      ephemeral,
      skipGitRepoCheck,
      lastMessageFile: attemptLastMessageFile,
      probeMode,
    }),
  ];

  writeRuntimeStatus(probeMode ? "probe_running" : (recoveryCount > 0 ? "recovering" : "running"), {
    attemptPrefix,
    recoveryCount,
    recoveryHistory,
  });

  const result = await runChild(invocation.command, finalArgs, {
    cwd: context.repoRoot,
    stdin: prompt,
    env,
    shell: invocation.shell,
    heartbeatIntervalMs: recoveryPolicy.heartbeatIntervalSeconds * 1000,
    stallWarningMs: recoveryPolicy.stallWarningSeconds * 1000,
    maxIdleMs: recoveryPolicy.maxIdleSeconds * 1000,
    killGraceMs: recoveryPolicy.killGraceSeconds * 1000,
    onHeartbeat(payload) {
      writeRuntimeStatus(payload.status, {
        attemptPrefix,
        recoveryCount,
        recoveryHistory,
        heartbeat: payload,
      });
    },
  });
  const finalMessage = readEngineFinalMessage(engine, attemptLastMessageFile, result);

  writeText(attemptPromptFile, prompt);
  writeEngineRunArtifacts(runDir, attemptPrefix, result, finalMessage);

  return {
    result,
    finalMessage,
    attemptPrefix,
  };
}

async function runEngineHealthProbe({
  engine,
  invocation,
  context,
  runDir,
  resolvedPolicy,
  recoveryPolicy,
  writeRuntimeStatus,
  recoveryCount,
  recoveryHistory,
  env,
  probeIndex,
}) {
  const probePrompt = buildEngineHealthProbePrompt(engine);
  const attemptPrefix = `${engine}-probe-${String(probeIndex).padStart(2, "0")}`;
  writeRuntimeStatus("probe_waiting", {
    attemptPrefix,
    recoveryCount,
    recoveryHistory,
  });
  const attempt = await runEngineAttempt({
    engine,
    invocation,
    context,
    prompt: probePrompt,
    runDir,
    attemptPrefix,
    resolvedPolicy,
    executionMode: "execute",
    outputSchemaFile: "",
    env,
    recoveryPolicy: {
      ...recoveryPolicy,
      maxIdleSeconds: recoveryPolicy.healthProbeTimeoutSeconds,
    },
    writeRuntimeStatus,
    recoveryCount,
    recoveryHistory,
    ephemeral: true,
    skipGitRepoCheck: true,
    probeMode: true,
  });

  return {
    ...attempt,
    failure: classifyRuntimeRecoveryFailure({
      result: {
        ...attempt.result,
        finalMessage: attempt.finalMessage,
      },
    }),
  };
}

async function maybeSendStopNotification({
  context,
  runDir,
  engine,
  executionMode,
  failure,
  result,
  recoveryHistory,
}) {
  try {
    return await sendRuntimeStopNotification({
      globalConfig: loadGlobalConfig(),
      context,
      engine: getEngineDisplayName(engine),
      phase: executionMode === "analyze" ? "分析/复核" : "执行",
      failure,
      result,
      recoveryHistory,
      runDir,
    });
  } catch (error) {
    return {
      attempted: true,
      delivered: false,
      reason: String(error?.message || error || "邮件发送失败。"),
    };
  }
}

function buildNotificationNote(notificationResult) {
  if (!notificationResult) {
    return "";
  }
  if (notificationResult.delivered) {
    return `告警邮件已发送：${(notificationResult.recipients || []).join(", ")}`;
  }
  if (notificationResult.attempted) {
    return `告警邮件发送失败：${notificationResult.reason || "未知原因"}`;
  }
  return `未发送告警邮件：${notificationResult.reason || "未启用"}`;
}

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
  });

  const recoveryHistory = [];
  let currentPrompt = prompt;
  let currentRecoveryCount = 0;
  let activeFailure = null;

  while (true) {
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
      ephemeral,
      skipGitRepoCheck,
      probeMode: false,
    });

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
        await sleep(delayMs);
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
        env,
        probeIndex: nextRecoveryIndex,
      });
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

export async function runCodexTask(options) {
  return runEngineTask({
    ...options,
    engine: "codex",
  });
}

export async function runCodexExec({ context, prompt, runDir, policy }) {
  return runEngineTask({
    engine: "codex",
    context,
    prompt,
    runDir,
    policy,
    executionMode: "execute",
    outputPrefix: "codex",
  });
}

export async function runEngineExec({ engine, context, prompt, runDir, policy }) {
  return runEngineTask({
    engine,
    context,
    prompt,
    runDir,
    policy,
    executionMode: "execute",
    outputPrefix: engine,
  });
}

export async function runShellCommand(context, commandLine, runDir, index) {
  const shellInvocation = resolveVerifyInvocation();
  if (shellInvocation.error) {
    const result = {
      command: commandLine,
      ok: false,
      code: 1,
      stdout: "",
      stderr: shellInvocation.error,
    };
    const prefix = String(index + 1).padStart(2, "0");
    writeText(path.join(runDir, `${prefix}-verify-command.txt`), commandLine);
    writeText(path.join(runDir, `${prefix}-verify-stdout.log`), result.stdout);
    writeText(path.join(runDir, `${prefix}-verify-stderr.log`), result.stderr);
    return result;
  }

  const result = await runChild(shellInvocation.command, [
    ...shellInvocation.argsPrefix,
    commandLine,
  ], {
    cwd: context.repoRoot,
    shell: shellInvocation.shell,
  });

  const prefix = String(index + 1).padStart(2, "0");
  writeText(path.join(runDir, `${prefix}-verify-command.txt`), commandLine);
  writeText(path.join(runDir, `${prefix}-verify-stdout.log`), result.stdout);
  writeText(path.join(runDir, `${prefix}-verify-stderr.log`), result.stderr);

  return { command: commandLine, ...result };
}

export async function runVerifyCommands(context, commands, runDir) {
  const results = [];

  for (const [index, command] of commands.entries()) {
    const result = await runShellCommand(context, command, runDir, index);
    results.push(result);
    if (!result.ok) {
      return {
        ok: false,
        results,
        failed: result,
        summary: [
          `验证失败：${result.command}`,
          "",
          "stdout 尾部：",
          tailText(result.stdout, 40),
          "",
          "stderr 尾部：",
          tailText(result.stderr, 40),
        ].join("\n").trim(),
      };
    }
  }

  return {
    ok: true,
    results,
    failed: null,
    summary: "全部验证命令通过。",
  };
}

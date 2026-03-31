import fs from "node:fs";
import path from "node:path";

import { appendText, nowIso, writeText } from "./common.mjs";
import { getEngineDisplayName } from "./engine_metadata.mjs";
import {
  buildClaudeArgs,
  buildCodexArgs,
  buildGeminiArgs,
  runChild,
} from "./engine_process_support.mjs";
import { sendRuntimeStopNotification } from "./email_notification.mjs";
import { loadGlobalConfig } from "./global_config.mjs";
import {
  buildEngineHealthProbePrompt,
  classifyRuntimeRecoveryFailure,
} from "./runtime_recovery.mjs";
import { isHostLeaseAlive } from "./host_lease.mjs";

export async function sleepWithLease(ms, hostLease = null) {
  const totalMs = Math.max(0, Number(ms || 0));
  if (totalMs <= 0) {
    return isHostLeaseAlive(hostLease);
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < totalMs) {
    if (!isHostLeaseAlive(hostLease)) {
      return false;
    }
    const remaining = totalMs - (Date.now() - startedAt);
    await new Promise((resolve) => {
      setTimeout(resolve, Math.min(1000, Math.max(50, remaining)));
    });
  }
  return isHostLeaseAlive(hostLease);
}

export function buildHostLeaseStoppedResult(reason) {
  return {
    ok: false,
    code: 1,
    stdout: "",
    stderr: reason,
    signal: "",
    startedAt: nowIso(),
    finishedAt: nowIso(),
    idleTimeout: false,
    watchdogTriggered: false,
    watchdogReason: "",
    leaseExpired: true,
    leaseReason: reason,
  };
}

export function createRuntimeStatusWriter(runtimeStatusFile, baseState) {
  return function writeRuntimeStatus(status, extra = {}) {
    writeJson(runtimeStatusFile, {
      ...baseState,
      ...extra,
      status,
      updatedAt: nowIso(),
    });
  };
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeEngineRunArtifacts(runDir, prefix, result, finalMessage) {
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

export function resolveEnginePolicy(policy = {}, engine) {
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

export async function runEngineAttempt({
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
  hostLease,
  ephemeral = false,
  skipGitRepoCheck = false,
  probeMode = false,
}) {
  const attemptPromptFile = path.join(runDir, `${attemptPrefix}-prompt.md`);
  const attemptLastMessageFile = path.join(runDir, `${attemptPrefix}-last-message.txt`);
  const attemptStdoutFile = path.join(runDir, `${attemptPrefix}-stdout.log`);
  const attemptStderrFile = path.join(runDir, `${attemptPrefix}-stderr.log`);

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
  writeText(attemptStdoutFile, "");
  writeText(attemptStderrFile, "");

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
    onStdout(text) {
      appendText(attemptStdoutFile, text);
    },
    onStderr(text) {
      appendText(attemptStderrFile, text);
    },
    shouldKeepRunning() {
      return isHostLeaseAlive(hostLease);
    },
    leaseStopReason: "检测到宿主窗口已关闭，HelloLoop 已停止当前引擎进程。",
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

export async function runEngineHealthProbe({
  engine,
  invocation,
  context,
  runDir,
  resolvedPolicy,
  recoveryPolicy,
  writeRuntimeStatus,
  recoveryCount,
  recoveryHistory,
  hostLease,
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
    hostLease,
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

export async function maybeSendStopNotification({
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

export function buildNotificationNote(notificationResult) {
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

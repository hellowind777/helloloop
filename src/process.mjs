import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { ensureDir, nowIso, tailText, writeJson, writeText } from "./common.mjs";
import { getEngineDisplayName, normalizeEngineName } from "./engine_metadata.mjs";
import { resolveCliInvocation, resolveCodexInvocation, resolveVerifyShellInvocation } from "./shell_invocation.mjs";
import {
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

function runChild(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...(options.env || {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
      shell: Boolean(options.shell),
    });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const startedAt = Date.now();
    let lastOutputAt = startedAt;
    let watchdogTriggered = false;
    let watchdogReason = "";
    let stallWarned = false;
    let killTimer = null;

    const emitHeartbeat = (status, extra = {}) => {
      options.onHeartbeat?.({
        status,
        pid: child.pid ?? null,
        startedAt: new Date(startedAt).toISOString(),
        lastOutputAt: new Date(lastOutputAt).toISOString(),
        stdoutBytes,
        stderrBytes,
        idleSeconds: Math.max(0, Math.floor((Date.now() - lastOutputAt) / 1000)),
        watchdogTriggered,
        watchdogReason,
        ...extra,
      });
    };

    const heartbeatIntervalMs = Math.max(100, Number(options.heartbeatIntervalMs || 0));
    const stallWarningMs = Math.max(0, Number(options.stallWarningMs || 0));
    const maxIdleMs = Math.max(0, Number(options.maxIdleMs || 0));
    const killGraceMs = Math.max(100, Number(options.killGraceMs || 1000));

    const heartbeatTimer = heartbeatIntervalMs > 0
      ? setInterval(() => {
        const idleMs = Date.now() - lastOutputAt;
        if (stallWarningMs > 0 && idleMs >= stallWarningMs && !stallWarned) {
          stallWarned = true;
          emitHeartbeat("suspected_stall", {
            message: `当前子进程已连续 ${Math.floor(idleMs / 1000)} 秒没有可见输出，继续观察。`,
          });
        }

        if (maxIdleMs > 0 && idleMs >= maxIdleMs && !watchdogTriggered) {
          watchdogTriggered = true;
          watchdogReason = `当前子进程已连续 ${Math.floor(idleMs / 1000)} 秒没有可见输出。`;
          stderr = [
            stderr.trim(),
            `[HelloLoop watchdog] ${watchdogReason}`,
          ].filter(Boolean).join("\n");
          emitHeartbeat("watchdog_terminating", {
            message: "已达到无人值守恢复阈值，准备终止当前子进程并发起同引擎恢复。",
          });
          child.kill();
          killTimer = setTimeout(() => {
            child.kill("SIGKILL");
          }, killGraceMs);
          return;
        }

        emitHeartbeat(watchdogTriggered ? "watchdog_waiting" : "running");
      }, heartbeatIntervalMs)
      : null;

    emitHeartbeat("running");

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      stdoutBytes += chunk.length;
      lastOutputAt = Date.now();
      stallWarned = false;
      emitHeartbeat("running");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      stderrBytes += chunk.length;
      lastOutputAt = Date.now();
      stallWarned = false;
      emitHeartbeat("running");
    });

    if (options.stdin) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();

    child.on("error", (error) => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      if (killTimer) {
        clearTimeout(killTimer);
      }
      emitHeartbeat("failed", {
        code: 1,
        signal: "",
      });
      resolve({
        ok: false,
        code: 1,
        stdout,
        stderr: String(error?.stack || error || ""),
        signal: "",
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: nowIso(),
        idleTimeout: watchdogTriggered,
        watchdogTriggered,
        watchdogReason,
      });
    });

    child.on("close", (code, signal) => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      if (killTimer) {
        clearTimeout(killTimer);
      }
      emitHeartbeat(code === 0 ? "completed" : "failed", {
        code: code ?? 1,
        signal: signal || "",
      });
      resolve({
        ok: code === 0,
        code: code ?? 1,
        stdout,
        stderr,
        signal: signal || "",
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: nowIso(),
        idleTimeout: watchdogTriggered,
        watchdogTriggered,
        watchdogReason,
      });
    });
  });
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

function readSchemaText(outputSchemaFile = "") {
  return outputSchemaFile && fs.existsSync(outputSchemaFile)
    ? fs.readFileSync(outputSchemaFile, "utf8").trim()
    : "";
}

function resolveEngineInvocation(engine, explicitExecutable = "") {
  const envExecutable = String(process.env[`HELLOLOOP_${String(engine || "").toUpperCase()}_EXECUTABLE`] || "").trim();
  const executable = envExecutable || explicitExecutable;
  if (engine === "codex") {
    return resolveCodexInvocation({ explicitExecutable: executable });
  }

  const meta = {
    claude: {
      commandName: "claude",
      displayName: "Claude",
    },
    gemini: {
      commandName: "gemini",
      displayName: "Gemini",
    },
  }[engine];

  if (!meta) {
    return {
      command: "",
      argsPrefix: [],
      shell: false,
      error: `不支持的执行引擎：${engine}`,
    };
  }

  return resolveCliInvocation({
    commandName: meta.commandName,
    toolDisplayName: meta.displayName,
    explicitExecutable: executable,
  });
}

function buildCodexArgs({
  context,
  model = "",
  sandbox = "workspace-write",
  dangerouslyBypassSandbox = false,
  jsonOutput = true,
  outputSchemaFile = "",
  ephemeral = false,
  skipGitRepoCheck = false,
  lastMessageFile,
}) {
  const codexArgs = ["exec", "-C", context.repoRoot];

  if (model) {
    codexArgs.push("--model", model);
  }
  if (dangerouslyBypassSandbox) {
    codexArgs.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    codexArgs.push("--sandbox", sandbox);
  }
  if (skipGitRepoCheck) {
    codexArgs.push("--skip-git-repo-check");
  }
  if (ephemeral) {
    codexArgs.push("--ephemeral");
  }
  if (outputSchemaFile) {
    codexArgs.push("--output-schema", outputSchemaFile);
  }
  if (jsonOutput) {
    codexArgs.push("--json");
  }
  codexArgs.push("-o", lastMessageFile, "-");
  return codexArgs;
}

function buildClaudeArgs({
  model = "",
  outputSchemaFile = "",
  executionMode = "analyze",
  policy = {},
}) {
  const args = [
    "-p",
    executionMode === "analyze"
      ? "请读取标准输入中的完整分析任务并直接输出最终结果。"
      : "请读取标准输入中的完整开发任务并直接完成它。",
    "--output-format",
    policy.outputFormat || "text",
    "--permission-mode",
    executionMode === "analyze"
      ? (policy.analysisPermissionMode || "plan")
      : (policy.permissionMode || "bypassPermissions"),
    "--no-session-persistence",
  ];

  if (model) {
    args.push("--model", model);
  }

  const schemaText = readSchemaText(outputSchemaFile);
  if (schemaText) {
    args.push("--json-schema", schemaText);
  }

  return args;
}

function buildGeminiArgs({
  model = "",
  executionMode = "analyze",
  policy = {},
}) {
  const args = [
    "-p",
    executionMode === "analyze"
      ? "请读取标准输入中的完整分析任务并直接输出最终结果。"
      : "请读取标准输入中的完整开发任务并直接完成它。",
    "--output-format",
    policy.outputFormat || "text",
    "--approval-mode",
    executionMode === "analyze"
      ? (policy.analysisApprovalMode || "plan")
      : (policy.approvalMode || "yolo"),
  ];

  if (model) {
    args.push("--model", model);
  }

  return args;
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
    maxPhaseRecoveries: recoveryPolicy.maxPhaseRecoveries,
  });

  let args = [];
  if (normalizedEngine === "claude") {
    args = buildClaudeArgs({
      model: resolvedPolicy.model,
      outputSchemaFile,
      executionMode,
      policy: resolvedPolicy,
    });
  } else if (normalizedEngine === "gemini") {
    args = buildGeminiArgs({
      model: resolvedPolicy.model,
      executionMode,
      policy: resolvedPolicy,
    });
  }

  if (invocation.error) {
    const result = {
      ok: false,
      code: 1,
      stdout: "",
      stderr: invocation.error,
    };
    writeText(path.join(runDir, `${prefix}-prompt.md`), prompt);
    writeEngineRunArtifacts(runDir, prefix, result, "");
    writeRuntimeStatus("failed", {
      code: result.code,
      message: invocation.error,
      recoveryCount: 0,
      recoveryHistory: [],
    });
    return { ...result, finalMessage: "" };
  }

  const recoveryHistory = [];
  let currentPrompt = prompt;
  let currentRecoveryCount = 0;

  while (true) {
    const attemptPrefix = currentRecoveryCount === 0
      ? prefix
      : `${prefix}-recovery-${String(currentRecoveryCount).padStart(2, "0")}`;
    const attemptPromptFile = path.join(runDir, `${attemptPrefix}-prompt.md`);
    const attemptLastMessageFile = path.join(runDir, `${attemptPrefix}-last-message.txt`);
    const finalArgs = normalizedEngine === "codex"
      ? [
        ...invocation.argsPrefix,
        ...buildCodexArgs({
          context,
          model: resolvedPolicy.model,
          sandbox: resolvedPolicy.sandbox,
          dangerouslyBypassSandbox: resolvedPolicy.dangerouslyBypassSandbox,
          jsonOutput: resolvedPolicy.jsonOutput !== false,
          outputSchemaFile,
          ephemeral,
          skipGitRepoCheck,
          lastMessageFile: attemptLastMessageFile,
        }),
      ]
      : [...invocation.argsPrefix, ...args];

    writeRuntimeStatus(currentRecoveryCount > 0 ? "recovering" : "running", {
      attemptPrefix,
      recoveryCount: currentRecoveryCount,
      recoveryHistory,
    });

    const result = await runChild(invocation.command, finalArgs, {
      cwd: context.repoRoot,
      stdin: currentPrompt,
      env,
      shell: invocation.shell,
      heartbeatIntervalMs: recoveryPolicy.heartbeatIntervalSeconds * 1000,
      stallWarningMs: recoveryPolicy.stallWarningSeconds * 1000,
      maxIdleMs: recoveryPolicy.maxIdleSeconds * 1000,
      killGraceMs: recoveryPolicy.killGraceSeconds * 1000,
      onHeartbeat(payload) {
        writeRuntimeStatus(payload.status, {
          attemptPrefix,
          recoveryCount: currentRecoveryCount,
          recoveryHistory,
          heartbeat: payload,
        });
      },
    });
    const finalMessage = normalizedEngine === "codex"
      ? (fs.existsSync(attemptLastMessageFile) ? fs.readFileSync(attemptLastMessageFile, "utf8").trim() : "")
      : String(result.stdout || "").trim();

    writeText(attemptPromptFile, currentPrompt);
    writeEngineRunArtifacts(runDir, attemptPrefix, result, finalMessage);

    const failure = classifyRuntimeRecoveryFailure({
      result: {
        ...result,
        finalMessage,
      },
      recoveryPolicy,
      recoveryCount: currentRecoveryCount,
    });

    if (
      result.ok
      || !recoveryPolicy.enabled
      || !failure.recoverable
      || currentRecoveryCount >= recoveryPolicy.maxPhaseRecoveries
    ) {
      const finalRecoverySummary = renderRuntimeRecoverySummary(recoveryHistory);
      const finalizedResult = result.ok || !finalRecoverySummary
        ? result
        : {
          ...result,
          stderr: [result.stderr, "", finalRecoverySummary].filter(Boolean).join("\n").trim(),
        };

      writeText(path.join(runDir, `${prefix}-prompt.md`), currentPrompt);
      writeEngineRunArtifacts(runDir, prefix, finalizedResult, finalMessage);
      if (normalizedEngine === "codex" && finalMessage) {
        writeText(path.join(runDir, `${prefix}-last-message.txt`), finalMessage);
      }
      writeRuntimeStatus(result.ok ? "completed" : "failed", {
        attemptPrefix,
        recoveryCount: currentRecoveryCount,
        recoveryHistory,
        recoverySummary: finalRecoverySummary,
        finalMessage,
        code: finalizedResult.code,
        failureCode: failure.code,
        failureReason: failure.reason,
      });

      return {
        ...finalizedResult,
        finalMessage,
        recoveryCount: currentRecoveryCount,
        recoveryHistory,
        recoverySummary: finalRecoverySummary,
        recoveryFailure: failure,
      };
    }

    const nextRecoveryIndex = currentRecoveryCount + 1;
    const delayMs = selectRuntimeRecoveryDelayMs(recoveryPolicy, nextRecoveryIndex);
    const recoveryPrompt = buildRuntimeRecoveryPrompt({
      basePrompt: prompt,
      engine: normalizedEngine,
      phaseLabel: executionMode === "analyze" ? "分析/复核" : "执行",
      failure,
      result: {
        ...result,
        finalMessage,
      },
      nextRecoveryIndex,
      maxRecoveries: recoveryPolicy.maxPhaseRecoveries,
    });
    const recoveryRecord = {
      recoveryIndex: nextRecoveryIndex,
      code: failure.code,
      reason: failure.reason,
      delaySeconds: Math.floor(delayMs / 1000),
      sourceCode: result.code,
      watchdogTriggered: result.watchdogTriggered === true,
      attemptPrefix,
    };
    recoveryHistory.push(recoveryRecord);
    writeJson(path.join(
      runDir,
      `${prefix}-auto-recovery-${String(nextRecoveryIndex).padStart(2, "0")}.json`,
    ), {
      ...recoveryRecord,
      engine: normalizedEngine,
      phase: executionMode,
      stdoutTail: tailText(result.stdout, 20),
      stderrTail: tailText(result.stderr, 20),
      finalMessageTail: tailText(finalMessage, 20),
      createdAt: nowIso(),
    });
    writeText(
      path.join(runDir, `${prefix}-auto-recovery-${String(nextRecoveryIndex).padStart(2, "0")}-prompt.md`),
      recoveryPrompt,
    );
    writeRuntimeStatus("retry_waiting", {
      attemptPrefix,
      recoveryCount: nextRecoveryIndex,
      recoveryHistory,
      nextRetryDelayMs: delayMs,
      failureCode: failure.code,
      failureReason: failure.reason,
    });
    if (delayMs > 0) {
      await sleep(delayMs);
    }
    currentPrompt = recoveryPrompt;
    currentRecoveryCount = nextRecoveryIndex;
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
  const shellInvocation = resolveVerifyShellInvocation();
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

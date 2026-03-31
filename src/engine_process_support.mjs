import fs from "node:fs";
import { spawn } from "node:child_process";

import {
  resolveCliInvocation,
  resolveCodexInvocation,
  resolveVerifyShellInvocation,
} from "./shell_invocation.mjs";

export function isIgnorableStdinError(error) {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || "").toLowerCase();
  return code === "EPIPE"
    || code === "ERR_STREAM_DESTROYED"
    || message.includes("broken pipe")
    || message.includes("write after end");
}

export function runChild(command, args, options = {}) {
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
    let leaseExpired = false;
    let leaseReason = "";

    const requestLeaseTermination = () => {
      if (leaseExpired) {
        return;
      }
      leaseExpired = true;
      leaseReason = String(options.leaseStopReason || "检测到宿主窗口已关闭，HelloLoop 已停止当前子进程。").trim();
      stderr = [
        stderr.trim(),
        `[HelloLoop host-lease] ${leaseReason}`,
      ].filter(Boolean).join("\n");
      emitHeartbeat("lease_terminating", {
        message: leaseReason,
      });
      child.kill();
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, killGraceMs);
    };

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
        leaseExpired,
        leaseReason,
        ...extra,
      });
    };

    const heartbeatIntervalMs = Math.max(100, Number(options.heartbeatIntervalMs || 0));
    const stallWarningMs = Math.max(0, Number(options.stallWarningMs || 0));
    const maxIdleMs = Math.max(0, Number(options.maxIdleMs || 0));
    const killGraceMs = Math.max(100, Number(options.killGraceMs || 1000));

    const heartbeatTimer = heartbeatIntervalMs > 0
      ? setInterval(() => {
        if (typeof options.shouldKeepRunning === "function" && !options.shouldKeepRunning()) {
          requestLeaseTermination();
          return;
        }

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

    child.stdin.on("error", (error) => {
      if (isIgnorableStdinError(error)) {
        return;
      }
      stderr = [
        stderr.trim(),
        `[HelloLoop stdin] ${String(error?.stack || error || "")}`,
      ].filter(Boolean).join("\n");
    });

    try {
      if (options.stdin) {
        child.stdin.write(options.stdin);
      }
      child.stdin.end();
    } catch (error) {
      if (!isIgnorableStdinError(error)) {
        stderr = [
          stderr.trim(),
          `[HelloLoop stdin] ${String(error?.stack || error || "")}`,
        ].filter(Boolean).join("\n");
      }
    }

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
        finishedAt: new Date().toISOString(),
        idleTimeout: watchdogTriggered,
        watchdogTriggered,
        watchdogReason,
        leaseExpired,
        leaseReason,
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
        finishedAt: new Date().toISOString(),
        idleTimeout: watchdogTriggered,
        watchdogTriggered,
        watchdogReason,
        leaseExpired,
        leaseReason,
      });
    });
  });
}

export function readSchemaText(outputSchemaFile = "") {
  return outputSchemaFile && fs.existsSync(outputSchemaFile)
    ? fs.readFileSync(outputSchemaFile, "utf8").trim()
    : "";
}

export function resolveEngineInvocation(engine, explicitExecutable = "") {
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

export function buildCodexArgs({
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

export function buildClaudeArgs({
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

export function buildGeminiArgs({
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

export function resolveVerifyInvocation() {
  return resolveVerifyShellInvocation();
}

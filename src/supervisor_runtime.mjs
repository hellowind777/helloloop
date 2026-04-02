import fs from "node:fs";
import path from "node:path";

import { createContext } from "./context.mjs";
import { nowIso, readJson, writeJson, readTextIfExists, timestampForFile } from "./common.mjs";
import { refreshHostContinuationArtifacts } from "./host_continuation.mjs";
import { isHostLeaseAlive, renderHostLeaseLabel, resolveHostLease } from "./host_lease.mjs";
import { spawnNodeProcess } from "./node_process_launch.mjs";
import { runLoop, runOnce } from "./runner.mjs";
import {
  FINAL_SUPERVISOR_STATUSES,
  clearSupervisorPause,
  hasActiveSupervisor,
  isTrackedPidAlive,
  readJsonIfExists,
  readSupervisorState,
  writeActiveSupervisorState,
  writeSupervisorState,
} from "./supervisor_state.mjs";
import {
  bindBackgroundTerminalSession,
  cancelPreparedTerminalSessionBackground,
  finalizePreparedTerminalSessionBackground,
  prepareCurrentTerminalSessionForBackground,
} from "./terminal_session_limits.mjs";
import { registerActiveSession, unregisterActiveSession } from "./workspace_registry.mjs";

function removeIfExists(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // ignore cleanup failures
  }
}

function toSerializableOptions(options = {}) {
  return JSON.parse(JSON.stringify(options));
}

function refreshContinuation(context, sessionId) {
  try {
    refreshHostContinuationArtifacts(context, { sessionId });
  } catch {
    // ignore continuation snapshot refresh failures
  }
}

function writeStoppedState(context, request, message) {
  const payload = {
    sessionId: request.sessionId,
    command: request.command,
    exitCode: 1,
    ok: false,
    stopped: true,
    error: message,
  };
  writeJson(context.supervisorResultFile, payload);
  writeSupervisorState(context, {
    sessionId: request.sessionId,
    command: request.command,
    status: "stopped",
    exitCode: payload.exitCode,
    message,
    completedAt: nowIso(),
  });
}

function buildSupervisorSessionState(sessionId, command, lease, pid, message) {
  return {
    sessionId,
    status: "running",
    command,
    lease,
    startedAt: nowIso(),
    pid,
    guardianPid: pid,
    workerPid: 0,
    message,
  };
}

export function renderSupervisorLaunchSummary(session) {
  return [
    `HelloLoop 后台守护进程已启动：${session.sessionId}`,
    `- 宿主租约：${renderHostLeaseLabel(session.lease)}`,
    "- 当前 turn 若被中断，只要当前宿主窗口仍存活，本轮自动执行会继续。",
    "- 守护进程会在 worker 异常退出后按设置自动重拉起，尽量保持后台持续活跃。",
    "- 如需主动停止，直接关闭当前 CLI 窗口即可。",
  ].join("\n");
}

export function launchSupervisedCommand(context, command, options = {}) {
  const existing = readSupervisorState(context);
  if (hasActiveSupervisor(context)) {
    throw new Error(`已有 HelloLoop supervisor 正在运行：${existing?.sessionId || "unknown"}`);
  }

  const sessionId = timestampForFile();
  const lease = resolveHostLease({ hostContext: options.hostContext });
  const terminalSession = prepareCurrentTerminalSessionForBackground({
    command,
    repoRoot: context.repoRoot,
    sessionId,
  });
  const request = {
    sessionId,
    command,
    context: {
      repoRoot: context.repoRoot,
      configDirName: context.configDirName,
    },
    options: toSerializableOptions({
      ...options,
      supervisorSessionId: sessionId,
    }),
    lease,
    terminalSessionFile: terminalSession?.file || "",
  };

  fs.mkdirSync(context.supervisorRoot, { recursive: true });
  clearSupervisorPause(context);
  removeIfExists(context.supervisorResultFile);
  removeIfExists(context.supervisorStdoutFile);
  removeIfExists(context.supervisorStderrFile);
  writeJson(context.supervisorRequestFile, request);
  writeActiveSupervisorState(context, {
    sessionId,
    status: "launching",
    command,
    lease,
    startedAt: nowIso(),
    pid: 0,
    guardianPid: 0,
    workerPid: 0,
  });
  refreshContinuation(context, sessionId);

  const stdoutFd = fs.openSync(context.supervisorStdoutFile, "w");
  const stderrFd = fs.openSync(context.supervisorStderrFile, "w");

  try {
    const child = spawnNodeProcess({
      args: [
        path.join(context.bundleRoot, "bin", "helloloop.js"),
        "__supervise",
        "--session-file",
        context.supervisorRequestFile,
      ],
      cwd: context.repoRoot,
      detached: true,
      stdio: ["ignore", stdoutFd, stderrFd],
      env: {
        HELLOLOOP_SUPERVISOR_ACTIVE: "1",
      },
    });

    finalizePreparedTerminalSessionBackground(child.pid ?? 0, {
      command,
      repoRoot: context.repoRoot,
      sessionId,
    });
    child.unref();

    writeActiveSupervisorState(
      context,
      buildSupervisorSessionState(sessionId, command, lease, child.pid ?? 0, "后台守护进程正在运行。"),
    );
    refreshContinuation(context, sessionId);

    registerActiveSession({
      sessionId,
      repoRoot: context.repoRoot,
      configDirName: context.configDirName,
      command,
      pid: child.pid ?? 0,
      guardianPid: child.pid ?? 0,
      lease,
      startedAt: nowIso(),
      supervisorStateFile: context.supervisorStateFile,
      supervisorResultFile: context.supervisorResultFile,
      statusFile: context.statusFile,
    });

    return {
      sessionId,
      pid: child.pid ?? 0,
      lease,
    };
  } catch (error) {
    unregisterActiveSession(sessionId);
    cancelPreparedTerminalSessionBackground({
      command,
      repoRoot: context.repoRoot,
      sessionId,
    });
    throw error;
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
}

export async function waitForSupervisedResult(context, session, options = {}) {
  const pollMs = Math.max(100, Number(options.pollMs || 500));

  while (true) {
    const result = readJsonIfExists(context.supervisorResultFile);
    if (result?.sessionId === session.sessionId) {
      return result;
    }

    const state = readSupervisorState(context);
    if (state?.sessionId === session.sessionId && FINAL_SUPERVISOR_STATUSES.has(String(state.status || ""))) {
      return {
        sessionId: session.sessionId,
        command: state.command || "",
        exitCode: Number(state.exitCode || 1),
        ok: state.status === "completed",
        error: state.message || readTextIfExists(context.supervisorStderrFile, "").trim() || "HelloLoop supervisor 异常结束。",
      };
    }

    if (!isTrackedPidAlive(session.pid)) {
      return {
        sessionId: session.sessionId,
        command: state?.command || "",
        exitCode: 1,
        ok: false,
        error: readTextIfExists(context.supervisorStderrFile, "").trim() || "HelloLoop supervisor 已退出，但未生成结果文件。",
      };
    }

    await new Promise((resolve) => {
      setTimeout(resolve, pollMs);
    });
  }
}

export async function runSupervisedCommandFromSessionFile(sessionFile) {
  const request = readJson(sessionFile);
  const context = createContext(request.context || {});
  const command = String(request.command || "").trim();
  const lease = request.lease || {};
  const guardianManaged = request.options?.guardianManaged === true
    || process.env.HELLOLOOP_SUPERVISOR_GUARDIAN_ACTIVE === "1";
  const guardianPid = guardianManaged
    ? Number(request.options?.guardianPid || process.env.HELLOLOOP_SUPERVISOR_GUARDIAN_PID || process.pid)
    : 0;
  const supervisorPid = guardianPid > 0 ? guardianPid : process.pid;

  if (!guardianManaged) {
    bindBackgroundTerminalSession(request.terminalSessionFile || "", {
      command,
      repoRoot: context.repoRoot,
      sessionId: request.sessionId,
    });
  }

  const commandOptions = {
    ...(request.options || {}),
    hostLease: lease,
  };
  writeActiveSupervisorState(context, {
    sessionId: request.sessionId,
    command,
    status: "running",
    lease,
    pid: supervisorPid,
    guardianPid,
    workerPid: guardianManaged ? process.pid : 0,
    startedAt: nowIso(),
  });
  refreshContinuation(context, request.sessionId);

  if (!guardianManaged) {
    registerActiveSession({
      sessionId: request.sessionId,
      repoRoot: context.repoRoot,
      configDirName: context.configDirName,
      command,
      pid: supervisorPid,
      guardianPid,
      lease,
      startedAt: nowIso(),
      supervisorStateFile: context.supervisorStateFile,
      supervisorResultFile: context.supervisorResultFile,
      statusFile: context.statusFile,
    });
  }

  try {
    if (!isHostLeaseAlive(lease)) {
      writeStoppedState(context, request, "检测到宿主窗口已关闭，HelloLoop supervisor 未继续执行。");
      refreshContinuation(context, request.sessionId);
      if (!guardianManaged) {
        unregisterActiveSession(request.sessionId);
      }
      return;
    }

    if (command === "run-loop") {
      const results = await runLoop(context, commandOptions);
      const exitCode = results.some((item) => !item.ok) ? 1 : 0;
      const payload = {
        sessionId: request.sessionId,
        command,
        ok: exitCode === 0,
        exitCode,
        results,
      };
      writeJson(context.supervisorResultFile, payload);
      writeSupervisorState(context, {
        sessionId: request.sessionId,
        command,
        status: payload.ok ? "completed" : (payload.results.some((item) => item.kind === "host-lease-stopped") ? "stopped" : "failed"),
        exitCode,
        message: payload.ok ? "" : (payload.results.find((item) => !item.ok)?.summary || ""),
        completedAt: nowIso(),
      });
      refreshContinuation(context, request.sessionId);
      if (!guardianManaged) {
        unregisterActiveSession(request.sessionId);
      }
      return;
    }

    if (command === "run-once") {
      const result = await runOnce(context, commandOptions);
      const payload = {
        sessionId: request.sessionId,
        command,
        ok: result.ok,
        exitCode: result.ok ? 0 : 1,
        result,
      };
      writeJson(context.supervisorResultFile, payload);
      writeSupervisorState(context, {
        sessionId: request.sessionId,
        command,
        status: payload.ok ? "completed" : (result.kind === "host-lease-stopped" ? "stopped" : "failed"),
        exitCode: payload.exitCode,
        message: result.summary || result.finalMessage || "",
        completedAt: nowIso(),
      });
      refreshContinuation(context, request.sessionId);
      if (!guardianManaged) {
        unregisterActiveSession(request.sessionId);
      }
      return;
    }

    throw new Error(`不支持的 supervisor 命令：${command}`);
  } catch (error) {
    const payload = {
      sessionId: request.sessionId,
      command,
      ok: false,
      exitCode: 1,
      error: String(error?.stack || error || ""),
    };
    writeJson(context.supervisorResultFile, payload);
    writeSupervisorState(context, {
      sessionId: request.sessionId,
      command,
      status: "failed",
      exitCode: 1,
      message: payload.error,
      completedAt: nowIso(),
    });
    refreshContinuation(context, request.sessionId);
    if (!guardianManaged) {
      unregisterActiveSession(request.sessionId);
    }
  }
}

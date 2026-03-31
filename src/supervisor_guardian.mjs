import path from "node:path";

import { nowIso, readJson, sleep, writeJson } from "./common.mjs";
import { createContext } from "./context.mjs";
import { refreshHostContinuationArtifacts } from "./host_continuation.mjs";
import { isHostLeaseAlive } from "./host_lease.mjs";
import { spawnNodeProcess } from "./node_process_launch.mjs";
import {
  FINAL_SUPERVISOR_STATUSES,
  readJsonIfExists,
  readSupervisorState,
  writeActiveSupervisorState,
  writeSupervisorState,
} from "./supervisor_state.mjs";
import { bindBackgroundTerminalSession } from "./terminal_session_limits.mjs";
import { loadRuntimeSettings } from "./runtime_settings_loader.mjs";
import { hasRetryBudget, pickRetryDelaySeconds } from "./runtime_settings.mjs";
import { registerActiveSession, unregisterActiveSession } from "./workspace_registry.mjs";

const GUARDIAN_ACTIVE_ENV = "HELLOLOOP_SUPERVISOR_GUARDIAN_ACTIVE";
const GUARDIAN_PID_ENV = "HELLOLOOP_SUPERVISOR_GUARDIAN_PID";

function refreshContinuation(context, sessionId) {
  try {
    refreshHostContinuationArtifacts(context, { sessionId });
  } catch {
    // ignore continuation snapshot refresh failures during guardian lifecycle
  }
}

function readFinalOutcome(context, sessionId) {
  const result = readJsonIfExists(context.supervisorResultFile);
  if (result?.sessionId === sessionId) {
    return {
      sessionId,
      ok: result.ok === true,
      exitCode: Number(result.exitCode ?? (result.ok === true ? 0 : 1)),
      result,
    };
  }

  const state = readSupervisorState(context);
  if (state?.sessionId === sessionId && FINAL_SUPERVISOR_STATUSES.has(String(state.status || ""))) {
    return {
      sessionId,
      ok: state.status === "completed",
      exitCode: Number(state.exitCode || (state.status === "completed" ? 0 : 1)),
      result: null,
    };
  }

  return null;
}

function writeLeaseStopped(context, request, message) {
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

function writeKeepAliveFailure(context, request, message, restartCount, keepAliveEnabled) {
  const payload = {
    sessionId: request.sessionId,
    command: request.command,
    ok: false,
    exitCode: 1,
    error: message,
  };
  writeJson(context.supervisorResultFile, payload);
  writeSupervisorState(context, {
    sessionId: request.sessionId,
    command: request.command,
    status: "failed",
    exitCode: 1,
    message,
    guardianPid: process.pid,
    workerPid: 0,
    guardianRestartCount: restartCount,
    keepAliveEnabled,
    completedAt: nowIso(),
  });
}

function buildWorkerArgs(context, sessionFile) {
  return [
    path.join(context.bundleRoot, "bin", "helloloop.js"),
    "__supervise-worker",
    "--session-file",
    sessionFile,
  ];
}

function waitForChildExit(child) {
  return new Promise((resolve, reject) => {
    let settled = false;
    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("exit", (exitCode, signal) => {
      if (!settled) {
        settled = true;
        resolve({
          exitCode: Number(exitCode ?? 0),
          signal: signal ? String(signal) : "",
        });
      }
    });
  });
}

function writeGuardianRunningState(context, request, keepAlive, restartCount, workerPid, message) {
  writeActiveSupervisorState(context, {
    sessionId: request.sessionId,
    command: request.command,
    status: "running",
    lease: request.lease || {},
    pid: process.pid,
    guardianPid: process.pid,
    workerPid,
    guardianRestartCount: restartCount,
    keepAliveEnabled: keepAlive.enabled,
    message,
  });
}

async function runWorkerUnderGuardian(context, request, sessionFile, keepAlive, restartCount) {
  writeGuardianRunningState(
    context,
    request,
    keepAlive,
    restartCount,
    0,
    restartCount > 0
      ? `后台守护进程正在执行第 ${restartCount} 次自动重拉起。`
      : "后台守护进程已接管，正在启动执行 worker。",
  );

  const child = spawnNodeProcess({
    args: buildWorkerArgs(context, sessionFile),
    cwd: context.repoRoot,
    detached: false,
    stdio: "inherit",
    env: {
      HELLOLOOP_SUPERVISOR_ACTIVE: "1",
      [GUARDIAN_ACTIVE_ENV]: "1",
      [GUARDIAN_PID_ENV]: String(process.pid),
    },
  });

  writeGuardianRunningState(
    context,
    request,
    keepAlive,
    restartCount,
    child.pid ?? 0,
    restartCount > 0
      ? `后台守护进程已完成第 ${restartCount} 次自动重拉起，worker 正在运行。`
      : "后台守护进程正在运行。",
  );

  return waitForChildExit(child);
}

export async function runSupervisorGuardianFromSessionFile(sessionFile) {
  const request = readJson(sessionFile);
  const context = createContext(request.context || {});
  const keepAlive = loadRuntimeSettings({
    globalConfigFile: request.options?.globalConfigFile,
  }).supervisorKeepAlive;

  bindBackgroundTerminalSession(request.terminalSessionFile || "", {
    command: request.command,
    repoRoot: context.repoRoot,
    sessionId: request.sessionId,
  });
  registerActiveSession({
    sessionId: request.sessionId,
    repoRoot: context.repoRoot,
    configDirName: context.configDirName,
    command: request.command,
    pid: process.pid,
    lease: request.lease || {},
    startedAt: nowIso(),
    supervisorStateFile: context.supervisorStateFile,
    supervisorResultFile: context.supervisorResultFile,
    statusFile: context.statusFile,
  });

  try {
    let restartCount = 0;
    refreshContinuation(context, request.sessionId);

    while (true) {
      const finalOutcome = readFinalOutcome(context, request.sessionId);
      if (finalOutcome) {
        unregisterActiveSession(request.sessionId);
        return;
      }

      if (!isHostLeaseAlive(request.lease || {})) {
        writeLeaseStopped(context, request, "检测到宿主窗口已关闭，HelloLoop 守护进程未继续执行。");
        refreshContinuation(context, request.sessionId);
        unregisterActiveSession(request.sessionId);
        return;
      }

      let workerExit;
      try {
        workerExit = await runWorkerUnderGuardian(context, request, sessionFile, keepAlive, restartCount);
      } catch (error) {
        workerExit = {
          exitCode: 1,
          signal: "",
          error: String(error?.stack || error || ""),
        };
      }

      const outcomeAfterExit = readFinalOutcome(context, request.sessionId);
      if (outcomeAfterExit) {
        unregisterActiveSession(request.sessionId);
        return;
      }

      if (!keepAlive.enabled) {
        writeKeepAliveFailure(
          context,
          request,
          "后台守护进程检测到 worker 异常退出，但当前设置已禁用自动保活重拉起。",
          restartCount,
          keepAlive.enabled,
        );
        refreshContinuation(context, request.sessionId);
        unregisterActiveSession(request.sessionId);
        return;
      }

      const nextRestartCount = restartCount + 1;
      if (!hasRetryBudget(keepAlive.maxRestartCount, nextRestartCount)) {
        writeKeepAliveFailure(
          context,
          request,
          `后台守护进程自动重拉起额度已耗尽（已尝试 ${restartCount} 次），worker 仍未恢复。`,
          restartCount,
          keepAlive.enabled,
        );
        refreshContinuation(context, request.sessionId);
        unregisterActiveSession(request.sessionId);
        return;
      }

      const delaySeconds = pickRetryDelaySeconds(keepAlive.restartDelaysSeconds, nextRestartCount);
      const exitSummary = workerExit.error
        ? `spawn 失败：${workerExit.error}`
        : `exit=${workerExit.exitCode}${workerExit.signal ? `, signal=${workerExit.signal}` : ""}`;

      writeSupervisorState(context, {
        sessionId: request.sessionId,
        command: request.command,
        status: "running",
        lease: request.lease || {},
        pid: process.pid,
        guardianPid: process.pid,
        workerPid: 0,
        guardianRestartCount: nextRestartCount,
        keepAliveEnabled: keepAlive.enabled,
        lastWorkerExitCode: Number(workerExit.exitCode ?? 1),
        lastWorkerSignal: workerExit.signal || "",
        lastWorkerExitedAt: nowIso(),
        message: `后台守护进程检测到 worker 异常退出（${exitSummary}），将在 ${delaySeconds} 秒后自动重拉起。`,
      });
      refreshContinuation(context, request.sessionId);

      if (delaySeconds > 0) {
        await sleep(delaySeconds * 1000);
      }

      restartCount = nextRestartCount;
    }
  } catch (error) {
    writeKeepAliveFailure(
      context,
      request,
      String(error?.stack || error || ""),
      0,
      keepAlive.enabled,
    );
    refreshContinuation(context, request.sessionId);
    unregisterActiveSession(request.sessionId);
  }
}

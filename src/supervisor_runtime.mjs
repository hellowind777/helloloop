import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { createContext } from "./context.mjs";
import { nowIso, readJson, writeJson, readTextIfExists, timestampForFile } from "./common.mjs";
import { isHostLeaseAlive, renderHostLeaseLabel, resolveHostLease } from "./host_lease.mjs";
import { runLoop, runOnce } from "./runner.mjs";
import {
  bindBackgroundTerminalSession,
  cancelPreparedTerminalSessionBackground,
  finalizePreparedTerminalSessionBackground,
  prepareCurrentTerminalSessionForBackground,
} from "./terminal_session_limits.mjs";

const ACTIVE_STATUSES = new Set(["launching", "running"]);
const FINAL_STATUSES = new Set(["completed", "failed", "stopped"]);

function removeIfExists(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // ignore cleanup failures
  }
}

function readJsonIfExists(filePath) {
  return fs.existsSync(filePath) ? readJson(filePath) : null;
}

function isPidAlive(pid) {
  const numberPid = Number(pid || 0);
  if (!Number.isFinite(numberPid) || numberPid <= 0) {
    return false;
  }
  try {
    process.kill(numberPid, 0);
    return true;
  } catch (error) {
    return String(error?.code || "") === "EPERM";
  }
}

function buildState(context, patch = {}) {
  const current = readJsonIfExists(context.supervisorStateFile) || {};
  return {
    ...current,
    ...patch,
    updatedAt: nowIso(),
  };
}

function writeState(context, patch) {
  writeJson(context.supervisorStateFile, buildState(context, patch));
}

function toSerializableOptions(options = {}) {
  return JSON.parse(JSON.stringify(options));
}

export function readSupervisorState(context) {
  return readJsonIfExists(context.supervisorStateFile);
}

export function hasActiveSupervisor(context) {
  const state = readSupervisorState(context);
  return Boolean(state?.status && ACTIVE_STATUSES.has(String(state.status)) && isPidAlive(state.pid));
}

export function renderSupervisorLaunchSummary(session) {
  return [
    `HelloLoop supervisor 已启动：${session.sessionId}`,
    `- 宿主租约：${renderHostLeaseLabel(session.lease)}`,
    "- 当前 turn 若被中断，只要当前宿主窗口仍存活，本轮自动执行会继续。",
    "- 如需主动停止，直接关闭当前 CLI 窗口即可。",
  ].join("\n");
}

export function launchSupervisedCommand(context, command, options = {}) {
  const existing = readSupervisorState(context);
  if (existing?.status && ACTIVE_STATUSES.has(String(existing.status)) && isPidAlive(existing.pid)) {
    throw new Error(`已有 HelloLoop supervisor 正在运行：${existing.sessionId || "unknown"}`);
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
  removeIfExists(context.supervisorResultFile);
  removeIfExists(context.supervisorStdoutFile);
  removeIfExists(context.supervisorStderrFile);
  writeJson(context.supervisorRequestFile, request);
  writeState(context, {
    sessionId,
    status: "launching",
    command,
    lease,
    startedAt: nowIso(),
    pid: 0,
  });

  const stdoutFd = fs.openSync(context.supervisorStdoutFile, "w");
  const stderrFd = fs.openSync(context.supervisorStderrFile, "w");
  try {
    const child = spawn(process.execPath, [
      path.join(context.bundleRoot, "bin", "helloloop.js"),
      "__supervise",
      "--session-file",
      context.supervisorRequestFile,
    ], {
      cwd: context.repoRoot,
      detached: true,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", stdoutFd, stderrFd],
      env: {
        ...process.env,
        HELLOLOOP_SUPERVISOR_ACTIVE: "1",
      },
    });
    finalizePreparedTerminalSessionBackground(child.pid ?? 0, {
      command,
      repoRoot: context.repoRoot,
      sessionId,
    });
    child.unref();
    writeState(context, {
      sessionId,
      status: "running",
      command,
      lease,
      startedAt: nowIso(),
      pid: child.pid ?? 0,
    });

    return {
      sessionId,
      pid: child.pid ?? 0,
      lease,
    };
  } catch (error) {
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
    if (state?.sessionId === session.sessionId && FINAL_STATUSES.has(String(state.status || ""))) {
      return {
        sessionId: session.sessionId,
        command: state.command || "",
        exitCode: Number(state.exitCode || 1),
        ok: state.status === "completed",
        error: state.message || readTextIfExists(context.supervisorStderrFile, "").trim() || "HelloLoop supervisor 异常结束。",
      };
    }

    if (!isPidAlive(session.pid)) {
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
  bindBackgroundTerminalSession(request.terminalSessionFile || "", {
    command,
    repoRoot: context.repoRoot,
    sessionId: request.sessionId,
  });
  const commandOptions = {
    ...(request.options || {}),
    hostLease: lease,
  };

  writeState(context, {
    sessionId: request.sessionId,
    command,
    status: "running",
    lease,
    pid: process.pid,
    startedAt: nowIso(),
  });

  try {
    if (!isHostLeaseAlive(lease)) {
      const stopped = {
        sessionId: request.sessionId,
        command,
        exitCode: 1,
        ok: false,
        stopped: true,
        error: "检测到宿主窗口已关闭，HelloLoop supervisor 未继续执行。",
      };
      writeJson(context.supervisorResultFile, stopped);
      writeState(context, {
        sessionId: request.sessionId,
        command,
        status: "stopped",
        exitCode: stopped.exitCode,
        message: stopped.error,
        completedAt: nowIso(),
      });
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
      writeState(context, {
        sessionId: request.sessionId,
        command,
        status: payload.ok ? "completed" : (payload.results.some((item) => item.kind === "host-lease-stopped") ? "stopped" : "failed"),
        exitCode,
        message: payload.ok ? "" : (payload.results.find((item) => !item.ok)?.summary || ""),
        completedAt: nowIso(),
      });
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
      writeState(context, {
        sessionId: request.sessionId,
        command,
        status: payload.ok ? "completed" : (result.kind === "host-lease-stopped" ? "stopped" : "failed"),
        exitCode: payload.exitCode,
        message: result.summary || result.finalMessage || "",
        completedAt: nowIso(),
      });
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
    writeState(context, {
      sessionId: request.sessionId,
      command,
      status: "failed",
      exitCode: 1,
      message: payload.error,
      completedAt: nowIso(),
    });
  }
}

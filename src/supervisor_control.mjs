import { selectLatestActivityFile, selectLatestRuntimeFile } from "./activity_projection.mjs";
import { fileExists, nowIso, readJson, timestampForFile, writeJson } from "./common.mjs";
import { writeStatus } from "./config.mjs";
import { terminateProcessTree } from "./process_tree.mjs";
import {
  clearSupervisorPause,
  readSupervisorPause,
  readSupervisorState,
  writeSupervisorPause,
  writeSupervisorState,
} from "./supervisor_state.mjs";
import { unregisterActiveSession } from "./workspace_registry.mjs";

function readJsonIfExists(filePath) {
  return filePath && fileExists(filePath) ? readJson(filePath) : null;
}

function normalizeCommand(command) {
  const value = String(command || "").trim();
  return value || "run-loop";
}

function resolvePauseSessionId(supervisorState, latestStatus) {
  return String(
    supervisorState?.sessionId
    || latestStatus?.sessionId
    || `paused-${timestampForFile()}`,
  ).trim();
}

function buildPauseMessage(options) {
  const value = String(options.message || "").trim();
  return value || "操作员已暂停主线；等待显式继续。";
}

function collectTrackedPids(supervisorState) {
  const values = [
    supervisorState?.workerPid,
    supervisorState?.guardianPid,
    supervisorState?.pid,
  ]
    .map((pid) => Number(pid || 0))
    .filter((pid) => Number.isFinite(pid) && pid > 0);
  return [...new Set(values)];
}

function resolveRuntimeArtifacts(latestStatus) {
  const runDir = String(latestStatus?.runDir || "").trim();
  if (!runDir) {
    return {
      runDir: "",
      runtimeFile: "",
      runtime: null,
      activityFile: "",
      activity: null,
    };
  }

  const runtimeFile = selectLatestRuntimeFile(runDir);
  const runtime = readJsonIfExists(runtimeFile);
  const activityFile = runtime?.activityFile && fileExists(runtime.activityFile)
    ? runtime.activityFile
    : selectLatestActivityFile(runDir, runtime?.attemptPrefix || "");

  return {
    runDir,
    runtimeFile,
    runtime,
    activityFile,
    activity: readJsonIfExists(activityFile),
  };
}

function markRuntimePaused(artifacts, message) {
  if (!artifacts.runtimeFile || !artifacts.runtime) {
    return;
  }

  writeJson(artifacts.runtimeFile, {
    ...artifacts.runtime,
    status: "paused_operator",
    failureCode: "operator_paused",
    failureFamily: "manual",
    failureReason: message,
    nextRetryAt: "",
    updatedAt: nowIso(),
  });
}

function markActivityPaused(artifacts, sessionId, message) {
  if (!artifacts.activityFile || !artifacts.activity) {
    return;
  }

  writeJson(artifacts.activityFile, {
    ...artifacts.activity,
    status: "paused_operator",
    current: {
      kind: "operator",
      status: "paused",
      label: message,
      itemId: sessionId,
    },
    runtime: {
      ...(artifacts.activity.runtime || {}),
      status: "paused_operator",
      failureCode: "operator_paused",
      failureFamily: "manual",
      failureReason: message,
      nextRetryAt: "",
    },
    updatedAt: nowIso(),
  });
}

function writePauseArtifacts(context, supervisorState, latestStatus, sessionId, message, runDir) {
  const command = normalizeCommand(supervisorState?.command || latestStatus?.command);
  writeSupervisorPause(context, {
    paused: true,
    reasonCode: "operator_paused",
    message,
    pausedAt: nowIso(),
    sessionId,
    command,
    runDir,
    taskId: latestStatus?.taskId || "",
    taskTitle: latestStatus?.taskTitle || "",
  });
  writeSupervisorState(context, {
    sessionId,
    command,
    status: "stopped",
    exitCode: 0,
    message,
    completedAt: nowIso(),
    pid: 0,
    guardianPid: 0,
    workerPid: 0,
    stoppedBy: "operator",
    pauseReasonCode: "operator_paused",
  });
  writeJson(context.supervisorResultFile, {
    sessionId,
    command,
    ok: false,
    paused: true,
    stopped: true,
    exitCode: 0,
    message,
  });
}

function writePausedStatus(context, latestStatus, sessionId, message, runDir) {
  writeStatus(context, {
    ...(latestStatus || {}),
    ok: latestStatus?.ok === true,
    sessionId,
    stage: "paused_operator",
    taskId: latestStatus?.taskId || null,
    taskTitle: latestStatus?.taskTitle || "",
    runDir,
    message,
  });
}

export async function pauseMainline(context, options = {}) {
  const supervisorState = readSupervisorState(context) || {};
  const latestStatus = readJsonIfExists(context.statusFile) || {};
  const existingPause = readSupervisorPause(context) || {};
  const sessionId = resolvePauseSessionId(supervisorState, latestStatus);
  const message = buildPauseMessage({
    ...options,
    message: options.message || existingPause.message,
  });
  const artifacts = resolveRuntimeArtifacts(latestStatus);

  const terminated = [];
  for (const pid of collectTrackedPids(supervisorState)) {
    terminated.push(await terminateProcessTree(pid));
  }

  markRuntimePaused(artifacts, message);
  markActivityPaused(artifacts, sessionId, message);
  writePauseArtifacts(context, supervisorState, latestStatus, sessionId, message, artifacts.runDir);
  writePausedStatus(context, latestStatus, sessionId, message, artifacts.runDir);
  unregisterActiveSession(String(supervisorState?.sessionId || sessionId));

  return {
    accepted: true,
    sessionId,
    command: "pause-mainline",
    message,
    paused: true,
    terminated,
  };
}

export function clearPausedMainline(context) {
  clearSupervisorPause(context);
}

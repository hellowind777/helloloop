import { nowIso, readJson, writeJson } from "./common.mjs";

export const ACTIVE_SUPERVISOR_STATUSES = new Set(["launching", "running"]);
export const FINAL_SUPERVISOR_STATUSES = new Set(["completed", "failed", "stopped"]);

export function readJsonIfExists(filePath) {
  try {
    return filePath ? readJson(filePath) : null;
  } catch {
    return null;
  }
}

export function isTrackedPidAlive(pid) {
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

function buildSupervisorState(context, patch = {}) {
  const current = readSupervisorState(context) || {};
  return {
    ...current,
    ...patch,
    updatedAt: nowIso(),
  };
}

export function readSupervisorState(context) {
  return readJsonIfExists(context.supervisorStateFile);
}

export function hasActiveSupervisor(context) {
  const state = readSupervisorState(context);
  const activePid = Number(state?.guardianPid || state?.pid || 0);
  return Boolean(
    state?.status
    && ACTIVE_SUPERVISOR_STATUSES.has(String(state.status))
    && isTrackedPidAlive(activePid),
  );
}

export function writeSupervisorState(context, patch) {
  writeJson(context.supervisorStateFile, buildSupervisorState(context, patch));
}

export function writeActiveSupervisorState(context, patch = {}) {
  const nextPatch = {
    ...patch,
    exitCode: null,
    completedAt: "",
  };
  if (!Object.hasOwn(nextPatch, "message")) {
    nextPatch.message = "";
  }
  writeSupervisorState(context, nextPatch);
}

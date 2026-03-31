import fs from "node:fs";
import path from "node:path";

import { ensureDir, fileExists, nowIso, readJson, timestampForFile, writeJson } from "./common.mjs";
import { loadGlobalConfig } from "./global_config.mjs";
import { normalizeTerminalConcurrencySettings } from "./runtime_settings.mjs";

const SESSION_DIR_NAME = "terminal-sessions";
const RUNTIME_DIR_NAME = "runtime";
const LOCK_FILE_NAME = ".lock";
const LOCK_RETRY_DELAYS_MS = [0, 20, 50, 100, 200, 300, 500];
const STALE_PREPARED_SESSION_MS = 60_000;
const TRACKED_VISIBLE_COMMANDS = new Set(["analyze", "next", "run-loop", "run-once"]);

let currentTerminalSession = null;
let cleanupRegistered = false;

function sleepSync(ms) {
  const shared = new SharedArrayBuffer(4);
  const view = new Int32Array(shared);
  Atomics.wait(view, 0, 0, Math.max(0, ms));
}

function isPidAlive(pid) {
  const value = Number(pid || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return false;
  }
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return String(error?.code || "") === "EPERM";
  }
}

function resolveTerminalRuntimeConfig(options = {}) {
  const globalConfig = loadGlobalConfig({
    globalConfigFile: options.globalConfigFile,
  });
  const settingsFile = globalConfig?._meta?.configFile || "";
  const settingsHome = settingsFile ? path.dirname(settingsFile) : process.cwd();
  return {
    settingsFile,
    registryRoot: path.join(settingsHome, RUNTIME_DIR_NAME, SESSION_DIR_NAME),
    limits: normalizeTerminalConcurrencySettings(globalConfig?.runtime?.terminalConcurrency || {}),
  };
}

function withRegistryLock(registryRoot, callback) {
  ensureDir(registryRoot);
  const lockFile = path.join(registryRoot, LOCK_FILE_NAME);
  let lastError = null;

  for (const delayMs of LOCK_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      sleepSync(delayMs);
    }
    let lockFd = null;
    try {
      lockFd = fs.openSync(lockFile, "wx");
      const result = callback();
      fs.closeSync(lockFd);
      fs.rmSync(lockFile, { force: true });
      return result;
    } catch (error) {
      lastError = error;
      if (lockFd !== null) {
        try {
          fs.closeSync(lockFd);
        } catch {
          // ignore lock close failure
        }
        fs.rmSync(lockFile, { force: true });
        throw error;
      }
      if (String(error?.code || "").toUpperCase() !== "EEXIST") {
        throw error;
      }
    }
  }

  throw lastError || new Error(`无法获取 HelloLoop 终端会话锁：${registryRoot}`);
}

function listSessionFiles(registryRoot) {
  if (!fileExists(registryRoot)) {
    return [];
  }
  return fs.readdirSync(registryRoot)
    .filter((item) => item.endsWith(".json"))
    .map((item) => path.join(registryRoot, item));
}

function readSessionRecord(sessionFile) {
  try {
    return readJson(sessionFile);
  } catch {
    return null;
  }
}

function isPreparedSessionExpired(record) {
  const updatedAt = Date.parse(String(record?.updatedAt || record?.createdAt || ""));
  if (!Number.isFinite(updatedAt)) {
    return true;
  }
  return Date.now() - updatedAt > STALE_PREPARED_SESSION_MS;
}

function isStaleSession(record) {
  const kind = String(record?.kind || "");
  if (!["visible", "background"].includes(kind)) {
    return true;
  }
  if (Number(record?.pid || 0) > 0) {
    return !isPidAlive(record.pid);
  }
  if (Number(record?.ownerPid || 0) > 0 && !isPidAlive(record.ownerPid)) {
    return true;
  }
  return isPreparedSessionExpired(record);
}

function cleanupStaleSessions(registryRoot) {
  const activeSessions = [];
  for (const sessionFile of listSessionFiles(registryRoot)) {
    const record = readSessionRecord(sessionFile);
    if (!record || isStaleSession(record)) {
      fs.rmSync(sessionFile, { force: true });
      continue;
    }
    activeSessions.push({
      ...record,
      file: sessionFile,
    });
  }
  return activeSessions;
}

function countSessions(sessions, excludingId = "") {
  return sessions
    .filter((session) => session.id !== excludingId)
    .reduce((counts, session) => {
      if (session.kind === "visible") {
        counts.visible += 1;
      }
      if (session.kind === "background") {
        counts.background += 1;
      }
      counts.total += 1;
      return counts;
    }, { visible: 0, background: 0, total: 0 });
}

function throwSessionLimitError(kind, counts, limits, settingsFile, reason) {
  const kindLabel = kind === "background" ? "背景终端" : "显示终端";
  const scope = [
    `显示终端 ${counts.visible}/${limits.visibleMax}`,
    `背景终端 ${counts.background}/${limits.backgroundMax}`,
    `总并发 ${counts.total}/${limits.totalMax}`,
  ].join("，");
  throw new Error(
    `${kindLabel}${reason}，当前 ${scope}。`
    + ` 如需调整，请修改 ${settingsFile} 中的 runtime.terminalConcurrency.visibleMax / backgroundMax / totalMax。`,
  );
}

function assertSessionLimit(kind, sessions, limits, settingsFile, excludingId = "") {
  if (!limits.enabled) {
    return;
  }

  const counts = countSessions(sessions, excludingId);
  const nextCounts = {
    visible: counts.visible + (kind === "visible" ? 1 : 0),
    background: counts.background + (kind === "background" ? 1 : 0),
    total: counts.total + 1,
  };

  if (kind === "visible" && nextCounts.visible > limits.visibleMax) {
    throwSessionLimitError(kind, nextCounts, limits, settingsFile, "并发已达上限");
  }
  if (kind === "background" && nextCounts.background > limits.backgroundMax) {
    throwSessionLimitError(kind, nextCounts, limits, settingsFile, "并发已达上限");
  }
  if (nextCounts.total > limits.totalMax) {
    throwSessionLimitError(kind, nextCounts, limits, settingsFile, "启动被阻止：显示终端与背景终端合计并发已达上限");
  }
}

function buildSessionRecord(kind, options = {}) {
  return {
    id: options.id || `${timestampForFile()}-${kind}-${process.pid}`,
    kind,
    pid: Number(options.pid || process.pid),
    ownerPid: Number(options.ownerPid || process.pid),
    command: String(options.command || "").trim(),
    sessionId: String(options.sessionId || "").trim(),
    repoRoot: String(options.repoRoot || "").trim(),
    createdAt: options.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
}

function writeSessionRecord(sessionFile, record) {
  writeJson(sessionFile, record);
  return {
    ...record,
    file: sessionFile,
  };
}

function ensureCleanupRegistration() {
  if (cleanupRegistered) {
    return;
  }
  cleanupRegistered = true;
  process.on("exit", () => {
    try {
      releaseCurrentTerminalSession();
    } catch {
      // ignore exit cleanup failure
    }
  });
}

function setCurrentTerminalSession(record) {
  if (!record) {
    return null;
  }
  currentTerminalSession = {
    ...record,
    preparedForBackground: false,
    handedOff: false,
  };
  ensureCleanupRegistration();
  return currentTerminalSession;
}

export function shouldTrackVisibleTerminalCommand(command) {
  return TRACKED_VISIBLE_COMMANDS.has(String(command || "").trim());
}

export function acquireVisibleTerminalSession(options = {}) {
  if (currentTerminalSession) {
    return currentTerminalSession;
  }

  const runtime = resolveTerminalRuntimeConfig(options);
  if (!runtime.limits.enabled) {
    return null;
  }

  return withRegistryLock(runtime.registryRoot, () => {
    const sessions = cleanupStaleSessions(runtime.registryRoot);
    assertSessionLimit("visible", sessions, runtime.limits, runtime.settingsFile);
    const record = buildSessionRecord("visible", options);
    const sessionFile = path.join(runtime.registryRoot, `${record.id}.json`);
    return setCurrentTerminalSession(writeSessionRecord(sessionFile, record));
  });
}

export function prepareCurrentTerminalSessionForBackground(options = {}) {
  const runtime = resolveTerminalRuntimeConfig(options);
  if (!runtime.limits.enabled) {
    return null;
  }

  return withRegistryLock(runtime.registryRoot, () => {
    const sessions = cleanupStaleSessions(runtime.registryRoot);

    if (!currentTerminalSession) {
      assertSessionLimit("background", sessions, runtime.limits, runtime.settingsFile);
      const record = buildSessionRecord("background", {
        ...options,
        pid: 0,
      });
      const sessionFile = path.join(runtime.registryRoot, `${record.id}.json`);
      const next = writeSessionRecord(sessionFile, record);
      currentTerminalSession = {
        ...next,
        preparedForBackground: true,
        handedOff: false,
      };
      ensureCleanupRegistration();
      return currentTerminalSession;
    }

    assertSessionLimit("background", sessions, runtime.limits, runtime.settingsFile, currentTerminalSession.id);
    const record = buildSessionRecord("background", {
      ...currentTerminalSession,
      ...options,
      pid: 0,
      ownerPid: process.pid,
    });
    const next = writeSessionRecord(currentTerminalSession.file, record);
    currentTerminalSession = {
      ...next,
      preparedForBackground: true,
      handedOff: false,
    };
    return currentTerminalSession;
  });
}

export function finalizePreparedTerminalSessionBackground(pid, options = {}) {
  if (!currentTerminalSession?.file) {
    return null;
  }

  const runtime = resolveTerminalRuntimeConfig(options);
  return withRegistryLock(runtime.registryRoot, () => {
    const record = buildSessionRecord("background", {
      ...currentTerminalSession,
      ...options,
      pid,
      ownerPid: pid,
      createdAt: currentTerminalSession.createdAt,
    });
    const next = writeSessionRecord(currentTerminalSession.file, record);
    currentTerminalSession = {
      ...next,
      preparedForBackground: false,
      handedOff: true,
    };
    return currentTerminalSession;
  });
}

export function cancelPreparedTerminalSessionBackground(options = {}) {
  if (!currentTerminalSession?.file || !currentTerminalSession.preparedForBackground) {
    return false;
  }

  const runtime = resolveTerminalRuntimeConfig(options);
  return withRegistryLock(runtime.registryRoot, () => {
    fs.rmSync(currentTerminalSession.file, { force: true });
    currentTerminalSession = null;
    return true;
  });
}

export function bindBackgroundTerminalSession(sessionFile, options = {}) {
  if (!sessionFile) {
    return null;
  }

  const registryRoot = path.dirname(sessionFile);
  return withRegistryLock(registryRoot, () => {
    const existing = fileExists(sessionFile) ? readSessionRecord(sessionFile) : null;
    const record = buildSessionRecord("background", {
      ...existing,
      ...options,
      pid: process.pid,
      ownerPid: process.pid,
    });
    return setCurrentTerminalSession(writeSessionRecord(sessionFile, record));
  });
}

export function releaseCurrentTerminalSession() {
  if (!currentTerminalSession?.file || currentTerminalSession.handedOff) {
    return false;
  }

  const sessionFile = currentTerminalSession.file;
  const registryRoot = path.dirname(sessionFile);
  withRegistryLock(registryRoot, () => {
    fs.rmSync(sessionFile, { force: true });
  });
  currentTerminalSession = null;
  return true;
}

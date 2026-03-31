import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureDir, nowIso, readJson, writeJson } from "./common.mjs";

const FINAL_SUPERVISOR_STATUSES = new Set(["completed", "failed", "stopped"]);

function activeSessionsRoot() {
  return path.join(os.homedir(), ".helloloop", "runtime", "active-sessions");
}

function knownWorkspacesRoot() {
  return path.join(os.homedir(), ".helloloop", "runtime", "known-workspaces");
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  try {
    return readJson(filePath);
  } catch {
    return null;
  }
}

function registryFileFor(sessionId) {
  const safeId = String(sessionId || "session")
    .trim()
    .replace(/[^\w.-]+/gu, "_");
  return path.join(activeSessionsRoot(), `${safeId}.json`);
}

function workspaceFileFor(repoRoot, configDirName = "") {
  const key = `${String(repoRoot || "").trim()}|${String(configDirName || "").trim()}`;
  const safeId = Buffer.from(key).toString("base64url");
  return path.join(knownWorkspacesRoot(), `${safeId}.json`);
}

function isPidAlive(pid) {
  const numericPid = Number(pid || 0);
  if (!Number.isFinite(numericPid) || numericPid <= 0) {
    return false;
  }
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (error) {
    return String(error?.code || "") === "EPERM";
  }
}

function isStaleEntry(entry) {
  if (!entry?.sessionId) {
    return true;
  }
  const supervisor = readJsonIfExists(entry.supervisorStateFile);
  if (!supervisor) {
    return !isPidAlive(entry.pid);
  }
  if (supervisor.sessionId && supervisor.sessionId !== entry.sessionId) {
    return true;
  }
  if (FINAL_SUPERVISOR_STATUSES.has(String(supervisor.status || "").trim())) {
    return true;
  }
  return !isPidAlive(supervisor.pid || entry.pid);
}

export function registerActiveSession(entry = {}) {
  ensureDir(activeSessionsRoot());
  const filePath = registryFileFor(entry.sessionId);
  const current = readJsonIfExists(filePath) || {};
  writeJson(filePath, {
    schemaVersion: 1,
    ...current,
    ...entry,
    updatedAt: nowIso(),
  });
  registerKnownWorkspace(entry);
  return filePath;
}

export function unregisterActiveSession(sessionId) {
  const filePath = registryFileFor(sessionId);
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // ignore cleanup failures
  }
}

export function listActiveSessionEntries() {
  ensureDir(activeSessionsRoot());
  const entries = [];

  for (const item of fs.readdirSync(activeSessionsRoot(), { withFileTypes: true })) {
    if (!item.isFile() || !item.name.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(activeSessionsRoot(), item.name);
    const entry = readJsonIfExists(filePath);
    if (!entry) {
      continue;
    }
    if (isStaleEntry(entry)) {
      unregisterActiveSession(entry.sessionId);
      continue;
    }
    entries.push(entry);
  }

  return entries.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
}

export function registerKnownWorkspace(entry = {}) {
  const repoRoot = String(entry.repoRoot || "").trim();
  if (!repoRoot) {
    return "";
  }
  ensureDir(knownWorkspacesRoot());
  const filePath = workspaceFileFor(repoRoot, entry.configDirName);
  const current = readJsonIfExists(filePath) || {};
  writeJson(filePath, {
    schemaVersion: 1,
    ...current,
    repoRoot,
    configDirName: String(entry.configDirName || "").trim(),
    sessionId: String(entry.sessionId || current.sessionId || "").trim(),
    command: String(entry.command || current.command || "").trim(),
    lease: entry.lease || current.lease || null,
    updatedAt: nowIso(),
  });
  return filePath;
}

export function listKnownWorkspaceEntries() {
  ensureDir(knownWorkspacesRoot());
  const entries = [];

  for (const item of fs.readdirSync(knownWorkspacesRoot(), { withFileTypes: true })) {
    if (!item.isFile() || !item.name.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(knownWorkspacesRoot(), item.name);
    const entry = readJsonIfExists(filePath);
    if (!entry?.repoRoot) {
      continue;
    }
    entries.push(entry);
  }

  return entries.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
}

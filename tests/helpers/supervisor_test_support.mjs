import fs from "node:fs";
import path from "node:path";

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function isPidAlive(pid) {
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

export async function waitFor(check, timeoutMs = 20000, intervalMs = 100) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await check();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error(`waitFor timeout after ${timeoutMs}ms`);
}

function resolveWaitOptions(options = {}) {
  if (typeof options === "number") {
    return {
      timeoutMs: options,
      intervalMs: 100,
    };
  }

  return {
    timeoutMs: Number(options.timeoutMs || 20000),
    intervalMs: Number(options.intervalMs || 100),
  };
}

export async function waitForTaskStatus(repoRoot, status, taskIndex = 0, configDirName = ".helloloop", waitOptions = {}) {
  const backlogFile = path.join(repoRoot, configDirName, "backlog.json");
  const { timeoutMs, intervalMs } = resolveWaitOptions(waitOptions);
  return waitFor(() => {
    const backlog = readJson(backlogFile);
    return backlog.tasks?.[taskIndex]?.status === status ? backlog : false;
  }, timeoutMs, intervalMs);
}

export async function waitForBacklogTaskCount(repoRoot, count, configDirName = ".helloloop", waitOptions = {}) {
  const backlogFile = path.join(repoRoot, configDirName, "backlog.json");
  const { timeoutMs, intervalMs } = resolveWaitOptions(waitOptions);
  return waitFor(() => {
    const backlog = readJson(backlogFile);
    return Array.isArray(backlog.tasks) && backlog.tasks.length === count ? backlog : false;
  }, timeoutMs, intervalMs);
}

export async function waitForSupervisorCompletion(repoRoot, configDirName = ".helloloop", waitOptions = {}) {
  const stateFile = path.join(repoRoot, configDirName, "supervisor", "state.json");
  const { timeoutMs, intervalMs } = resolveWaitOptions(waitOptions);
  return waitFor(() => {
    const state = readJson(stateFile);
    return ["completed", "failed", "stopped"].includes(String(state.status || "")) ? state : false;
  }, timeoutMs, intervalMs);
}

export async function cleanupTempDir(tempRoot, supervisorStateFile = "") {
  if (supervisorStateFile && fs.existsSync(supervisorStateFile)) {
    const state = readJson(supervisorStateFile);
    if (isPidAlive(state.pid)) {
      try {
        process.kill(state.pid);
      } catch {
        // ignore cleanup race
      }
    }
  }

  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => {
        setTimeout(resolve, 250);
      });
    }
  }

  if (lastError) {
    throw lastError;
  }
}

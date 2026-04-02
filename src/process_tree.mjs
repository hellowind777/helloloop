import { spawn } from "node:child_process";

import { sleep } from "./common.mjs";

function normalizePid(pid) {
  const value = Number(pid || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function isPidAlive(pid) {
  const value = normalizePid(pid);
  if (!value) {
    return false;
  }
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return String(error?.code || "") === "EPERM";
  }
}

function spawnUtility(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({
        code: Number(code ?? 0),
        stdout: String(stdout || "").trim(),
        stderr: String(stderr || "").trim(),
      });
    });
  });
}

function isMissingProcessMessage(result) {
  const summary = [result?.stdout, result?.stderr]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return [
    "not found",
    "no running instance",
    "not running",
    "cannot find",
    "there is no running instance",
    "esrch",
  ].some((signal) => summary.includes(signal));
}

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + Math.max(100, Number(timeoutMs || 1000));
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return true;
    }
    await sleep(100);
  }
  return !isPidAlive(pid);
}

async function terminateWindowsProcessTree(pid) {
  const result = await spawnUtility("taskkill", ["/PID", String(pid), "/T", "/F"]);
  if (result.code !== 0 && !isMissingProcessMessage(result)) {
    throw new Error(result.stderr || result.stdout || `taskkill exited with code ${result.code}`);
  }
  return {
    pid,
    existed: result.code === 0 || !isMissingProcessMessage(result),
    terminated: result.code === 0 || !isPidAlive(pid),
    method: "taskkill",
  };
}

async function terminatePosixProcessTree(pid, graceMs) {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (String(error?.code || "") === "ESRCH") {
      return {
        pid,
        existed: false,
        terminated: true,
        method: "sigterm",
      };
    }
    throw error;
  }

  if (await waitForExit(pid, graceMs)) {
    return {
      pid,
      existed: true,
      terminated: true,
      method: "sigterm",
    };
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (String(error?.code || "") !== "ESRCH") {
      throw error;
    }
  }

  return {
    pid,
    existed: true,
    terminated: await waitForExit(pid, Math.max(250, Math.floor(graceMs / 2))),
    method: "sigkill",
  };
}

export async function terminateProcessTree(pid, options = {}) {
  const value = normalizePid(pid);
  if (!value) {
    return {
      pid: value,
      existed: false,
      terminated: true,
      method: "none",
    };
  }
  if (!isPidAlive(value)) {
    return {
      pid: value,
      existed: false,
      terminated: true,
      method: "none",
    };
  }

  const graceMs = Math.max(250, Number(options.graceMs || 1500));
  if (process.platform === "win32") {
    return terminateWindowsProcessTree(value);
  }
  return terminatePosixProcessTree(value, graceMs);
}

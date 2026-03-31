import path from "node:path";
import { execFileSync } from "node:child_process";

import { getHostDisplayName, normalizeHostContext } from "./engine_metadata.mjs";

const HOST_PROCESS_NAMES = Object.freeze({
  codex: ["codex", "codex.exe"],
  claude: ["claude", "claude.exe"],
  gemini: ["gemini", "gemini.exe"],
});

const SHELL_PROCESS_NAMES = new Set([
  "bash",
  "cmd",
  "cmd.exe",
  "fish",
  "nu",
  "nu.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "sh",
  "tmux",
  "tmux.exe",
  "zsh",
]);

function normalizeProcessName(value) {
  const raw = path.basename(String(value || "").trim()).toLowerCase();
  return raw;
}

function parseUnixProcessTable(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) {
        return null;
      }
      return {
        pid: Number(match[1]),
        parentPid: Number(match[2]),
        name: normalizeProcessName(match[3]),
      };
    })
    .filter(Boolean);
}

function loadProcessTable() {
  if (process.platform === "win32") {
    const command = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress";
    const text = execFileSync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-Command",
      command,
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
    const payload = JSON.parse(text || "[]");
    const rows = Array.isArray(payload) ? payload : [payload];
    return rows.map((item) => ({
      pid: Number(item?.ProcessId || 0),
      parentPid: Number(item?.ParentProcessId || 0),
      name: normalizeProcessName(item?.Name || ""),
    })).filter((item) => item.pid > 0);
  }

  const text = execFileSync("ps", [
    "-eo",
    "pid=,ppid=,comm=",
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return parseUnixProcessTable(text);
}

function buildAncestry(currentPid = process.pid) {
  const rows = loadProcessTable();
  const byPid = new Map(rows.map((item) => [item.pid, item]));
  const ancestry = [];
  const seen = new Set();
  let cursor = byPid.get(Number(currentPid)) || {
    pid: Number(currentPid),
    parentPid: Number(process.ppid || 0),
    name: normalizeProcessName(process.argv[0] || "node"),
  };

  while (cursor && cursor.pid > 0 && !seen.has(cursor.pid)) {
    ancestry.push(cursor);
    seen.add(cursor.pid);
    cursor = byPid.get(cursor.parentPid);
  }

  return ancestry;
}

function matchesHostContext(name, hostContext) {
  return (HOST_PROCESS_NAMES[hostContext] || []).includes(name);
}

function pickLeaseCandidate(ancestry, hostContext) {
  const parents = ancestry.slice(1);
  if (!parents.length) {
    return null;
  }

  if (hostContext !== "terminal") {
    const matchedHost = parents.find((item) => matchesHostContext(item.name, hostContext));
    if (matchedHost) {
      return { ...matchedHost, kind: "host" };
    }
  }

  const anyKnownHost = parents.find((item) => (
    matchesHostContext(item.name, "codex")
    || matchesHostContext(item.name, "claude")
    || matchesHostContext(item.name, "gemini")
  ));
  if (anyKnownHost) {
    return { ...anyKnownHost, kind: "host" };
  }

  const shell = parents.find((item) => SHELL_PROCESS_NAMES.has(item.name));
  if (shell) {
    return { ...shell, kind: "shell" };
  }

  return {
    ...parents[0],
    kind: "parent",
  };
}

export function resolveHostLease({ hostContext, env = process.env, currentPid = process.pid } = {}) {
  const normalizedHostContext = normalizeHostContext(hostContext);
  const overridePid = Number(env.HELLOLOOP_HOST_LEASE_PID || 0);
  if (Number.isFinite(overridePid) && overridePid > 0) {
    return {
      pid: overridePid,
      name: normalizeProcessName(env.HELLOLOOP_HOST_LEASE_NAME || normalizedHostContext || "host"),
      kind: "override",
      hostContext: normalizedHostContext,
      hostDisplayName: getHostDisplayName(normalizedHostContext),
    };
  }

  try {
    const candidate = pickLeaseCandidate(buildAncestry(currentPid), normalizedHostContext);
    if (candidate?.pid > 0) {
      return {
        pid: candidate.pid,
        name: candidate.name,
        kind: candidate.kind,
        hostContext: normalizedHostContext,
        hostDisplayName: getHostDisplayName(normalizedHostContext),
      };
    }
  } catch {
    // ignore host lease discovery failures and fall back to immediate parent
  }

  return {
    pid: Number(process.ppid || 0),
    name: "",
    kind: "fallback_parent",
    hostContext: normalizedHostContext,
    hostDisplayName: getHostDisplayName(normalizedHostContext),
  };
}

export function isHostLeaseAlive(lease = {}) {
  const pid = Number(lease?.pid || 0);
  if (!Number.isFinite(pid) || pid <= 0) {
    return true;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return String(error?.code || "") === "EPERM";
  }
}

export function renderHostLeaseLabel(lease = {}) {
  const pid = Number(lease?.pid || 0);
  const name = String(lease?.name || "").trim();
  const displayName = String(lease?.hostDisplayName || getHostDisplayName(lease?.hostContext)).trim() || "当前宿主";
  if (pid > 0 && name) {
    return `${displayName}（${name} / pid=${pid}）`;
  }
  if (pid > 0) {
    return `${displayName}（pid=${pid}）`;
  }
  return `${displayName}（未检测到稳定宿主进程）`;
}

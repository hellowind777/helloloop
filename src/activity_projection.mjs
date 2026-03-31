import fs from "node:fs";
import path from "node:path";

import { appendText, fileExists, nowIso, readJson, writeJson } from "./common.mjs";
import { parseCodexJsonlEventLine } from "./engine_event_parser_codex.mjs";

const RECENT_EVENTS_LIMIT = 24;
const RECENT_REASONING_LIMIT = 8;
const RECENT_COMMANDS_LIMIT = 10;
const RECENT_FILE_CHANGES_LIMIT = 10;

function limitList(list, maxLength) {
  if (list.length > maxLength) {
    list.splice(0, list.length - maxLength);
  }
}

function readDirEntriesSafe(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function collectArtifactCandidates(runDir, suffix) {
  if (!runDir || !fileExists(runDir)) {
    return [];
  }

  const candidates = [];
  for (const entry of readDirEntriesSafe(runDir)) {
    const fullPath = path.join(runDir, entry.name);
    if (entry.isFile() && entry.name.endsWith(suffix)) {
      candidates.push(fullPath);
      continue;
    }
    if (!entry.isDirectory()) {
      continue;
    }
    for (const nestedEntry of readDirEntriesSafe(fullPath)) {
      if (nestedEntry.isFile() && nestedEntry.name.endsWith(suffix)) {
        candidates.push(path.join(fullPath, nestedEntry.name));
      }
    }
  }

  return candidates.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
}

function relativeToRepo(repoRoot, targetPath) {
  const normalized = String(targetPath || "").trim();
  if (!normalized) {
    return "";
  }
  return path.isAbsolute(normalized)
    ? path.relative(repoRoot, normalized).replaceAll("\\", "/")
    : normalized.replaceAll("\\", "/");
}

function compactEvent(event, repoRoot) {
  return {
    kind: event.kind,
    itemId: event.itemId || "",
    status: event.status || "",
    label: event.label || "",
    exitCode: event.exitCode ?? null,
    summary: event.summary || event.outputSummary || "",
    changes: Array.isArray(event.changes)
      ? event.changes.map((change) => ({
        path: relativeToRepo(repoRoot, change.path),
        kind: change.kind,
      }))
      : [],
    updatedAt: nowIso(),
  };
}

function createBaseSnapshot(options) {
  return {
    schemaVersion: 1,
    engine: options.engine || "",
    phase: options.phase || "",
    repoRoot: options.repoRoot || "",
    runDir: options.runDir || "",
    outputPrefix: options.outputPrefix || "",
    attemptPrefix: options.attemptPrefix || "",
    activityFile: options.activityFile || "",
    activityEventsFile: options.activityEventsFile || "",
    status: "running",
    threadId: "",
    current: {
      kind: "",
      status: "",
      label: "",
      itemId: "",
    },
    todo: {
      total: 0,
      completed: 0,
      pending: 0,
      items: [],
    },
    activeCommands: [],
    recentCommands: [],
    recentReasoning: [],
    recentFileChanges: [],
    recentEvents: [],
    runtime: {},
    finalMessage: "",
    code: null,
    startedAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function resolveParser(engine) {
  return engine === "codex" ? parseCodexJsonlEventLine : null;
}

export function readJsonIfExists(filePath) {
  if (!filePath || !fileExists(filePath)) {
    return null;
  }
  try {
    return readJson(filePath);
  } catch {
    return null;
  }
}

export function selectLatestRuntimeFile(runDir) {
  return collectArtifactCandidates(runDir, "-runtime.json")[0] || "";
}

export function selectLatestActivityFile(runDir, attemptPrefix = "") {
  if (attemptPrefix) {
    const namedCandidates = collectArtifactCandidates(runDir, `${attemptPrefix}-activity.json`);
    if (namedCandidates[0]) {
      return namedCandidates[0];
    }
  }
  return collectArtifactCandidates(runDir, "-activity.json")[0] || "";
}

export function createActivityProjector(options = {}) {
  const parser = resolveParser(options.engine);
  const activityFile = options.activityFile || path.join(options.runDir, `${options.attemptPrefix}-activity.json`);
  const activityEventsFile = options.activityEventsFile || path.join(options.runDir, `${options.attemptPrefix}-activity.jsonl`);
  const snapshot = createBaseSnapshot({
    ...options,
    activityFile,
    activityEventsFile,
  });
  const activeCommands = new Map();
  let stdoutBuffer = "";

  const persistSnapshot = () => {
    snapshot.updatedAt = nowIso();
    snapshot.activeCommands = [...activeCommands.values()];
    writeJson(activityFile, snapshot);
  };

  const appendActivityEvent = (event) => {
    const compact = compactEvent(event, snapshot.repoRoot);
    snapshot.current = {
      kind: compact.kind,
      status: compact.status,
      label: compact.label,
      itemId: compact.itemId,
    };
    snapshot.recentEvents.push(compact);
    limitList(snapshot.recentEvents, RECENT_EVENTS_LIMIT);

    if (compact.kind === "thread" && event.threadId) {
      snapshot.threadId = event.threadId;
    }

    if (compact.kind === "todo" && event.todo) {
      snapshot.todo = {
        ...event.todo,
        items: Array.isArray(event.todo.items) ? event.todo.items : [],
      };
    }

    if (compact.kind === "reasoning" && compact.label) {
      snapshot.recentReasoning.push({
        label: compact.label,
        status: compact.status,
        updatedAt: compact.updatedAt,
      });
      limitList(snapshot.recentReasoning, RECENT_REASONING_LIMIT);
    }

    if (compact.kind === "command") {
      const previous = activeCommands.get(compact.itemId) || {};
      const next = {
        id: compact.itemId,
        label: compact.label,
        status: compact.status,
        exitCode: compact.exitCode,
        summary: compact.summary,
        startedAt: previous.startedAt || compact.updatedAt,
        updatedAt: compact.updatedAt,
      };
      if (compact.status === "in_progress") {
        activeCommands.set(compact.itemId, next);
      } else {
        activeCommands.delete(compact.itemId);
        snapshot.recentCommands.push({
          ...previous,
          ...next,
          completedAt: compact.updatedAt,
        });
        limitList(snapshot.recentCommands, RECENT_COMMANDS_LIMIT);
      }
    }

    if (compact.kind === "file_change") {
      snapshot.recentFileChanges.push({
        label: compact.label,
        status: compact.status,
        changes: compact.changes,
        updatedAt: compact.updatedAt,
      });
      limitList(snapshot.recentFileChanges, RECENT_FILE_CHANGES_LIMIT);
    }

    appendText(activityEventsFile, `${JSON.stringify(compact)}\n`);
    persistSnapshot();
  };

  const consumeStdoutLine = (line) => {
    if (!parser || !line) {
      return;
    }
    try {
      const event = parser(line);
      if (event) {
        appendActivityEvent(event);
      }
    } catch {
      // Ignore non-JSON diagnostic lines from the engine output.
    }
  };

  return {
    activityFile,
    activityEventsFile,
    onStdoutChunk(text) {
      if (!parser || !text) {
        return;
      }
      stdoutBuffer += text;
      while (stdoutBuffer.includes("\n")) {
        const newlineIndex = stdoutBuffer.indexOf("\n");
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        consumeStdoutLine(line);
      }
    },
    onRuntimeStatus(payload = {}) {
      snapshot.status = String(payload.status || snapshot.status || "running").trim() || "running";
      snapshot.runtime = {
        ...snapshot.runtime,
        ...payload,
      };
      persistSnapshot();
    },
    finalize(payload = {}) {
      if (stdoutBuffer.trim()) {
        consumeStdoutLine(stdoutBuffer.trim());
      }
      stdoutBuffer = "";
      const finalStatus = String(
        payload.status
        || (payload.result ? (payload.result.ok ? "completed" : "failed") : snapshot.status)
        || "completed",
      ).trim();
      snapshot.status = finalStatus || snapshot.status;
      snapshot.finalMessage = String(payload.finalMessage || snapshot.finalMessage || "").trim();
      if (payload.result) {
        const code = Number(payload.result.code);
        snapshot.code = Number.isFinite(code) ? code : snapshot.code;
        snapshot.runtime = {
          ...snapshot.runtime,
          watchdogTriggered: payload.result.watchdogTriggered === true,
          leaseExpired: payload.result.leaseExpired === true,
        };
      }
      persistSnapshot();
    },
  };
}

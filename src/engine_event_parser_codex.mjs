function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function stripMarkdown(value) {
  return normalizeWhitespace(String(value || "")
    .replace(/\*\*(.*?)\*\*/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/^#+\s*/gmu, ""));
}

function shorten(value, maxLength = 160) {
  const text = normalizeWhitespace(value);
  if (!text) {
    return "";
  }
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function summarizeText(value, maxLength = 160) {
  const sections = String(value || "")
    .replace(/\r\n/gu, "\n")
    .split(/\n\s*\n/gu)
    .map((item) => stripMarkdown(item))
    .filter(Boolean);
  return shorten(sections[0] || stripMarkdown(value), maxLength);
}

function normalizeExitCode(value) {
  const code = Number(value);
  return Number.isFinite(code) ? code : null;
}

function normalizeTodoItems(items) {
  const normalized = Array.isArray(items)
    ? items.map((item) => ({
      text: shorten(item?.text || "", 140),
      completed: item?.completed === true,
    }))
    : [];
  const completed = normalized.filter((item) => item.completed).length;
  return {
    items: normalized,
    total: normalized.length,
    completed,
    pending: Math.max(0, normalized.length - completed),
  };
}

function normalizeChanges(changes) {
  return Array.isArray(changes)
    ? changes.map((change) => ({
      path: String(change?.path || "").trim(),
      kind: String(change?.kind || "update").trim() || "update",
    }))
    : [];
}

function buildFileChangeLabel(changes) {
  if (!changes.length) {
    return "文件变更";
  }
  if (changes.length === 1) {
    const change = changes[0];
    return `${change.kind} ${shorten(change.path, 100)}`;
  }
  return `${changes.length} 个文件变更`;
}

export function parseCodexJsonlEventLine(line) {
  const payload = JSON.parse(line);
  const type = String(payload?.type || "").trim();

  if (type === "thread.started") {
    return {
      kind: "thread",
      status: "started",
      label: "线程已启动",
      threadId: String(payload.thread_id || "").trim(),
    };
  }

  if (type === "turn.started") {
    return {
      kind: "turn",
      status: "started",
      label: "轮次开始",
    };
  }

  if (type === "turn.completed") {
    return {
      kind: "turn",
      status: "completed",
      label: "轮次完成",
    };
  }

  if (!type.startsWith("item.")) {
    return {
      kind: "event",
      status: "info",
      label: shorten(type, 120) || "事件更新",
    };
  }

  const item = payload.item || {};
  const itemId = String(item.id || "").trim();
  const itemStatus = type === "item.started"
    ? "in_progress"
    : (String(item.status || "").trim() || "completed");

  if (item.type === "reasoning") {
    const summary = summarizeText(item.text || "", 180);
    return {
      kind: "reasoning",
      itemId,
      status: itemStatus,
      label: summary || "推理更新",
      summary,
    };
  }

  if (item.type === "todo_list") {
    const todo = normalizeTodoItems(item.items);
    return {
      kind: "todo",
      itemId,
      status: itemStatus,
      label: todo.total > 0
        ? `待办 ${todo.completed}/${todo.total}`
        : "待办清单更新",
      todo,
    };
  }

  if (item.type === "command_execution") {
    const command = shorten(item.command || "", 220);
    return {
      kind: "command",
      itemId,
      status: itemStatus,
      label: command || "命令执行",
      command,
      exitCode: normalizeExitCode(item.exit_code),
      outputSummary: summarizeText(item.aggregated_output || "", 160),
    };
  }

  if (item.type === "file_change") {
    const changes = normalizeChanges(item.changes);
    return {
      kind: "file_change",
      itemId,
      status: itemStatus,
      label: buildFileChangeLabel(changes),
      changes,
    };
  }

  return {
    kind: String(item.type || "item").trim() || "item",
    itemId,
    status: itemStatus,
    label: summarizeText(item.text || item.command || item.type || type, 160) || "活动更新",
  };
}

import { STAGE_ORDER } from "./dashboard_web_client_locale_labels.mjs";
import { listTaskRecords, sessionMatchesFilters } from "./dashboard_web_client_state_tasks.mjs";

function normalizeText(value) {
  return String(value || "").trim();
}

function stageRank(stage) {
  const index = STAGE_ORDER.indexOf(String(stage || ""));
  return index >= 0 ? index : STAGE_ORDER.length + 1;
}

export function ensureSelectedSession(snapshot, uiState) {
  const sessions = (snapshot.sessions || []).filter((session) => sessionMatchesFilters(session, uiState.filters));
  if (!sessions.length) {
    uiState.selectedSessionId = "";
    return null;
  }
  const selected = sessions.find((session) => session.sessionId === uiState.selectedSessionId) || sessions[0];
  uiState.selectedSessionId = selected.sessionId;
  return selected;
}

export function deriveInsights(snapshot) {
  const sessions = snapshot.sessions || [];
  return {
    running: sessions.filter((session) => String(session.runtime?.status || "") === "running"),
    retrying: sessions.filter((session) => ["retry_waiting", "probe_waiting", "recovering"].includes(String(session.runtime?.status || ""))),
    manual: sessions.filter((session) => ["paused_operator", "paused_manual", "blocked_manual_input", "blocked_failed"].includes(String(session.statusModel?.code || ""))),
    external: sessions.filter((session) => ["blocked_external"].includes(String(session.statusModel?.code || ""))),
    stageWaiting: sessions.filter((session) => ["blocked_stage_gates"].includes(String(session.statusModel?.code || ""))),
    incompleteDocAnalysis: sessions.filter((session) => /尚未重新分析/u.test(String(session.docAnalysis?.summary || ""))),
    attention: sessions.filter((session) => ["warn", "danger"].includes(String(session.statusModel?.severity || ""))),
  };
}

export function buildDependencyRows(snapshot, filters = {}) {
  return (snapshot.sessions || [])
    .filter((session) => sessionMatchesFilters(session, filters))
    .flatMap((session) => {
      const rows = (session.tasks || []).flatMap((task) => {
        const depends = Array.isArray(task.dependsOn) ? task.dependsOn : [];
        const blocked = Array.isArray(task.blockedBy) ? task.blockedBy : [];
        return [
          ...depends.map((target) => ({
            repoName: session.repoName,
            task: task.title || task.id,
            relation: "dependsOn",
            target,
            status: task.status || "pending",
          })),
          ...blocked.map((item) => ({
            repoName: session.repoName,
            task: task.title || task.id,
            relation: item.type || "blocked_task",
            target: item.label || item.id,
            status: item.status || "open",
          })),
        ];
      });

      if (session.statusModel?.waitTargetLabel) {
        rows.unshift({
          repoName: session.repoName,
          task: session.latestStatus?.taskTitle || session.nextTask?.title || "当前主线",
          relation: session.statusModel?.wait?.type || "wait",
          target: session.statusModel.waitTargetLabel,
          status: session.statusModel.waitLabel || session.statusModel.label,
        });
      }

      return rows.filter((row) => {
        const needle = normalizeText(filters.text).toLowerCase();
        if (!needle) {
          return true;
        }
        return [
          row.repoName,
          row.task,
          row.relation,
          row.target,
          row.status,
        ].map((item) => normalizeText(item).toLowerCase()).join("\n").includes(needle);
      });
    });
}

export function buildTraceEvents(session) {
  const recentEvents = Array.isArray(session.activity?.recentEvents) ? session.activity.recentEvents.slice(-14) : [];
  const commands = Array.isArray(session.activity?.recentCommands)
    ? session.activity.recentCommands.slice(-10).map((item) => ({
      kind: "command",
      label: item.label,
      summary: item.summary,
      updatedAt: item.updatedAt,
    }))
    : [];
  const fileChanges = Array.isArray(session.activity?.recentFileChanges)
    ? session.activity.recentFileChanges.slice(-10).map((item) => ({
      kind: "file_change",
      label: item.label,
      summary: (item.changes || []).map((change) => `${change.kind}:${change.path}`).join(" | "),
      updatedAt: item.updatedAt,
    }))
    : [];

  return [...recentEvents, ...commands, ...fileChanges]
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""), "zh-CN"))
    .slice(0, 20);
}

export function getFilterOptions(snapshot) {
  const taskRecords = listTaskRecords(snapshot);
  return {
    repos: [...new Set((snapshot.sessions || []).map((session) => session.repoName))].sort((left, right) => left.localeCompare(right, "zh-CN")),
    stages: [...new Set(taskRecords.map((record) => normalizeText(record.stage)).filter(Boolean))].sort((left, right) => stageRank(left) - stageRank(right)),
    statuses: [...new Set(taskRecords.map((record) => normalizeText(record.status)).filter(Boolean))],
  };
}

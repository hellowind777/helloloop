export const VIEW_DEFS = Object.freeze([
  { key: "overview" },
  { key: "tasks" },
  { key: "sessions" },
  { key: "dependencies" },
  { key: "trace" },
  { key: "insights" },
]);

export const STATUS_COLUMNS = Object.freeze([
  { key: "pending" },
  { key: "in_progress" },
  { key: "done" },
  { key: "blocked" },
  { key: "failed" },
]);

export function createInitialUiState(snapshot = {}) {
  return {
    view: "overview",
    selectedSessionId: snapshot.sessions?.[0]?.sessionId || "",
    locale: "zh-CN",
    filters: {
      text: "",
      repo: "all",
      stage: "all",
      status: "all",
      attentionOnly: false,
    },
  };
}

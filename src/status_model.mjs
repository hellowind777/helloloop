import { formatTaskStageLabel } from "./workflow_model.mjs";

const RUNTIME_STATUS_LABELS = Object.freeze({
  running: "执行中",
  recovering: "自动恢复中",
  suspected_stall: "疑似卡住，继续观察",
  watchdog_terminating: "watchdog 正在终止当前进程",
  watchdog_waiting: "watchdog 等待进程退出",
  retry_waiting: "等待自动重试",
  probe_waiting: "等待健康探测",
  probe_running: "执行健康探测中",
  paused_operator: "已由操作员暂停",
  paused_manual: "等待人工介入",
  lease_terminating: "宿主租约失效，正在停止",
  stopped_host_closed: "宿主窗口已关闭",
  completed: "当前轮已完成",
  failed: "当前轮执行失败",
  stopped: "后台已停止",
  idle: "空闲",
});

const FAILURE_CODE_LABELS = Object.freeze({
  invalid_request: "请求、参数、协议或输出格式异常",
  auth: "鉴权、订阅或权限异常",
  billing: "额度、账单或余额异常",
  environment: "本地环境、CLI 或权限异常",
  watchdog_idle: "长时间无可见进展",
  rate_limit: "限流或临时容量不足",
  server: "服务端暂时异常",
  network: "网络或结果流中断",
  operator_paused: "已由操作员暂停",
  host_closed: "宿主窗口已关闭",
  unknown_failure: "未知失败",
});

const HTTP_STATUS_LABELS = Object.freeze({
  400: "HTTP 400 / 请求或输出格式异常",
  401: "HTTP 401 / 鉴权异常",
  403: "HTTP 403 / 权限异常",
  429: "HTTP 429 / 限流或临时容量不足",
  500: "HTTP 500 / 服务端异常",
  501: "HTTP 501 / 服务暂未实现",
  502: "HTTP 502 / 网关异常",
  503: "HTTP 503 / 服务暂不可用",
  504: "HTTP 504 / 网关超时",
});

const INTERNAL_PATH_PATTERNS = [
  /[\\/]\.helloloop[\\/]/iu,
  /[\\/]\.helloagents[\\/]/iu,
  /resume\.json/iu,
  /backlog\.json/iu,
  /state\.md/iu,
  /status\.json/iu,
];

function normalizeText(value) {
  return String(value || "").trim();
}

function lowerText(value) {
  return normalizeText(value).toLowerCase();
}

function stripWrappingQuotes(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  if (
    (normalized.startsWith("\"") && normalized.endsWith("\""))
    || (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    return normalized.slice(1, -1).trim();
  }
  return normalized;
}

function buildTaskReference(task, role = "task") {
  if (!task?.id && !task?.title) {
    return null;
  }
  return {
    type: "task",
    role,
    taskId: normalizeText(task?.id),
    taskTitle: normalizeText(task?.title) || normalizeText(task?.id),
    status: normalizeText(task?.status) || "pending",
  };
}

function formatTaskReference(item) {
  const title = normalizeText(item?.taskTitle);
  const taskId = normalizeText(item?.taskId);
  if (!title && !taskId) {
    return "";
  }
  return taskId ? `${title || taskId} (#${taskId})` : title;
}

export function formatStatusTimestamp(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return normalized;
  }
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function isTodoProgressLabel(value) {
  return /^待办\s*\d+\s*\/\s*\d+$/u.test(normalizeText(value));
}

function shortenStatusText(value, maxLength = 120) {
  const normalized = normalizeText(value).replace(/\s+/gu, " ");
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function parseStructuredStatusLabel(value) {
  const normalized = normalizeText(value);
  if (!normalized || (!normalized.startsWith("{") && !normalized.startsWith("["))) {
    return null;
  }
  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

function formatStructuredVerdict(verdict) {
  const normalized = lowerText(verdict);
  if (!normalized) {
    return "";
  }
  if (normalized === "complete") {
    return "任务已完成";
  }
  if (normalized === "incomplete") {
    return "仍有验收项待补齐";
  }
  if (normalized === "blocked") {
    return "当前存在阻塞";
  }
  return normalized;
}

function simplifyStructuredStatusLabel(value) {
  const parsed = parseStructuredStatusLabel(value);
  if (parsed && !Array.isArray(parsed)) {
    const summary = normalizeText(parsed.summary);
    const nextAction = normalizeText(parsed.nextAction);
    const blockerReason = normalizeText(parsed.blockerReason);
    const verdictLabel = formatStructuredVerdict(parsed.verdict);
    const missingCount = Array.isArray(parsed.missing) ? parsed.missing.length : 0;
    const parts = [
      summary || verdictLabel,
      blockerReason,
      missingCount > 0 ? `待补齐 ${missingCount} 项` : "",
      nextAction && nextAction !== "当前任务已完成" ? `下一步：${nextAction}` : "",
    ].filter(Boolean);
    return shortenStatusText(parts.join(" · "));
  }

  const normalized = normalizeText(value);
  if (!normalized.startsWith("{")) {
    return "";
  }
  const summaryMatch = normalized.match(/"summary"\s*:\s*"([^"]+)/u);
  const nextActionMatch = normalized.match(/"nextAction"\s*:\s*"([^"]+)/u);
  const blockerMatch = normalized.match(/"blockerReason"\s*:\s*"([^"]+)/u);
  const verdictMatch = normalized.match(/"verdict"\s*:\s*"([^"]+)/u);
  const parts = [
    summaryMatch?.[1] ? stripWrappingQuotes(summaryMatch[1]) : "",
    blockerMatch?.[1] ? stripWrappingQuotes(blockerMatch[1]) : "",
    formatStructuredVerdict(verdictMatch?.[1]),
    nextActionMatch?.[1] && stripWrappingQuotes(nextActionMatch[1]) !== "当前任务已完成"
      ? `下一步：${stripWrappingQuotes(nextActionMatch[1])}`
      : "",
    /"acceptanceChecks"\s*:/u.test(normalized) ? "任务复核结果已产出" : "",
  ].filter(Boolean);
  return shortenStatusText(parts.join(" · "));
}

function simplifyNarrativeLabel(value) {
  const structured = simplifyStructuredStatusLabel(value);
  if (structured) {
    return structured;
  }
  return shortenStatusText(value);
}

function detectHttpStatusCode(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (!text) {
      continue;
    }
    const matched = text.match(/\b(400|401|403|429|500|501|502|503|504)\b/u);
    if (matched) {
      return Number(matched[1]);
    }
  }
  return 0;
}

function unwrapShellCommand(label) {
  const normalized = normalizeText(label);
  if (!normalized) {
    return "";
  }
  const markerIndex = normalized.toLowerCase().lastIndexOf(" -command ");
  if (markerIndex < 0) {
    return normalized;
  }
  return stripWrappingQuotes(normalized.slice(markerIndex + " -command ".length));
}

function isInternalPathText(value) {
  const normalized = normalizeText(value);
  return INTERNAL_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function simplifyCommandLabel(label) {
  const rawCommand = unwrapShellCommand(label);
  const command = normalizeText(rawCommand)
    .replace(/^['"]+/u, "")
    .replace(/['"]+$/u, "")
    .trim();
  const normalized = lowerText(command);
  const internal = isInternalPathText(command);

  if (!command) {
    return { label: "", rawLabel: normalizeText(label), internal: true };
  }
  if (/^just\s+verify\b/iu.test(command)) {
    return { label: "执行 just verify", rawLabel: command, internal: false };
  }
  const npmRunMatch = command.match(/^npm\s+run\s+([a-z0-9:_-]+)/iu);
  if (npmRunMatch) {
    return { label: `执行 npm run ${npmRunMatch[1]}`, rawLabel: command, internal: false };
  }
  if (/^cargo\s+test\b/iu.test(command)) {
    return { label: "执行 cargo test", rawLabel: command, internal: false };
  }
  if (/^cargo\s+check\b/iu.test(command)) {
    return { label: "执行 cargo check", rawLabel: command, internal: false };
  }
  if (/^cargo\s+build\b/iu.test(command)) {
    return { label: "执行 cargo build", rawLabel: command, internal: false };
  }
  if (/^cargo\s+metadata\b/iu.test(command)) {
    return { label: "检查 Cargo workspace 组成", rawLabel: command, internal: false };
  }
  if (/^git\s+status\b/iu.test(command)) {
    return { label: "检查 git 工作区状态", rawLabel: command, internal: false };
  }
  if (/^node\b.*\s--check\b/iu.test(command)) {
    return { label: "执行 node --check", rawLabel: command, internal: false };
  }
  if (/^select-string\b/iu.test(command)) {
    return { label: "搜索相关代码片段", rawLabel: command, internal: false };
  }
  if (/measure-object/iu.test(command) && /get-childitem/iu.test(command)) {
    return { label: "统计目录文件数量", rawLabel: command, internal: false };
  }
  if (/^rg\b/iu.test(command)) {
    return {
      label: internal ? "检查 HelloLoop / 项目状态文件" : "搜索相关代码片段",
      rawLabel: command,
      internal,
    };
  }
  if (/^get-date\b/iu.test(command)) {
    return { label: "生成时间戳", rawLabel: command, internal: true };
  }
  if (/^get-childitem\b/iu.test(command)) {
    return {
      label: internal ? "检查内部目录状态" : "检查目录状态",
      rawLabel: command,
      internal: true,
    };
  }
  if (/^test-path\b/iu.test(command)) {
    return { label: "检查文件或目录是否存在", rawLabel: command, internal: true };
  }
  if (/^get-content\b/iu.test(command)) {
    return {
      label: internal ? "读取状态文件" : "读取文件内容",
      rawLabel: command,
      internal,
    };
  }
  return {
    label: command.length > 96 ? `${command.slice(0, 95)}…` : command,
    rawLabel: command,
    internal,
  };
}

function buildActivityCandidate(kind, label, source, options = {}) {
  const normalized = normalizeText(label);
  if (!normalized || isTodoProgressLabel(normalized)) {
    return null;
  }
  return {
    kind: normalizeText(kind) || "unknown",
    label: normalized,
    rawLabel: normalizeText(options.rawLabel || normalized),
    source: normalizeText(source) || "unknown",
    internal: options.internal === true,
    updatedAt: normalizeText(options.updatedAt),
  };
}

function buildEventActivityCandidate(event, source) {
  const kind = lowerText(event?.kind || (Array.isArray(event?.changes) ? "file_change" : ""));
  if (!kind) {
    return null;
  }
  if (kind === "command") {
    const simplified = simplifyCommandLabel(event?.label);
    return buildActivityCandidate("command", simplified.label, source, {
      rawLabel: simplified.rawLabel,
      internal: simplified.internal,
      updatedAt: event?.updatedAt,
    });
  }
  if (kind === "file_change") {
    const changes = Array.isArray(event?.changes) ? event.changes : [];
    if (changes.length === 1) {
      const change = changes[0];
      return buildActivityCandidate(
        "file_change",
        `${normalizeText(change?.kind) || "update"}:${normalizeText(change?.path)}`,
        source,
        {
          rawLabel: event?.label,
          updatedAt: event?.updatedAt,
        },
      );
    }
    if (changes.length > 1) {
      return buildActivityCandidate("file_change", `${changes.length} 个文件变更`, source, {
        rawLabel: event?.label,
        updatedAt: event?.updatedAt,
      });
    }
  }
  if (kind === "agent_message" || kind === "reasoning") {
    return buildActivityCandidate(kind, simplifyNarrativeLabel(event?.label), source, {
      updatedAt: event?.updatedAt,
      rawLabel: event?.label,
    });
  }
  return buildActivityCandidate(kind, simplifyNarrativeLabel(event?.label), source, {
    updatedAt: event?.updatedAt,
    rawLabel: event?.label,
  });
}

function buildCurrentActivityCandidate(activity) {
  const current = activity?.current || null;
  const kind = lowerText(current?.kind);
  if (!kind) {
    return null;
  }
  if (kind === "command") {
    const simplified = simplifyCommandLabel(current?.label);
    return buildActivityCandidate("command", simplified.label, "activity.current", {
      rawLabel: simplified.rawLabel,
      internal: simplified.internal,
      updatedAt: current?.updatedAt || activity?.updatedAt,
    });
  }
  return buildActivityCandidate(kind, simplifyNarrativeLabel(current?.label), "activity.current", {
    updatedAt: current?.updatedAt || activity?.updatedAt,
    rawLabel: current?.label,
  });
}

function compareCandidateScore(candidate) {
  const sourceRank = {
    "activity.current": 60,
    recent_file_changes: 55,
    recent_events: 50,
    recent_commands: 40,
    latest_status: 10,
  };
  const kindRank = {
    file_change: 40,
    agent_message: 35,
    reasoning: 30,
    command: candidate?.internal ? 5 : 20,
    message: 15,
    unknown: 10,
  };
  return (sourceRank[candidate?.source] || 0) + (kindRank[candidate?.kind] || 0);
}

function sortCandidates(candidates) {
  return [...candidates].sort((left, right) => {
    const byScore = compareCandidateScore(right) - compareCandidateScore(left);
    if (byScore !== 0) {
      return byScore;
    }
    return normalizeText(right?.updatedAt).localeCompare(normalizeText(left?.updatedAt), "zh-CN");
  });
}

function buildActivityDescriptor(snapshot) {
  const activity = snapshot?.activity || null;
  const candidates = [];
  const currentCandidate = buildCurrentActivityCandidate(activity);
  if (currentCandidate) {
    candidates.push(currentCandidate);
  }

  const recentFileChange = Array.isArray(activity?.recentFileChanges)
    ? activity.recentFileChanges.at(-1)
    : null;
  const fileChangeCandidate = buildEventActivityCandidate(recentFileChange, "recent_file_changes");
  if (fileChangeCandidate) {
    candidates.push(fileChangeCandidate);
  }

  const recentEvents = Array.isArray(activity?.recentEvents) ? activity.recentEvents : [];
  for (let index = recentEvents.length - 1; index >= 0 && candidates.length < 8; index -= 1) {
    const candidate = buildEventActivityCandidate(recentEvents[index], "recent_events");
    if (candidate) {
      candidates.push(candidate);
    }
  }

  const recentCommands = Array.isArray(activity?.recentCommands) ? activity.recentCommands : [];
  for (let index = recentCommands.length - 1; index >= 0 && candidates.length < 10; index -= 1) {
    const candidate = buildEventActivityCandidate(
      { ...recentCommands[index], kind: "command" },
      "recent_commands",
    );
    if (candidate) {
      candidates.push(candidate);
    }
  }

  const latestStatusCandidate = buildActivityCandidate(
    "message",
    simplifyNarrativeLabel(snapshot?.latestStatus?.message),
    "latest_status",
    {
      updatedAt: snapshot?.latestStatus?.updatedAt,
      rawLabel: snapshot?.latestStatus?.message,
    },
  );
  if (latestStatusCandidate) {
    candidates.push(latestStatusCandidate);
  }

  const selected = sortCandidates(candidates).find((item) => !item.internal)
    || sortCandidates(candidates)[0]
    || null;

  if (!selected) {
    return {
      kind: "idle",
      label: "",
      rawLabel: "",
      source: "none",
      internal: false,
      updatedAt: "",
    };
  }
  return selected;
}

export function resolveActivityActionLabel(activity) {
  return buildCurrentActivityCandidate(activity)?.label || "";
}

export function resolveTodoProgress(snapshot) {
  const total = Number(snapshot?.activity?.todo?.total || 0);
  if (!total) {
    return "";
  }
  return `${Number(snapshot?.activity?.todo?.completed || 0)}/${total}`;
}

function buildFailureDescriptor(snapshot, runtimeStatus) {
  const runtime = snapshot?.runtime || {};
  const runtimeCarriesActiveFailure = [
    "recovering",
    "retry_waiting",
    "probe_waiting",
    "probe_running",
    "watchdog_waiting",
    "watchdog_terminating",
    "lease_terminating",
    "paused_manual",
    "failed",
    "stopped_host_closed",
  ].includes(runtimeStatus);
  if (!runtimeCarriesActiveFailure) {
    return {
      kind: "none",
      code: "",
      family: "",
      httpStatusCode: 0,
      httpStatusLabel: "",
      label: "",
      detail: "",
      retryable: false,
      nextRetryAt: "",
      nextRetryLabel: "",
      strategyLabel: "",
    };
  }
  const httpStatusCode = Number(runtime.failureHttpStatus || detectHttpStatusCode(
    runtime.failureReason,
    snapshot?.activity?.current?.label,
    snapshot?.latestStatus?.message,
  )) || 0;
  const failureCode = lowerText(runtime.failureCode);
  const failureFamily = lowerText(runtime.failureFamily);
  const label = httpStatusCode
    ? (HTTP_STATUS_LABELS[httpStatusCode] || `HTTP ${httpStatusCode}`)
    : (FAILURE_CODE_LABELS[failureCode] || normalizeText(runtime.failureReason));
  const nextRetryAt = normalizeText(runtime.nextRetryAt);
  const retryable = [
    "recovering",
    "retry_waiting",
    "probe_waiting",
    "probe_running",
    "watchdog_waiting",
    "watchdog_terminating",
    "lease_terminating",
  ].includes(runtimeStatus) || failureFamily === "soft";

  return {
    kind: label ? "runtime" : "none",
    code: failureCode,
    family: failureFamily,
    httpStatusCode,
    httpStatusLabel: httpStatusCode ? (HTTP_STATUS_LABELS[httpStatusCode] || `HTTP ${httpStatusCode}`) : "",
    label,
    detail: normalizeText(runtime.failureReason),
    retryable,
    nextRetryAt,
    nextRetryLabel: nextRetryAt ? formatStatusTimestamp(nextRetryAt) : "",
    strategyLabel: label ? (retryable ? "自动恢复链路" : "人工修复链路") : "",
  };
}

function buildDependencyWait(snapshot, execution) {
  const tasks = Array.isArray(snapshot?.tasks) ? snapshot.tasks : [];
  const blockedTask = execution?.blockedTask || null;
  const unresolvedRefs = Array.isArray(execution?.unresolvedRefs) && execution.unresolvedRefs.length
    ? execution.unresolvedRefs
    : (Array.isArray(execution?.unresolved) ? execution.unresolved.map((taskId) => ({ id: taskId, kind: "dependency" })) : []);
  const dependencyTargets = unresolvedRefs
    .map((ref) => {
      const task = tasks.find((item) => item.id === ref.id);
      if (!task) {
        return null;
      }
      return {
        ...buildTaskReference(task, ref.kind === "stage_gate" ? "stage_gate" : "dependency"),
        stage: normalizeText(task.stage),
        dependencyKind: ref.kind,
      };
    })
    .filter(Boolean)
  const waitTargets = [
    buildTaskReference(blockedTask, "blocked_task"),
    ...dependencyTargets,
  ].filter(Boolean);
  const dependencyLabel = dependencyTargets.map((item) => (
    item.dependencyKind === "stage_gate" && item.stage
      ? `${formatTaskReference(item)} · ${formatTaskStageLabel(item.stage)}`
      : formatTaskReference(item)
  )).join("；");

  return {
    waitTargets,
    blockedTaskId: normalizeText(blockedTask?.id),
    blockedTaskTitle: normalizeText(blockedTask?.title),
    waitTargetLabel: dependencyLabel,
    dependencyKinds: [...new Set(dependencyTargets.map((item) => item.dependencyKind))],
  };
}

function extractRepoMentions(task) {
  const matches = new Set();
  const texts = [
    task?.title,
    task?.goal,
    ...(Array.isArray(task?.acceptance) ? task.acceptance : []),
    ...(Array.isArray(task?.docs) ? task.docs : []),
  ];
  for (const text of texts) {
    const normalized = normalizeText(text);
    if (!normalized) {
      continue;
    }
    const items = normalized.match(/\bhellomind-[a-z0-9-]+\b/giu) || [];
    for (const item of items) {
      matches.add(item.toLowerCase());
    }
  }
  return [...matches];
}

function buildBlockedWait(execution) {
  const blockedTask = execution?.blockedTask || null;
  const repoTargets = extractRepoMentions(blockedTask);
  const waitTargets = [
    buildTaskReference(blockedTask, "blocked_task"),
    ...repoTargets.map((repoName) => ({
      type: "repo",
      role: "external_repo",
      repoName,
    })),
  ].filter(Boolean);
  return {
    waitTargets,
    waitTargetLabel: repoTargets.length
      ? `等待上游事实源或实现：${repoTargets.join("、")}`
      : formatTaskReference(buildTaskReference(blockedTask, "blocked_task")),
  };
}

function buildBlockingSignalWait(execution) {
  const blockedTask = execution?.blockedTask || null;
  const signals = Array.isArray(execution?.blockingSignals) ? execution.blockingSignals : [];
  const targets = signals.map((item) => ({
    type: String(item?.type || "").trim(),
    role: String(item?.type || "").trim(),
    label: normalizeText(item?.label) || normalizeText(item?.id),
    itemId: normalizeText(item?.id),
  })).filter((item) => item.label);
  const waitTargets = [
    buildTaskReference(blockedTask, "blocked_task"),
    ...targets,
  ].filter(Boolean);
  return {
    waitTargets,
    waitTargetLabel: targets.length
      ? targets.map((item) => item.label).join("；")
      : formatTaskReference(buildTaskReference(blockedTask, "blocked_task")),
  };
}

function buildSchedulerDescriptor(state, label, reason, options = {}) {
  return {
    state,
    label,
    reason,
    detail: normalizeText(options.detail),
    mode: normalizeText(options.mode) || "autonomous",
    willAutoResume: options.willAutoResume === true,
    nextTaskId: normalizeText(options.nextTaskId),
    nextTaskTitle: normalizeText(options.nextTaskTitle),
    blockedTaskId: normalizeText(options.blockedTaskId),
    blockedTaskTitle: normalizeText(options.blockedTaskTitle),
  };
}

function buildWaitDescriptor(type, label, options = {}) {
  return {
    type,
    label,
    detail: normalizeText(options.detail),
    targetLabel: normalizeText(options.targetLabel),
    targets: Array.isArray(options.targets) ? options.targets : [],
    until: normalizeText(options.until),
    resumesAutomatically: options.resumesAutomatically === true,
  };
}

export function resolveCurrentActionLabel(snapshot) {
  return buildActivityDescriptor(snapshot).label || "";
}

function buildStatusModelBase(snapshot) {
  const runtimeStatus = lowerText(snapshot?.runtime?.status);
  const activity = buildActivityDescriptor(snapshot);
  const failure = buildFailureDescriptor(snapshot, runtimeStatus);
  return {
    category: "idle",
    code: "idle",
    severity: "accent",
    label: "空闲",
    reason: "",
    reasonCode: "",
    detail: "",
    autoAction: "",
    waitType: "none",
    waitLabel: "",
    waitTargetLabel: "",
    waitTargets: [],
    currentAction: activity.label,
    todoProgress: resolveTodoProgress(snapshot),
    httpStatusCode: failure.httpStatusCode,
    httpStatusLabel: failure.httpStatusLabel,
    failureCode: failure.code,
    failureLabel: failure.label,
    schedulerLabel: "",
    activity,
    failure,
    wait: buildWaitDescriptor("none", ""),
    scheduler: buildSchedulerDescriptor("idle", "空闲", ""),
  };
}

function finalizeStatusModel(base, overrides) {
  const wait = overrides.wait || base.wait;
  const scheduler = overrides.scheduler || base.scheduler;
  const failure = overrides.failure || base.failure;
  return {
    ...base,
    ...overrides,
    waitType: wait.type,
    waitLabel: wait.label,
    waitTargetLabel: wait.targetLabel,
    waitTargets: wait.targets,
    httpStatusCode: failure.httpStatusCode,
    httpStatusLabel: failure.httpStatusLabel,
    failureCode: failure.code,
    failureLabel: failure.label,
    schedulerLabel: scheduler.label,
    wait,
    scheduler,
    failure,
  };
}

export function deriveSessionStatusModel(snapshot = {}) {
  const runtimeStatus = lowerText(snapshot?.runtime?.status);
  const supervisorActive = ["launching", "running"].includes(lowerText(snapshot?.supervisor?.status));
  const pauseControl = snapshot?.pauseControl || null;
  const execution = snapshot?.automationExecution || snapshot?.execution || null;
  const nextTask = execution?.task || snapshot?.nextTask || null;
  const base = buildStatusModelBase(snapshot);
  const failure = base.failure;
  const runtimeTaskId = normalizeText(snapshot?.latestStatus?.taskId);
  const runtimeTaskTitle = normalizeText(snapshot?.latestStatus?.taskTitle);
  const operatorPaused = !supervisorActive && (
    pauseControl?.paused === true
    || runtimeStatus === "paused_operator"
  );

  if (operatorPaused) {
    const pauseMessage = normalizeText(
      pauseControl?.message
      || snapshot?.runtime?.failureReason
      || "主线已被操作员手动暂停。",
    );
    const scheduler = buildSchedulerDescriptor(
      "paused_operator",
      "已由操作员暂停",
      pauseMessage || "等待操作员恢复主线",
      {
        mode: "manual",
        willAutoResume: false,
        blockedTaskId: runtimeTaskId || normalizeText(pauseControl?.taskId),
        blockedTaskTitle: runtimeTaskTitle || normalizeText(pauseControl?.taskTitle),
      },
    );
    const wait = buildWaitDescriptor("manual", "等待显式继续主线", {
      targetLabel: runtimeTaskTitle || normalizeText(pauseControl?.taskTitle),
      targets: runtimeTaskId || runtimeTaskTitle
        ? [{
          type: "task",
          role: "blocked_task",
          taskId: runtimeTaskId || normalizeText(pauseControl?.taskId),
          taskTitle: runtimeTaskTitle || normalizeText(pauseControl?.taskTitle),
          status: "paused",
        }]
        : [],
      resumesAutomatically: false,
    });
    return finalizeStatusModel(base, {
      category: "manual_blocked",
      code: "paused_operator",
      severity: "warn",
      label: "已由操作员暂停",
      reason: scheduler.reason,
      reasonCode: "operator_paused",
      detail: pauseMessage,
      autoAction: "等待操作员点击 Continue mainline 或显式恢复",
      currentAction: pauseMessage || "等待显式继续主线",
      failure: {
        ...base.failure,
        kind: "runtime",
        code: "operator_paused",
        family: "manual",
        label: "已由操作员暂停",
        detail: pauseMessage,
        retryable: false,
        nextRetryAt: "",
        nextRetryLabel: "",
        strategyLabel: "人工恢复链路",
      },
      wait,
      scheduler,
    });
  }

  if (["running", "recovering", "probe_running"].includes(runtimeStatus)) {
    const scheduler = buildSchedulerDescriptor(
      runtimeStatus === "running" ? "active_task" : "runtime_recovery",
      runtimeStatus === "probe_running" ? "执行健康探测" : (runtimeStatus === "recovering" ? "自动恢复当前任务" : "自动推进当前任务"),
      runtimeStatus === "recovering"
        ? (failure.label || "上一轮异常后继续恢复当前任务")
        : "当前任务正在推进",
      {
        mode: "autonomous",
        willAutoResume: true,
        blockedTaskId: runtimeTaskId,
        blockedTaskTitle: runtimeTaskTitle,
      },
    );
    const wait = runtimeStatus === "running"
      ? buildWaitDescriptor("none", "")
      : buildWaitDescriptor("recovery", "等待当前恢复步骤完成", {
        resumesAutomatically: true,
      });
    return finalizeStatusModel(base, {
      category: runtimeStatus === "running" ? "active" : "recovery",
      code: runtimeStatus,
      severity: runtimeStatus === "running" ? "ok" : "warn",
      label: RUNTIME_STATUS_LABELS[runtimeStatus] || "执行中",
      reason: scheduler.reason,
      reasonCode: runtimeStatus === "recovering" ? (failure.code || "recovering") : "running",
      detail: runtimeTaskTitle ? `当前任务：${runtimeTaskTitle}` : "",
      autoAction: runtimeStatus === "probe_running"
        ? "系统正在执行健康探测"
        : "系统持续执行当前任务",
      wait,
      scheduler,
    });
  }

  if ([
    "retry_waiting",
    "probe_waiting",
    "watchdog_waiting",
    "watchdog_terminating",
    "lease_terminating",
  ].includes(runtimeStatus)) {
    const nextRetryLabel = failure.nextRetryLabel
      ? `下次自动动作：${failure.nextRetryLabel}`
      : "";
    const scheduler = buildSchedulerDescriptor(
      "runtime_retry",
      "等待自动恢复",
      failure.label || normalizeText(snapshot?.runtime?.failureReason) || "系统正在等待下一次自动恢复",
      {
        detail: nextRetryLabel,
        mode: "autonomous",
        willAutoResume: true,
        blockedTaskId: runtimeTaskId,
        blockedTaskTitle: runtimeTaskTitle,
      },
    );
    const wait = buildWaitDescriptor("runtime_retry", nextRetryLabel || "等待自动重试", {
      until: failure.nextRetryAt,
      targetLabel: nextRetryLabel,
      resumesAutomatically: true,
    });
    return finalizeStatusModel(base, {
      category: "recovery",
      code: runtimeStatus,
      severity: "warn",
      label: RUNTIME_STATUS_LABELS[runtimeStatus] || "等待自动恢复",
      reason: scheduler.reason,
      reasonCode: failure.code || runtimeStatus,
      detail: nextRetryLabel,
      autoAction: failure.nextRetryLabel
        ? `系统将在 ${failure.nextRetryLabel} 自动继续`
        : "系统会继续自动探测或重试",
      wait,
      scheduler,
    });
  }

  if (["paused_manual", "failed", "stopped_host_closed"].includes(runtimeStatus)) {
    const scheduler = buildSchedulerDescriptor(
      runtimeStatus === "stopped_host_closed" ? "host_closed" : "manual_fix_required",
      runtimeStatus === "stopped_host_closed" ? "宿主已关闭" : "等待人工介入",
      failure.label || normalizeText(snapshot?.runtime?.failureReason) || "当前轮执行失败",
      {
        mode: "manual",
        willAutoResume: false,
        blockedTaskId: runtimeTaskId,
        blockedTaskTitle: runtimeTaskTitle,
      },
    );
    const wait = buildWaitDescriptor(
      runtimeStatus === "stopped_host_closed" ? "host_closed" : "manual",
      runtimeStatus === "stopped_host_closed" ? "等待重新打开宿主或重新续跑" : "等待人工修复问题",
      {
        resumesAutomatically: false,
      },
    );
    return finalizeStatusModel(base, {
      category: "manual_blocked",
      code: runtimeStatus || "failed",
      severity: "danger",
      label: RUNTIME_STATUS_LABELS[runtimeStatus] || "等待人工介入",
      reason: scheduler.reason,
      reasonCode: failure.code || runtimeStatus || "failed",
      detail: failure.detail || (supervisorActive
        ? "后台 supervisor 仍在，但当前任务无法自动收束"
        : "当前任务已停下，需先解除问题"),
      autoAction: "需修复问题后再继续续跑",
      wait,
      scheduler,
    });
  }

  if (execution?.state === "blocked_stage_gates" || execution?.state === "blocked_dependencies") {
    const dependencyWait = buildDependencyWait(snapshot, execution);
    const waitingStageGate = execution?.state === "blocked_stage_gates"
      || dependencyWait.dependencyKinds.includes("stage_gate");
    const scheduler = buildSchedulerDescriptor(
      waitingStageGate ? "waiting_stage_gate" : "waiting_dependency",
      waitingStageGate ? "等待上游阶段" : "等待依赖任务",
      waitingStageGate ? "更早阶段任务尚未完成" : "前置任务尚未完成",
      {
        detail: dependencyWait.blockedTaskTitle
          ? `当前任务：${dependencyWait.blockedTaskTitle}`
          : normalizeText(execution?.blockedReason),
        mode: supervisorActive ? "autonomous" : "manual_resume",
        willAutoResume: supervisorActive,
        blockedTaskId: dependencyWait.blockedTaskId,
        blockedTaskTitle: dependencyWait.blockedTaskTitle,
      },
    );
    const wait = buildWaitDescriptor(waitingStageGate ? "stage_gate" : "dependency", waitingStageGate ? "等待更早阶段任务完成" : "等待前置任务完成", {
      targetLabel: dependencyWait.waitTargetLabel,
      targets: dependencyWait.waitTargets,
      resumesAutomatically: supervisorActive,
    });
    return finalizeStatusModel(base, {
      category: "waiting_dependency",
      code: execution?.state || "blocked_dependencies",
      severity: "warn",
      label: waitingStageGate ? "等待上游阶段" : "等待依赖任务",
      reason: scheduler.reason,
      reasonCode: execution?.state || "blocked_dependencies",
      detail: scheduler.detail,
      autoAction: supervisorActive ? "依赖满足后会继续推进" : "依赖满足后可直接续跑",
      wait,
      scheduler,
    });
  }

  if (execution?.state === "blocked_external") {
    const signalWait = buildBlockingSignalWait(execution);
    const scheduler = buildSchedulerDescriptor(
      "waiting_external_dependency",
      "等待外部依赖",
      normalizeText(execution?.blockedReason) || "外部依赖或产物尚未就绪",
      {
        mode: supervisorActive ? "autonomous" : "manual_resume",
        willAutoResume: supervisorActive,
        blockedTaskId: normalizeText(execution?.blockedTask?.id),
        blockedTaskTitle: normalizeText(execution?.blockedTask?.title),
      },
    );
    const wait = buildWaitDescriptor("external_dependency", "等待外部依赖或产物就绪", {
      targetLabel: signalWait.waitTargetLabel,
      targets: signalWait.waitTargets,
      resumesAutomatically: supervisorActive,
    });
    return finalizeStatusModel(base, {
      category: "waiting_dependency",
      code: "blocked_external",
      severity: "warn",
      label: "等待外部依赖",
      reason: scheduler.reason,
      reasonCode: "blocked_external",
      detail: signalWait.waitTargetLabel,
      autoAction: supervisorActive ? "依赖就绪后会继续推进" : "依赖就绪后可直接续跑",
      wait,
      scheduler,
    });
  }

  if (execution?.state === "blocked_manual_input") {
    const signalWait = buildBlockingSignalWait(execution);
    const scheduler = buildSchedulerDescriptor(
      "waiting_manual_input",
      "等待人工输入",
      normalizeText(execution?.blockedReason) || "需要人工输入、审批或放行",
      {
        mode: "manual",
        blockedTaskId: normalizeText(execution?.blockedTask?.id),
        blockedTaskTitle: normalizeText(execution?.blockedTask?.title),
      },
    );
    const wait = buildWaitDescriptor("manual", "等待人工输入、审批或放行", {
      targetLabel: signalWait.waitTargetLabel,
      targets: signalWait.waitTargets,
      resumesAutomatically: false,
    });
    return finalizeStatusModel(base, {
      category: "manual_blocked",
      code: "blocked_manual_input",
      severity: "warn",
      label: "等待人工输入",
      reason: scheduler.reason,
      reasonCode: "blocked_manual_input",
      detail: signalWait.waitTargetLabel,
      autoAction: "补齐人工输入或审批后可继续推进",
      wait,
      scheduler,
    });
  }

  if (execution?.state === "blocked_risk") {
    const blockedTask = buildTaskReference(execution?.blockedTask, "blocked_task");
    const scheduler = buildSchedulerDescriptor(
      "waiting_risk_release",
      "等待风险放行",
      normalizeText(execution?.blockedReason) || "后续任务超出当前风险门限",
      {
        mode: "manual",
        blockedTaskId: blockedTask?.taskId,
        blockedTaskTitle: blockedTask?.taskTitle,
      },
    );
    const wait = buildWaitDescriptor("manual", "等待人工放行高风险任务", {
      targetLabel: formatTaskReference(blockedTask),
      targets: blockedTask ? [blockedTask] : [],
      resumesAutomatically: false,
    });
    return finalizeStatusModel(base, {
      category: "manual_blocked",
      code: "blocked_risk",
      severity: "warn",
      label: "等待风险放行",
      reason: scheduler.reason,
      reasonCode: "blocked_risk",
      autoAction: "允许高风险任务后可继续推进",
      wait,
      scheduler,
    });
  }

  if (execution?.state === "blocked_failed") {
    const blockedWait = buildBlockedWait(execution);
    const scheduler = buildSchedulerDescriptor(
      "manual_blocked",
      "存在人工阻塞",
      normalizeText(execution?.blockedReason) || "存在失败或阻塞任务",
      {
        mode: blockedWait.waitTargets.some((item) => item?.type === "repo") ? "external_dependency" : "manual",
        willAutoResume: supervisorActive,
        blockedTaskId: normalizeText(execution?.blockedTask?.id),
        blockedTaskTitle: normalizeText(execution?.blockedTask?.title),
      },
    );
    const waitType = blockedWait.waitTargets.some((item) => item?.type === "repo")
      ? "external_dependency"
      : "manual";
    const wait = buildWaitDescriptor(waitType, waitType === "external_dependency"
      ? "等待外部依赖恢复"
      : "等待人工解除阻塞", {
      targetLabel: blockedWait.waitTargetLabel,
      targets: blockedWait.waitTargets,
      resumesAutomatically: supervisorActive,
    });
    return finalizeStatusModel(base, {
      category: "manual_blocked",
      code: "blocked_failed",
      severity: "danger",
      label: "存在人工阻塞",
      reason: scheduler.reason,
      reasonCode: "blocked_failed",
      detail: blockedWait.waitTargetLabel,
      autoAction: supervisorActive ? "解除阻塞后会继续推进" : "解除阻塞后可直接续跑",
      wait,
      scheduler,
    });
  }

  if (execution?.state === "blocked_in_progress") {
    const blockedTask = buildTaskReference(execution?.blockedTask, "blocked_task");
    const scheduler = buildSchedulerDescriptor(
      supervisorActive ? "active_task" : "waiting_current_task_resume",
      supervisorActive ? "自动推进当前任务" : "等待当前任务续跑",
      normalizeText(execution?.blockedReason) || "存在未收束的进行中任务",
      {
        mode: supervisorActive ? "autonomous" : "manual_resume",
        willAutoResume: supervisorActive,
        blockedTaskId: blockedTask?.taskId,
        blockedTaskTitle: blockedTask?.taskTitle,
      },
    );
    const wait = buildWaitDescriptor("current_task", "等待当前进行中任务收束", {
      targetLabel: formatTaskReference(blockedTask),
      targets: blockedTask ? [blockedTask] : [],
      resumesAutomatically: supervisorActive,
    });
    return finalizeStatusModel(base, {
      category: supervisorActive ? "active" : "ready",
      code: "blocked_in_progress",
      severity: supervisorActive ? "ok" : "warn",
      label: supervisorActive ? "执行中" : "等待当前任务续跑",
      reason: scheduler.reason,
      reasonCode: "blocked_in_progress",
      detail: blockedTask?.taskTitle ? `当前任务：${blockedTask.taskTitle}` : "",
      autoAction: supervisorActive ? "系统持续推进当前任务" : "恢复 run-loop 后将从该任务继续",
      wait,
      scheduler,
    });
  }

  if (execution?.state === "ready" && nextTask && !supervisorActive) {
    const scheduler = buildSchedulerDescriptor("ready_next_task", "可直接续跑", `下一任务：${nextTask.title}`, {
      mode: "manual_resume",
      nextTaskId: nextTask.id,
      nextTaskTitle: nextTask.title,
    });
    return finalizeStatusModel(base, {
      category: "ready",
      code: "ready_to_resume",
      severity: "ok",
      label: "可直接续跑",
      reason: scheduler.reason,
      reasonCode: "ready_to_resume",
      autoAction: "重新进入 run-loop 后会继续当前主线",
      scheduler,
    });
  }

  if (runtimeStatus === "completed" && nextTask) {
    const scheduler = buildSchedulerDescriptor(
      "ready_next_task",
      "准备切换下一个任务",
      `下一任务：${nextTask.title}`,
      {
        mode: supervisorActive ? "autonomous" : "manual_resume",
        willAutoResume: supervisorActive,
        nextTaskId: nextTask.id,
        nextTaskTitle: nextTask.title,
      },
    );
    return finalizeStatusModel(base, {
      category: "ready",
      code: "completed_with_next_task",
      severity: "ok",
      label: "上轮已结束，可继续下一个任务",
      reason: scheduler.reason,
      reasonCode: "completed_with_next_task",
      autoAction: supervisorActive ? "后台会继续切到下一个任务" : "可直接续跑下一任务",
      scheduler,
    });
  }

  if (runtimeStatus === "completed" || execution?.state === "done") {
    const scheduler = buildSchedulerDescriptor("completed", "当前 backlog 已完成", "当前没有新的可执行任务", {
      mode: supervisorActive ? "autonomous" : "manual",
    });
    return finalizeStatusModel(base, {
      category: "completed",
      code: "completed",
      severity: "ok",
      label: "当前 backlog 已完成",
      reason: scheduler.reason,
      reasonCode: "completed",
      autoAction: "等待新的 backlog 或重新分析",
      scheduler,
    });
  }

  const scheduler = buildSchedulerDescriptor(
    supervisorActive ? "idle_supervisor" : "idle",
    supervisorActive ? "后台待命中" : "等待新的可执行任务",
    "",
    {
      mode: supervisorActive ? "autonomous" : "manual",
      willAutoResume: supervisorActive,
      nextTaskId: normalizeText(nextTask?.id),
      nextTaskTitle: normalizeText(nextTask?.title),
    },
  );
  return finalizeStatusModel(base, {
    scheduler,
    schedulerLabel: scheduler.label,
    label: scheduler.label,
    autoAction: supervisorActive ? "系统正在等待新的状态变化" : "可重新分析或续跑",
  });
}

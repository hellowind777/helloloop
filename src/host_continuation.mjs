import path from "node:path";

import { ensureDir, fileExists, nowIso, readJson, sleep, writeJson, writeText } from "./common.mjs";
import { createContext } from "./context.mjs";
import { collectRepoStatusSnapshot } from "./runner_status.mjs";
import { deriveSessionStatusModel, formatStatusTimestamp, resolveCurrentActionLabel, resolveTodoProgress } from "./status_model.mjs";

const RESUME_DIR_NAME = "host-resume";
const SNAPSHOT_FILE_NAME = "resume.json";
const PROMPT_FILE_NAME = "resume-prompt.md";

const ISSUE_MATCHERS = [
  {
    code: "rate_limit",
    label: "429 / 限流或临时容量不足",
    patterns: ["429", "too many requests", "rate limit", "retry limit", "capacity"],
  },
  {
    code: "auth",
    label: "403 / 鉴权、订阅或权限异常",
    patterns: ["403", "forbidden", "subscription_not_found", "subscription", "not authenticated"],
  },
  {
    code: "server",
    label: "5xx / 服务端暂时异常",
    patterns: ["500", "502", "503", "504", "server error", "service unavailable", "bad gateway"],
  },
  {
    code: "network",
    label: "网络或流中断",
    patterns: ["network", "timeout", "timed out", "connection reset", "stream closed", "socket"],
  },
];

const RUNTIME_STATUS_LABELS = {
  recovering: "后台自动恢复中",
  suspected_stall: "疑似卡住，继续观察",
  watchdog_terminating: "watchdog 正在终止当前进程",
  watchdog_waiting: "watchdog 等待进程退出",
  retry_waiting: "等待自动重试",
  probe_waiting: "等待健康探测",
  probe_running: "正在健康探测",
  paused_operator: "已由操作员暂停",
  paused_manual: "自动恢复预算已耗尽",
  lease_terminating: "宿主租约失效，正在停止",
  stopped_host_closed: "宿主窗口已关闭",
  completed: "当前任务已完成",
  failed: "当前任务执行失败",
};

const FAILURE_CODE_LABELS = {
  watchdog_idle: "长时间无可见进展",
  rate_limit: "限流或临时容量不足",
  server: "服务端暂时异常",
  network: "网络或流中断",
  operator_paused: "已由操作员暂停",
  auth: "鉴权或权限异常",
  billing: "账单或额度异常",
  environment: "环境或权限异常",
  host_closed: "宿主窗口已关闭",
  unknown_failure: "未知失败",
};

function resumeRoot(context) {
  return path.join(context.configRoot, RESUME_DIR_NAME);
}

function resumeFiles(context) {
  const root = resumeRoot(context);
  return {
    root,
    snapshotFile: path.join(root, SNAPSHOT_FILE_NAME),
    promptFile: path.join(root, PROMPT_FILE_NAME),
  };
}

function normalizeText(value) {
  return String(value || "").trim();
}

function findIssue(summaryText) {
  const normalized = normalizeText(summaryText).toLowerCase();
  if (!normalized) {
    return null;
  }

  for (const matcher of ISSUE_MATCHERS) {
    if (matcher.patterns.some((pattern) => normalized.includes(String(pattern).toLowerCase()))) {
      return {
        code: matcher.code,
        label: matcher.label,
        summary: normalizeText(summaryText),
      };
    }
  }

  return {
    code: "unknown",
    label: "宿主中断或未知异常",
    summary: normalizeText(summaryText),
  };
}

function shouldInferIssue(snapshot, summaryText) {
  const normalized = normalizeText(summaryText).toLowerCase();
  if (!normalized) {
    return false;
  }

  if (["failed", "paused_manual", "probe_failed", "retry_waiting", "stopped_host_closed"].includes(
    normalizeText(snapshot?.runtime?.status),
  )) {
    return true;
  }
  if (["failed", "stopped"].includes(normalizeText(snapshot?.supervisor?.status))) {
    return true;
  }

  return ISSUE_MATCHERS.some((matcher) => matcher.patterns.some((pattern) => normalized.includes(String(pattern).toLowerCase())));
}

export function buildRuntimeDisplayLabel(runtime) {
  const status = normalizeText(runtime?.status).toLowerCase();
  if (!status || status === "running" || status === "idle") {
    return "";
  }
  const statusLabel = RUNTIME_STATUS_LABELS[status] || `运行状态：${status}`;
  if (status === "completed") {
    return statusLabel;
  }
  const details = [];
  const failureCode = normalizeText(runtime?.failureCode).toLowerCase();
  if (failureCode && FAILURE_CODE_LABELS[failureCode]) {
    details.push(FAILURE_CODE_LABELS[failureCode]);
  }
  if (runtime?.nextRetryAt) {
    details.push(`下次 ${formatStatusTimestamp(runtime.nextRetryAt)}`);
  }
  return normalizeText([statusLabel, ...details].join(" | "));
}

function buildRuntimeIssue(snapshot) {
  const status = normalizeText(snapshot?.runtime?.status).toLowerCase();
  if (!status) {
    return null;
  }
  if (["retry_waiting", "probe_waiting", "probe_running", "recovering", "watchdog_waiting", "watchdog_terminating", "lease_terminating"].includes(status)) {
    const label = RUNTIME_STATUS_LABELS[status] || "后台自动恢复中";
    const detailLines = [
      snapshot?.runtime?.failureReason || "",
      snapshot?.runtime?.nextRetryAt ? `预计重试：${formatStatusTimestamp(snapshot.runtime.nextRetryAt)}` : "",
    ].filter(Boolean);
    return {
      code: normalizeText(snapshot?.runtime?.failureCode || status) || status,
      label,
      summary: detailLines.join("\n"),
    };
  }
  return null;
}

export function buildDisplayCurrentAction(snapshot) {
  return normalizeText(
    buildRuntimeDisplayLabel(snapshot?.runtime)
    || resolveCurrentActionLabel(snapshot)
    || snapshot?.runtime?.failureReason
    || snapshot?.runtime?.status
    || snapshot?.supervisor?.status
    || "等待新事件",
  );
}

function buildRecentFiles(snapshot) {
  const changes = Array.isArray(snapshot?.activity?.recentFileChanges)
    ? snapshot.activity.recentFileChanges
    : [];
  const firstGroup = changes.find((item) => Array.isArray(item?.changes) && item.changes.length);
  if (!firstGroup) {
    return [];
  }
  return firstGroup.changes.slice(0, 5).map((item) => `${item.kind}:${item.path}`);
}

function buildPromptLines(context, hostResume) {
  const lines = [
    "继续刚才被主 CLI / 主终端中断的 HelloLoop 会话，不要从头重新分析，不要忘记刚才中断前的任务。",
    `目标仓库：${context.repoRoot}`,
    `后台会话 ID：${hostResume.sessionId || "unknown"}`,
    `后台命令：${hostResume.command || "unknown"}`,
    `后台状态：${hostResume.supervisorStatus || "unknown"}`,
    `当前任务：${hostResume.taskTitle || "无"}`,
    `当前阶段：${hostResume.stage || "unknown"}`,
    `当前动作：${hostResume.currentAction || "等待新事件"}`,
    `当前运行状态：${hostResume.runtimeStatus || "idle"}`,
  ];

  if (hostResume.statusModel?.label) {
    lines.push(`当前状态：${hostResume.statusModel.label}`);
  }
  if (hostResume.statusModel?.scheduler?.label) {
    lines.push(`调度语义：${hostResume.statusModel.scheduler.label}`);
  }
  if (hostResume.statusModel?.reason) {
    lines.push(`状态原因：${hostResume.statusModel.reason}`);
  }
  if (hostResume.statusModel?.failure?.label) {
    lines.push(`故障归类：${hostResume.statusModel.failure.label}`);
  }
  if (hostResume.statusModel?.autoAction) {
    lines.push(`自动动作：${hostResume.statusModel.autoAction}`);
  }
  if (hostResume.statusModel?.wait?.label) {
    lines.push(`等待状态：${hostResume.statusModel.wait.label}`);
  }
  if (hostResume.statusModel?.waitTargetLabel) {
    lines.push(`等待对象：${hostResume.statusModel.waitTargetLabel}`);
  }

  if (hostResume.issue?.label) {
    lines.push(`最近宿主异常：${hostResume.issue.label}`);
  }
  if (hostResume.issue?.summary) {
    lines.push(`异常摘要：${hostResume.issue.summary}`);
  }
  if (hostResume.todoLabel) {
    lines.push(`当前待办进度：${hostResume.todoLabel}`);
  }
  if (hostResume.nextTaskTitle) {
    lines.push(`下一任务：${hostResume.nextTaskTitle}`);
  }
  if (hostResume.recentFiles.length) {
    lines.push(`最近文件变化：${hostResume.recentFiles.join(" | ")}`);
  }

  lines.push("");
  lines.push("接续规则：");
  lines.push("1. 先读取 HelloLoop 当前状态；优先运行 `helloloop dashboard --json`，或至少运行 `helloloop status`。");
  if (hostResume.supervisorActive) {
    lines.push("2. 如果后台 supervisor 仍在运行，不要重复启动新的主线，只接续观察、汇报和必要控制。");
  } else {
    lines.push("2. 如果后台 supervisor 已停止，基于当前仓库和 backlog 从中断位置继续，不要重建无关任务。");
  }
  lines.push("3. 如果刚才是因为 429 / 403 / 网络抖动等宿主级异常中断，本轮要直接承接原任务，不要要求用户重复描述。");
  lines.push("4. 只有发现后台已停且需要恢复时，才重新执行 `helloloop run-loop` / `helloloop run-once` / `helloloop analyze -y`。");
  lines.push("5. 用户当前明确要求：继续刚才被中断之前的任务，并持续推进上面的开发工作。");

  return lines;
}

export function buildHostContinuationSnapshot(context, options = {}) {
  const snapshot = options.snapshot || collectRepoStatusSnapshot(context, options);
  const sessionId = normalizeText(options.sessionId || snapshot?.supervisor?.sessionId);
  const supervisorStatus = normalizeText(snapshot?.supervisor?.status);
  const runtimeStatus = normalizeText(snapshot?.runtime?.status || snapshot?.latestStatus?.stage || "idle");
  const currentAction = buildDisplayCurrentAction(snapshot);
  const todoLabel = resolveTodoProgress(snapshot);
  const issueSummary = [
    snapshot?.runtime?.failureReason,
    snapshot?.latestStatus?.message,
    snapshot?.runtime?.status,
    currentAction,
  ].filter(Boolean).join("\n");
  const issue = buildRuntimeIssue(snapshot)
    || (shouldInferIssue(snapshot, issueSummary)
    ? findIssue(issueSummary)
    : null);
  const recentFiles = buildRecentFiles(snapshot);
  const statusModel = deriveSessionStatusModel(snapshot);

  const hostResume = {
    schemaVersion: 1,
    generatedAt: nowIso(),
    repoRoot: context.repoRoot,
    repoName: path.basename(context.repoRoot),
    sessionId,
    command: normalizeText(snapshot?.supervisor?.command),
    supervisorStatus,
    supervisorActive: ["launching", "running"].includes(supervisorStatus),
    stage: normalizeText(snapshot?.latestStatus?.stage),
    taskId: snapshot?.latestStatus?.taskId || "",
    taskTitle: normalizeText(snapshot?.latestStatus?.taskTitle),
    runtimeStatus,
    currentAction,
    todoLabel,
    issue,
    statusModel,
    nextTaskId: snapshot?.nextTask?.id || "",
    nextTaskTitle: normalizeText(snapshot?.nextTask?.title),
    recentFiles,
    summary: snapshot?.summary || null,
    prompt: "",
  };

  hostResume.prompt = buildPromptLines(context, hostResume).join("\n");
  return hostResume;
}

export function refreshHostContinuationArtifacts(context, options = {}) {
  const hostResume = buildHostContinuationSnapshot(context, options);
  const files = resumeFiles(context);
  ensureDir(files.root);
  writeJson(files.snapshotFile, hostResume);
  writeText(files.promptFile, `${hostResume.prompt}\n`);
  return {
    ...hostResume,
    snapshotFile: files.snapshotFile,
    promptFile: files.promptFile,
  };
}

export function readHostContinuationSnapshot(context, options = {}) {
  const files = resumeFiles(context);
  if (!options.refresh && fileExists(files.snapshotFile)) {
    try {
      const loaded = readJson(files.snapshotFile);
      return {
        ...loaded,
        snapshotFile: files.snapshotFile,
        promptFile: files.promptFile,
      };
    } catch {
      // fallback to rebuilding below
    }
  }
  return refreshHostContinuationArtifacts(context, options);
}

export function renderHostContinuationText(hostResume) {
  return [
    "HelloLoop 宿主续跑提示",
    "======================",
    `仓库：${hostResume.repoRoot}`,
    `后台会话：${hostResume.sessionId || "unknown"}`,
    `后台命令：${hostResume.command || "unknown"}`,
    `后台状态：${hostResume.supervisorStatus || "unknown"}`,
    `当前任务：${hostResume.taskTitle || "无"}`,
    `当前阶段：${hostResume.stage || "unknown"}`,
    `当前动作：${hostResume.currentAction || "等待新事件"}`,
    ...(hostResume.statusModel?.label ? [`当前状态：${hostResume.statusModel.label}`] : []),
    ...(hostResume.statusModel?.scheduler?.label ? [`调度语义：${hostResume.statusModel.scheduler.label}`] : []),
    ...(hostResume.statusModel?.reason ? [`状态原因：${hostResume.statusModel.reason}`] : []),
    ...(hostResume.statusModel?.failure?.label ? [`故障归类：${hostResume.statusModel.failure.label}`] : []),
    ...(hostResume.statusModel?.wait?.label ? [`等待状态：${hostResume.statusModel.wait.label}`] : []),
    ...(hostResume.issue?.label ? [`最近异常：${hostResume.issue.label}`] : []),
    ...(hostResume.todoLabel ? [`当前待办：${hostResume.todoLabel}`] : []),
    ...(hostResume.nextTaskTitle ? [`下一任务：${hostResume.nextTaskTitle}`] : []),
    "",
    hostResume.prompt,
  ].filter(Boolean).join("\n");
}

function buildResumeSignature(hostResume) {
  return JSON.stringify({
    sessionId: hostResume.sessionId,
    supervisorStatus: hostResume.supervisorStatus,
    taskId: hostResume.taskId,
    stage: hostResume.stage,
    runtimeStatus: hostResume.runtimeStatus,
    currentAction: hostResume.currentAction,
    todoLabel: hostResume.todoLabel,
    issueCode: hostResume.issue?.code || "",
    nextTaskId: hostResume.nextTaskId,
  });
}

export async function runHostContinuationCommand(context, options = {}) {
  const pollMs = Math.max(500, Number(options.pollMs || options.watchPollMs || 2000));
  let previousSignature = "";

  while (true) {
    const hostResume = refreshHostContinuationArtifacts(context, options);
    const signature = buildResumeSignature(hostResume);

    if (signature !== previousSignature || !options.watch) {
      previousSignature = signature;
      if (options.json) {
        console.log(JSON.stringify(hostResume));
      } else {
        if (options.watch && process.stdout.isTTY) {
          process.stdout.write("\x1bc");
        }
        console.log(renderHostContinuationText(hostResume));
      }
    }

    if (!options.watch) {
      return 0;
    }

    await sleep(pollMs);
  }
}

export function buildDashboardHostContinuation(entry, repoSnapshot) {
  const context = createContext({
    repoRoot: entry.repoRoot,
    configDirName: entry.configDirName,
  });
  return buildHostContinuationSnapshot(context, {
    snapshot: repoSnapshot,
    sessionId: entry.sessionId,
  });
}

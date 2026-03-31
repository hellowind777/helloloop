import path from "node:path";

import { ensureDir, fileExists, nowIso, readJson, sleep, writeJson, writeText } from "./common.mjs";
import { createContext } from "./context.mjs";
import { collectRepoStatusSnapshot } from "./runner_status.mjs";

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

function buildCurrentAction(snapshot) {
  return normalizeText(
    snapshot?.activity?.current?.label
    || snapshot?.runtime?.failureReason
    || snapshot?.latestStatus?.message
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
  const currentAction = buildCurrentAction(snapshot);
  const todoCompleted = Number(snapshot?.activity?.todo?.completed || 0);
  const todoTotal = Number(snapshot?.activity?.todo?.total || 0);
  const todoLabel = todoTotal > 0 ? `${todoCompleted}/${todoTotal}` : "";
  const issueSummary = [
    snapshot?.runtime?.failureReason,
    snapshot?.latestStatus?.message,
    snapshot?.runtime?.status,
    currentAction,
  ].filter(Boolean).join("\n");
  const issue = shouldInferIssue(snapshot, issueSummary)
    ? findIssue(issueSummary)
    : null;
  const recentFiles = buildRecentFiles(snapshot);

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

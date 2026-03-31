import path from "node:path";

import { fileExists, readJson, sanitizeId, tailText, timestampForFile } from "./common.mjs";
import { renderTaskSummary, selectNextTask, summarizeBacklog } from "./backlog.mjs";
import { loadBacklog } from "./config.mjs";
import { renderHostLeaseLabel } from "./host_lease.mjs";

export function makeRunDir(context, taskId) {
  return path.join(context.runsDir, `${timestampForFile()}-${sanitizeId(taskId)}`);
}

export function makeAttemptDir(runDir, strategyIndex, attemptIndex) {
  return path.join(
    runDir,
    `strategy-${String(strategyIndex).padStart(2, "0")}-attempt-${String(attemptIndex).padStart(2, "0")}`,
  );
}

export function isHardStopFailure(kind, summary) {
  const normalized = String(summary || "").toLowerCase();
  if (!normalized) {
    return false;
  }
  if (kind === "engine" && normalized.includes("enoent")) {
    return true;
  }

  return [
    "command not found",
    "is not recognized",
    "无法将",
    "找不到路径",
    "no such file or directory",
    "permission denied",
    "access is denied",
  ].some((signal) => normalized.includes(signal));
}

export function buildFailureSummary(kind, payload) {
  if (kind !== "engine") {
    return payload.summary;
  }

  return [
    `${payload.displayName} 执行失败，退出码：${payload.code}`,
    payload.recoverySummary || "",
    "",
    "stdout 尾部：",
    tailText(payload.stdout, 60),
    "",
    "stderr 尾部：",
    tailText(payload.stderr, 60),
  ].join("\n").trim();
}

export function buildExhaustedSummary({
  failureHistory,
  maxStrategies,
  maxAttemptsPerStrategy,
}) {
  const lastFailure = failureHistory.at(-1)?.summary || "未知失败。";
  return [
    `已按 Ralph Loop 执行 ${maxStrategies} 轮策略、每轮最多 ${maxAttemptsPerStrategy} 次重试，当前任务仍未收敛。`,
    "",
    "最后一次失败信息：",
    lastFailure,
  ].join("\n").trim();
}

export function renderStatusMarkdown(context, { summary, currentTask, lastResult, nextTask }) {
  return [
    "## 当前状态",
    `- backlog 文件：${context.backlogFile.replaceAll("\\", "/")}`,
    `- 总任务数：${summary.total}`,
    `- 已完成：${summary.done}`,
    `- 待处理：${summary.pending}`,
    `- 进行中：${summary.inProgress}`,
    `- 失败：${summary.failed}`,
    `- 阻塞：${summary.blocked}`,
    `- 当前任务：${currentTask ? currentTask.title : "无"}`,
    `- 最近结果：${lastResult || "暂无"}`,
    `- 下一建议：${nextTask ? nextTask.title : "暂无可执行任务"}`,
  ].join("\n");
}

export function renderStatusText(context, options = {}) {
  const backlog = loadBacklog(context);
  const summary = summarizeBacklog(backlog);
  const nextTask = selectNextTask(backlog, options);
  const supervisor = fileExists(context.supervisorStateFile)
    ? readJson(context.supervisorStateFile)
    : null;
  const latestStatus = fileExists(context.statusFile)
    ? readJson(context.statusFile)
    : null;

  return [
    "HelloLoop 状态",
    "============",
    `仓库：${context.repoRoot}`,
    `总任务：${summary.total}`,
    `已完成：${summary.done}`,
    `待处理：${summary.pending}`,
    `进行中：${summary.inProgress}`,
    `失败：${summary.failed}`,
    `阻塞：${summary.blocked}`,
    ...(supervisor?.status
      ? [
        `后台会话：${supervisor.status}`,
        `后台会话 ID：${supervisor.sessionId || "unknown"}`,
        `后台租约：${renderHostLeaseLabel(supervisor.lease)}`,
      ]
      : []),
    ...(latestStatus?.taskTitle
      ? [
        `当前运行任务：${latestStatus.taskTitle}`,
        `当前运行目录：${latestStatus.runDir || "unknown"}`,
        `当前运行阶段：${latestStatus.stage || "unknown"}`,
      ]
      : []),
    "",
    nextTask ? "下一任务：" : "下一任务：无",
    nextTask ? renderTaskSummary(nextTask) : "",
    "",
    "实时观察：helloloop watch",
  ].filter(Boolean).join("\n");
}

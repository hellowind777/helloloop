import path from "node:path";

import {
  readJsonIfExists,
  selectLatestActivityFile,
  selectLatestRuntimeFile,
} from "./activity_projection.mjs";
import { fileExists, readJson, sanitizeId, tailText, timestampForFile } from "./common.mjs";
import { analyzeAutomationExecution, renderTaskSummary, selectAutomationNextTask, selectNextTask, summarizeBacklog } from "./backlog.mjs";
import { loadBacklog, loadProjectConfig } from "./config.mjs";
import { renderHostLeaseLabel } from "./host_lease.mjs";
import { deriveSessionStatusModel } from "./status_model.mjs";
import { readSupervisorPause } from "./supervisor_state.mjs";
import { backfillWorkflowArtifacts } from "./workflow_model.mjs";

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

export function collectRepoStatusSnapshot(context, options = {}) {
  const backlog = loadBacklog(context);
  const projectConfig = loadProjectConfig(context);
  const summary = summarizeBacklog(backlog);
  const nextTask = selectNextTask(backlog, options);
  const automationExecution = analyzeAutomationExecution(backlog, options);
  const automationNextTask = selectAutomationNextTask(backlog, options);
  const supervisor = fileExists(context.supervisorStateFile) ? readJson(context.supervisorStateFile) : null;
  const latestStatus = fileExists(context.statusFile) ? readJson(context.statusFile) : null;
  const runtimeFile = latestStatus?.runDir ? selectLatestRuntimeFile(latestStatus.runDir) : "";
  const runtime = readJsonIfExists(runtimeFile);
  const activityFile = runtime?.activityFile && fileExists(runtime.activityFile)
    ? runtime.activityFile
    : (latestStatus?.runDir ? selectLatestActivityFile(latestStatus.runDir, runtime?.attemptPrefix || "") : "");
  const activity = readJsonIfExists(activityFile);
  const pauseControl = readSupervisorPause(context);
  const tasks = Array.isArray(backlog.tasks) ? backlog.tasks : [];
  const execution = automationExecution;
  const workflowArtifacts = backfillWorkflowArtifacts({
    repoRoot: context.repoRoot,
    workflow: backlog.workflow || projectConfig.workflow || null,
    docAnalysis: backlog.docAnalysis || projectConfig.docAnalysis || null,
    tasks,
    requiredDocs: projectConfig.requiredDocs,
  });
  const statusModel = deriveSessionStatusModel({
    summary,
    nextTask: automationNextTask || nextTask,
    supervisor,
    latestStatus,
    runtime,
    activity,
    pauseControl,
    tasks,
    execution,
    automationExecution,
  });

  return {
    summary,
    nextTask,
    automationNextTask,
    tasks,
    execution,
    automationExecution,
    workflow: workflowArtifacts.workflow,
    docAnalysis: workflowArtifacts.docAnalysis,
    supervisor,
    latestStatus,
    runtimeFile,
    runtime,
    activityFile,
    activity,
    pauseControl,
    statusModel,
  };
}

export function renderStatusText(context, options = {}) {
  const snapshot = collectRepoStatusSnapshot(context, options);
  const {
    summary,
    nextTask,
    automationNextTask,
    supervisor,
    latestStatus,
    runtime,
    activity,
    workflow,
    docAnalysis,
    statusModel,
  } = snapshot;
  const hostResume = options.hostResume || null;

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
    ...(workflow?.profileLabel
      ? [`工作流画像：${workflow.profileLabel}`]
      : []),
    ...(workflow?.currentFocus
      ? [`主线焦点：${workflow.currentFocus}`]
      : []),
    ...(workflow?.parallelLanes?.length
      ? [`并行 lane：${workflow.parallelLanes.join(" / ")}`]
      : []),
    ...(docAnalysis?.summary
      ? [`文档画像：${docAnalysis.summary}`]
      : []),
    ...(supervisor?.status
      ? [
        `后台会话：${supervisor.status}`,
        `后台会话 ID：${supervisor.sessionId || "unknown"}`,
        `后台租约：${renderHostLeaseLabel(supervisor.lease)}`,
        ...(Number.isFinite(Number(supervisor.guardianRestartCount)) && Number(supervisor.guardianRestartCount) > 0
          ? [`守护重拉起次数：${supervisor.guardianRestartCount}`]
          : []),
      ]
      : []),
    ...(latestStatus?.taskTitle
      ? [
        `当前运行任务：${latestStatus.taskTitle}`,
        `当前运行目录：${latestStatus.runDir || "unknown"}`,
        `当前运行阶段：${latestStatus.stage || "unknown"}`,
      ]
      : []),
    ...(runtime?.status
      ? [
        `当前引擎状态：${runtime.status}`,
        ...(Number.isFinite(Number(runtime.recoveryCount))
          ? [`自动恢复次数：${runtime.recoveryCount}`]
          : []),
      ]
      : []),
    ...(statusModel?.label
      ? [`当前状态：${statusModel.label}`]
      : []),
    ...(statusModel?.scheduler?.label
      ? [`调度语义：${statusModel.scheduler.label}`]
      : []),
    ...(statusModel?.reason
      ? [`状态原因：${statusModel.reason}`]
      : []),
    ...(statusModel?.detail
      ? [`状态细节：${statusModel.detail}`]
      : []),
    ...(statusModel?.failure?.label
      ? [`故障归类：${statusModel.failure.label}`]
      : []),
    ...(statusModel?.autoAction
      ? [`自动动作：${statusModel.autoAction}`]
      : []),
    ...(statusModel?.wait?.label
      ? [`等待状态：${statusModel.wait.label}`]
      : []),
    ...(statusModel?.waitTargetLabel
      ? [`等待对象：${statusModel.waitTargetLabel}`]
      : []),
    ...(statusModel?.currentAction
      ? [`当前动作：${statusModel.currentAction}`]
      : []),
    ...(statusModel?.todoProgress
      ? [`步骤进度：${statusModel.todoProgress}`]
      : []),
    ...(Array.isArray(activity?.activeCommands) && activity.activeCommands[0]?.label
      ? [`活动命令：${activity.activeCommands[0].label}`]
      : []),
    ...(hostResume?.issue?.label
      ? [`宿主续跑：${hostResume.issue.label}`]
      : (hostResume?.supervisorActive ? ["宿主续跑：后台仍在运行，可直接接续观察"] : [])),
    "",
    (automationNextTask || nextTask) ? "下一任务：" : "下一任务：无",
    (automationNextTask || nextTask) ? renderTaskSummary(automationNextTask || nextTask) : "",
    "",
    "聚合看板：helloloop dashboard",
    "续跑提示：helloloop resume-host",
    "实时观察：helloloop watch",
  ].filter(Boolean).join("\n");
}

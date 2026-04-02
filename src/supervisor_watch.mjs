import fs from "node:fs";
import path from "node:path";

import {
  readJsonIfExists,
  selectLatestActivityFile,
  selectLatestRuntimeFile,
} from "./activity_projection.mjs";
import { fileExists, sleep } from "./common.mjs";
import { renderHostLeaseLabel } from "./host_lease.mjs";
import { loadRuntimeSettings } from "./runtime_settings_loader.mjs";
import { hasRetryBudget, pickRetryDelaySeconds } from "./runtime_settings.mjs";
import { FINAL_SUPERVISOR_STATUSES } from "./supervisor_state.mjs";

function writeLine(stream, message) {
  stream.write(`${message}\n`);
}

function buildSessionSummary(supervisor) {
  if (!supervisor?.sessionId) {
    return "";
  }

  return [
    `[HelloLoop watch] 已附着后台会话：${supervisor.sessionId}`,
    `[HelloLoop watch] 宿主租约：${renderHostLeaseLabel(supervisor.lease)}`,
  ].join("\n");
}

function formatSupervisorState(supervisor) {
  if (!supervisor?.status) {
    return "";
  }

  const label = {
    launching: "后台 supervisor 启动中",
    running: "后台 supervisor 正在运行",
    completed: "后台 supervisor 已完成",
    failed: "后台 supervisor 执行失败",
    stopped: "后台 supervisor 已停止",
  }[String(supervisor.status)] || `后台 supervisor 状态：${supervisor.status}`;

  const suffix = supervisor.message ? `：${supervisor.message}` : "";
  return `[HelloLoop watch] ${label}${suffix}`;
}

function formatTaskStatus(status) {
  if (!status?.taskTitle) {
    return "";
  }

  const lines = [`[HelloLoop watch] 当前任务：${status.taskTitle}`];
  if (status.runDir) {
    lines.push(`[HelloLoop watch] 运行目录：${status.runDir}`);
  }
  if (status.stage) {
    lines.push(`[HelloLoop watch] 阶段：${status.stage}`);
  }
  return lines.join("\n");
}

function formatRuntimeState(runtime, previousRuntime) {
  if (!runtime?.status) {
    return "";
  }

  const idleSeconds = Number(runtime?.heartbeat?.idleSeconds || 0);
  const idleBucket = Math.floor(idleSeconds / 30);
  const previousIdleBucket = Math.floor(Number(previousRuntime?.heartbeat?.idleSeconds || 0) / 30);
  const signature = [
    runtime.status,
    runtime.attemptPrefix || "",
    runtime.recoveryCount || 0,
    runtime.failureCode || "",
    runtime.failureReason || "",
    runtime.nextRetryAt || "",
    runtime.notification?.reason || "",
  ].join("|");
  const previousSignature = previousRuntime
    ? [
      previousRuntime.status,
      previousRuntime.attemptPrefix || "",
      previousRuntime.recoveryCount || 0,
      previousRuntime.failureCode || "",
      previousRuntime.failureReason || "",
      previousRuntime.nextRetryAt || "",
      previousRuntime.notification?.reason || "",
    ].join("|")
    : "";

  if (signature === previousSignature && (runtime.status !== "running" || idleBucket === previousIdleBucket || idleBucket === 0)) {
    return "";
  }

  if (runtime.status === "running") {
    if (idleBucket === 0 || idleBucket === previousIdleBucket) {
      return "";
    }
    return `[HelloLoop watch] 仍在执行：${runtime.attemptPrefix || "当前尝试"}，最近输出距今约 ${idleBucket * 30} 秒`;
  }

  const labels = {
    recovering: "进入同引擎恢复",
    suspected_stall: "疑似卡住，继续观察",
    watchdog_terminating: "触发 watchdog，准备终止当前子进程",
    watchdog_waiting: "watchdog 等待子进程退出",
    retry_waiting: "等待自动重试",
    probe_waiting: "准备执行健康探测",
    probe_running: "正在执行健康探测",
    paused_operator: "主线已由操作员暂停",
    paused_manual: "自动恢复预算已耗尽，任务暂停",
    lease_terminating: "宿主租约失效，正在停止当前子进程",
    stopped_host_closed: "宿主窗口已关闭，后台任务停止",
    completed: "当前任务执行完成",
    failed: "当前任务执行失败",
  };
  const label = labels[String(runtime.status)] || `运行状态更新：${runtime.status}`;
  const details = [
    runtime.attemptPrefix ? `attempt=${runtime.attemptPrefix}` : "",
    Number.isFinite(Number(runtime.recoveryCount)) ? `recovery=${runtime.recoveryCount}` : "",
    runtime.nextRetryAt ? `next=${runtime.nextRetryAt}` : "",
    runtime.failureReason || "",
  ].filter(Boolean).join(" | ");

  return `[HelloLoop watch] ${label}${details ? ` | ${details}` : ""}`;
}

function formatActivityState(activity, previousActivity) {
  if (!activity?.current?.label && !activity?.todo?.total) {
    return "";
  }

  const activeCommandLabel = Array.isArray(activity?.activeCommands) ? activity.activeCommands[0]?.label || "" : "";
  const signature = [
    activity.current?.status || "",
    activity.current?.label || "",
    activity.todo?.completed || 0,
    activity.todo?.total || 0,
    activeCommandLabel,
  ].join("|");
  const previousSignature = previousActivity
    ? [
      previousActivity.current?.status || "",
      previousActivity.current?.label || "",
      previousActivity.todo?.completed || 0,
      previousActivity.todo?.total || 0,
      Array.isArray(previousActivity?.activeCommands) ? previousActivity.activeCommands[0]?.label || "" : "",
    ].join("|")
    : "";

  if (signature === previousSignature) {
    return "";
  }

  const details = [];
  if (activity.todo?.total) {
    details.push(`todo=${activity.todo.completed}/${activity.todo.total}`);
  }
  if (activeCommandLabel) {
    details.push(`cmd=${activeCommandLabel}`);
  }

  return `[HelloLoop watch] 当前动作：${activity.current?.label || "等待事件"}${details.length ? ` | ${details.join(" | ")}` : ""}`;
}

function readTextDelta(filePath, offset) {
  if (!filePath || !fileExists(filePath)) {
    return { nextOffset: 0, text: "" };
  }

  const stats = fs.statSync(filePath);
  if (stats.size <= 0) {
    return { nextOffset: 0, text: "" };
  }

  const start = Math.max(0, Math.min(Number(offset || 0), stats.size));
  if (stats.size === start) {
    return { nextOffset: start, text: "" };
  }

  const handle = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(stats.size - start);
    fs.readSync(handle, buffer, 0, buffer.length, start);
    return {
      nextOffset: stats.size,
      text: buffer.toString("utf8"),
    };
  } finally {
    fs.closeSync(handle);
  }
}

function readAndWriteDelta(cursor, filePath, stream) {
  if (cursor.file !== filePath) {
    cursor.file = filePath || "";
    cursor.offset = 0;
  }

  if (!filePath) {
    return;
  }

  const delta = readTextDelta(filePath, cursor.offset);
  cursor.offset = delta.nextOffset;
  if (!delta.text) {
    return;
  }

  stream.write(delta.text);
  if (!delta.text.endsWith("\n")) {
    stream.write("\n");
  }
}

function resolveStatusForSession(status, sessionId) {
  if (!status) {
    return null;
  }
  if (!sessionId || !status.sessionId || status.sessionId === sessionId) {
    return status;
  }
  return null;
}

function buildWatchResult(supervisor, result) {
  const exitCode = Number(result?.exitCode ?? supervisor?.exitCode ?? (supervisor?.status === "completed" ? 0 : 1));
  return {
    sessionId: result?.sessionId || supervisor?.sessionId || "",
    status: result?.ok === true
      ? "completed"
      : (supervisor?.status || (exitCode === 0 ? "completed" : "failed")),
    ok: result?.ok === true || exitCode === 0,
    exitCode,
  };
}

export async function watchSupervisorSession(context, options = {}) {
  const pollMs = Math.max(200, Number(options.pollMs || 1000));
  const stdoutStream = options.stdoutStream || process.stdout;
  const stderrStream = options.stderrStream || process.stderr;
  const expectedSessionId = String(options.sessionId || "").trim();
  const stdoutCursor = { file: "", offset: 0 };
  const stderrCursor = { file: "", offset: 0 };
  let printedSessionId = "";
  let lastSupervisorSignature = "";
  let lastTaskSignature = "";
  let previousRuntime = null;
  let previousActivity = null;
  let missingPolls = 0;

  while (true) {
    const supervisor = readJsonIfExists(context.supervisorStateFile);
    const result = readJsonIfExists(context.supervisorResultFile);
    const activeSessionId = expectedSessionId || supervisor?.sessionId || result?.sessionId || "";
    const taskStatus = resolveStatusForSession(readJsonIfExists(context.statusFile), activeSessionId);
    const runtimeFile = taskStatus?.runDir ? selectLatestRuntimeFile(taskStatus.runDir) : "";
    const runtime = readJsonIfExists(runtimeFile);
    const activityFile = runtime?.activityFile && fileExists(runtime.activityFile)
      ? runtime.activityFile
      : (taskStatus?.runDir ? selectLatestActivityFile(taskStatus.runDir, runtime?.attemptPrefix || "") : "");
    const activity = readJsonIfExists(activityFile);

    if (!supervisor && !result) {
      missingPolls += 1;
      if (missingPolls >= 3) {
        return {
          sessionId: activeSessionId,
          status: "",
          ok: false,
          exitCode: 1,
          empty: true,
        };
      }
      await sleep(pollMs);
      continue;
    }
    missingPolls = 0;

    if (supervisor?.sessionId && supervisor.sessionId !== printedSessionId) {
      printedSessionId = supervisor.sessionId;
      writeLine(stdoutStream, buildSessionSummary(supervisor));
    }

    const supervisorSignature = supervisor
      ? [supervisor.sessionId || "", supervisor.status || "", supervisor.message || ""].join("|")
      : "";
    if (supervisorSignature && supervisorSignature !== lastSupervisorSignature) {
      lastSupervisorSignature = supervisorSignature;
      writeLine(stdoutStream, formatSupervisorState(supervisor));
    }

    const taskSignature = taskStatus
      ? [taskStatus.sessionId || "", taskStatus.taskId || "", taskStatus.taskTitle || "", taskStatus.runDir || "", taskStatus.stage || ""].join("|")
      : "";
    if (taskSignature && taskSignature !== lastTaskSignature) {
      lastTaskSignature = taskSignature;
      writeLine(stdoutStream, formatTaskStatus(taskStatus));
    }

    const runtimeMessage = formatRuntimeState(runtime, previousRuntime);
    if (runtimeMessage) {
      writeLine(stdoutStream, runtimeMessage);
    }
    previousRuntime = runtime || previousRuntime;
    const activityMessage = formatActivityState(activity, previousActivity);
    if (activityMessage) {
      writeLine(stdoutStream, activityMessage);
    }
    previousActivity = activity || previousActivity;

    const activePrefix = runtime?.attemptPrefix || "";
    const runtimeDir = runtimeFile ? path.dirname(runtimeFile) : "";
    const stdoutFile = runtimeDir && activePrefix
      ? path.join(runtimeDir, `${activePrefix}-stdout.log`)
      : "";
    const stderrFile = runtimeDir && activePrefix
      ? path.join(runtimeDir, `${activePrefix}-stderr.log`)
      : "";

    readAndWriteDelta(stdoutCursor, stdoutFile, stdoutStream);
    readAndWriteDelta(stderrCursor, stderrFile, stderrStream);

    if (supervisor?.status && FINAL_SUPERVISOR_STATUSES.has(String(supervisor.status))) {
      readAndWriteDelta(stdoutCursor, stdoutFile, stdoutStream);
      readAndWriteDelta(stderrCursor, stderrFile, stderrStream);
      return buildWatchResult(supervisor, result);
    }

    await sleep(pollMs);
  }
}

function formatRetryAttachMessage(options, attemptNumber, delaySeconds) {
  const sessionLabel = String(options.sessionId || "").trim();
  const targetLabel = sessionLabel
    ? `后台会话 ${sessionLabel}`
    : "后台会话";
  return `[HelloLoop watch] 暂未检测到可附着的${targetLabel}，将在 ${delaySeconds} 秒后自动重试（第 ${attemptNumber} 次）。`;
}

export async function watchSupervisorSessionWithRecovery(context, options = {}) {
  const observerRetry = loadRuntimeSettings({
    globalConfigFile: options.globalConfigFile,
  }).observerRetry;
  const stdoutStream = options.stdoutStream || process.stdout;
  let retryCount = 0;

  while (true) {
    const result = await watchSupervisorSession(context, options);
    if (!result.empty) {
      return result;
    }

    const nextAttempt = retryCount + 1;
    if (!observerRetry.enabled || !hasRetryBudget(observerRetry.maxRetryCount, nextAttempt)) {
      return result;
    }

    const delaySeconds = pickRetryDelaySeconds(observerRetry.retryDelaysSeconds, nextAttempt);
    writeLine(stdoutStream, formatRetryAttachMessage(options, nextAttempt, delaySeconds));
    retryCount = nextAttempt;
    await sleep(delaySeconds * 1000);
  }
}

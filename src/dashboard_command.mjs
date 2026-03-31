import path from "node:path";

import { nowIso, sleep } from "./common.mjs";
import { createContext } from "./context.mjs";
import { analyzeExecution } from "./backlog.mjs";
import { loadBacklog } from "./config.mjs";
import { buildDashboardHostContinuation } from "./host_continuation.mjs";
import { loadRuntimeSettings } from "./runtime_settings_loader.mjs";
import { collectRepoStatusSnapshot } from "./runner_status.mjs";
import { hasRetryBudget, pickRetryDelaySeconds } from "./runtime_settings.mjs";
import { isTrackedPidAlive } from "./supervisor_state.mjs";
import { listActiveSessionEntries, listKnownWorkspaceEntries } from "./workspace_registry.mjs";

function formatRuntimeLabel(runtime) {
  if (!runtime?.status) {
    return "idle";
  }
  const details = [runtime.status];
  if (Number.isFinite(Number(runtime.recoveryCount)) && Number(runtime.recoveryCount) > 0) {
    details.push(`recovery=${runtime.recoveryCount}`);
  }
  if (Number.isFinite(Number(runtime?.heartbeat?.idleSeconds)) && Number(runtime.heartbeat.idleSeconds) > 0) {
    details.push(`idle=${runtime.heartbeat.idleSeconds}s`);
  }
  return details.join(" | ");
}

function formatCurrentAction(session) {
  return session.activity?.current?.label
    || session.runtime?.failureReason
    || session.latestStatus?.message
    || session.runtime?.status
    || "等待新事件";
}

function formatTodoLabel(activity) {
  if (!activity?.todo?.total) {
    return "";
  }
  return `${activity.todo.completed}/${activity.todo.total}`;
}

function readBacklogSnapshot(context) {
  try {
    const backlog = loadBacklog(context);
    return {
      tasks: Array.isArray(backlog.tasks) ? backlog.tasks : [],
      execution: analyzeExecution(backlog),
    };
  } catch {
    return {
      tasks: [],
      execution: null,
    };
  }
}

function normalizeSupervisorSnapshot(supervisor) {
  if (!supervisor?.status) {
    return supervisor;
  }
  if (["launching", "running"].includes(String(supervisor.status)) && !isTrackedPidAlive(supervisor.guardianPid || supervisor.pid)) {
    return {
      ...supervisor,
      status: "stopped",
      message: supervisor.message || "后台会话当前未运行。",
    };
  }
  return supervisor;
}

function normalizeRuntimeSnapshot(supervisor, runtime) {
  if (!runtime) {
    return runtime;
  }
  if (!supervisor?.status || supervisor.status !== "stopped") {
    return runtime;
  }
  if (!["launching", "running", "recovering", "probe_running", "probe_waiting", "retry_waiting"].includes(String(runtime.status || ""))) {
    return runtime;
  }

  const stoppedReason = "后台 supervisor 当前未运行；以下展示的是最近一次执行快照。";
  return {
    ...runtime,
    status: "stopped",
    failureReason: runtime.failureReason || stoppedReason,
    heartbeat: runtime.heartbeat
      ? {
        ...runtime.heartbeat,
        status: "stopped",
        leaseExpired: true,
        leaseReason: runtime.heartbeat.leaseReason || stoppedReason,
      }
      : runtime.heartbeat,
  };
}

function normalizeActivitySnapshot(supervisor, activity) {
  if (!activity) {
    return activity;
  }
  if (!supervisor?.status || supervisor.status !== "stopped") {
    return activity;
  }
  if (String(activity.status || "") !== "running") {
    return activity;
  }

  return {
    ...activity,
    status: "stopped",
    runtime: activity.runtime
      ? {
        ...activity.runtime,
        status: "stopped",
      }
      : activity.runtime,
  };
}

function buildSessionSnapshot(entry) {
  const context = createContext({
    repoRoot: entry.repoRoot,
    configDirName: entry.configDirName,
  });
  let repoSnapshot;
  try {
    repoSnapshot = collectRepoStatusSnapshot(context, {
      sessionId: entry.sessionId,
    });
  } catch (error) {
    repoSnapshot = {
      supervisor: null,
      latestStatus: {
        message: String(error?.message || error || "状态读取失败。"),
      },
      runtime: null,
      activity: null,
      summary: null,
      nextTask: null,
    };
  }
  const backlogSnapshot = readBacklogSnapshot(context);
  const supervisor = normalizeSupervisorSnapshot(repoSnapshot.supervisor);
  const runtime = normalizeRuntimeSnapshot(supervisor, repoSnapshot.runtime);
  const activity = normalizeActivitySnapshot(supervisor, repoSnapshot.activity);
  const snapshotForContinuation = {
    ...repoSnapshot,
    supervisor,
    runtime,
    activity,
  };

  return {
    repoRoot: entry.repoRoot,
    repoName: path.basename(entry.repoRoot),
    sessionId: entry.sessionId || repoSnapshot.latestStatus?.sessionId || "",
    command: entry.command || supervisor?.command || "",
    supervisor,
    latestStatus: repoSnapshot.latestStatus,
    runtime,
    activity,
    summary: repoSnapshot.summary,
    nextTask: repoSnapshot.nextTask,
    tasks: backlogSnapshot.tasks,
    execution: backlogSnapshot.execution,
    isActive: entry.isActive === true,
    hostResume: buildDashboardHostContinuation(entry, snapshotForContinuation),
    updatedAt: repoSnapshot.activity?.updatedAt
      || repoSnapshot.runtime?.updatedAt
      || repoSnapshot.latestStatus?.updatedAt
      || supervisor?.updatedAt
      || entry.updatedAt
      || "",
  };
}

function buildTaskTotals(sessions) {
  const totals = {
    total: 0,
    pending: 0,
    inProgress: 0,
    done: 0,
    failed: 0,
    blocked: 0,
  };

  for (const session of sessions) {
    totals.total += Number(session.summary?.total || 0);
    totals.pending += Number(session.summary?.pending || 0);
    totals.inProgress += Number(session.summary?.inProgress || 0);
    totals.done += Number(session.summary?.done || 0);
    totals.failed += Number(session.summary?.failed || 0);
    totals.blocked += Number(session.summary?.blocked || 0);
  }

  return totals;
}

export function collectDashboardSnapshot() {
  const activeEntries = listActiveSessionEntries()
    .map((entry) => ({ ...entry, isActive: true }));
  const knownEntries = listKnownWorkspaceEntries()
    .map((entry) => ({ ...entry, isActive: false }));
  const mergedEntries = new Map();

  for (const entry of [...knownEntries, ...activeEntries]) {
    const key = `${entry.repoRoot}::${entry.configDirName || ""}`;
    const current = mergedEntries.get(key) || {};
    mergedEntries.set(key, {
      ...current,
      ...entry,
      isActive: entry.isActive === true || current.isActive === true,
    });
  }

  const sessions = [...mergedEntries.values()]
    .map((entry) => buildSessionSnapshot(entry))
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));

  return {
    schemaVersion: 1,
    generatedAt: nowIso(),
    activeCount: activeEntries.length,
    repoCount: sessions.length,
    taskTotals: buildTaskTotals(sessions),
    primaryHostResume: sessions[0]?.hostResume || null,
    sessions,
  };
}

function renderCompactSession(session, index) {
  return [
    `${index + 1}. ${session.repoName}`,
    `   session=${session.sessionId}`,
    `   task=${session.latestStatus?.taskTitle || "无"}`,
    `   runtime=${formatRuntimeLabel(session.runtime)}`,
    `   action=${formatCurrentAction(session)}`,
    ...(formatTodoLabel(session.activity) ? [`   todo=${formatTodoLabel(session.activity)}`] : []),
  ].join("\n");
}

function renderDetailedSession(session, index, options) {
  const lines = [
    `[${index + 1}] ${session.repoName}`,
    `- 仓库：${session.repoRoot}`,
    `- 会话：${session.sessionId}`,
    `- supervisor：${session.supervisor?.status || "unknown"}`,
    `- 命令：${session.command || "unknown"}`,
    `- 当前任务：${session.latestStatus?.taskTitle || "无"}`,
    `- 当前阶段：${session.latestStatus?.stage || "unknown"}`,
    `- backlog：已完成 ${session.summary?.done || 0} / 总计 ${session.summary?.total || 0} / 待处理 ${session.summary?.pending || 0}`,
    `- 运行状态：${formatRuntimeLabel(session.runtime)}`,
    `- 当前动作：${formatCurrentAction(session)}`,
    `- 宿主续跑：${session.hostResume?.issue?.label || (session.hostResume?.supervisorActive ? "后台仍在运行，可直接接续观察" : "需要按续跑提示继续")}`,
  ];

  if (formatTodoLabel(session.activity)) {
    lines.push(`- 当前待办：${formatTodoLabel(session.activity)}`);
  }
  if (Array.isArray(session.activity?.activeCommands) && session.activity.activeCommands[0]?.label) {
    lines.push(`- 活动命令：${session.activity.activeCommands[0].label}`);
  }
  if (Array.isArray(session.activity?.recentFileChanges) && session.activity.recentFileChanges[0]?.changes?.length) {
    const fileLabels = session.activity.recentFileChanges[0].changes
      .slice(0, 3)
      .map((item) => `${item.kind}:${item.path}`);
    lines.push(`- 最近文件：${fileLabels.join(" | ")}`);
  }
  if (options.events && Array.isArray(session.activity?.recentEvents) && session.activity.recentEvents.length) {
    lines.push("- 最近事件：");
    for (const event of session.activity.recentEvents.slice(-5)) {
      lines.push(`  - [${event.status || "info"}] ${event.kind}: ${event.label}`);
    }
  }

  return lines.join("\n");
}

export function renderDashboardText(snapshot, options = {}) {
  const lines = [
    "HelloLoop Dashboard",
    "===================",
    `仓库总数：${snapshot.repoCount}`,
    `活跃会话：${snapshot.activeCount}`,
    `更新时间：${snapshot.generatedAt}`,
  ];

  if (!snapshot.sessions.length) {
    lines.push("");
    lines.push("当前没有已登记仓库或后台会话。");
    return lines.join("\n");
  }

  for (const [index, session] of snapshot.sessions.entries()) {
    lines.push("");
    lines.push(options.compact
      ? renderCompactSession(session, index)
      : renderDetailedSession(session, index, options));
  }

  return lines.join("\n");
}

export function buildDashboardSnapshotSignature(snapshot) {
  return JSON.stringify(snapshot.sessions.map((session) => ({
    repoRoot: session.repoRoot,
    sessionId: session.sessionId,
    taskId: session.latestStatus?.taskId || "",
    stage: session.latestStatus?.stage || "",
    runtimeStatus: session.runtime?.status || "",
    idleSeconds: session.runtime?.heartbeat?.idleSeconds || 0,
    action: session.activity?.current?.label || "",
    todoCompleted: session.activity?.todo?.completed || 0,
    todoTotal: session.activity?.todo?.total || 0,
    eventLabel: session.activity?.recentEvents?.at(-1)?.label || "",
    resumeIssue: session.hostResume?.issue?.code || "",
    taskFingerprint: (session.tasks || [])
      .map((task) => `${task.id}:${task.status || "pending"}:${task.title}`)
      .join("|"),
  })));
}

export async function runDashboardCommand(options = {}) {
  const pollMs = Math.max(500, Number(options.pollMs || options.watchPollMs || 2000));
  const observerRetry = loadRuntimeSettings({
    globalConfigFile: options.globalConfigFile,
  }).observerRetry;
  let previousSignature = "";
  let retryCount = 0;

  while (true) {
    try {
      const snapshot = collectDashboardSnapshot();
      const signature = buildDashboardSnapshotSignature(snapshot);
      retryCount = 0;

      if (signature !== previousSignature || !options.watch) {
        previousSignature = signature;
        if (options.json) {
          console.log(JSON.stringify(snapshot));
        } else {
          if (options.watch && process.stdout.isTTY) {
            process.stdout.write("\x1bc");
          }
          console.log(renderDashboardText(snapshot, options));
        }
      }
    } catch (error) {
      const nextAttempt = retryCount + 1;
      if (!options.watch || !observerRetry.enabled || !hasRetryBudget(observerRetry.maxRetryCount, nextAttempt)) {
        throw error;
      }

      const delaySeconds = pickRetryDelaySeconds(observerRetry.retryDelaysSeconds, nextAttempt);
      process.stderr.write(
        `[HelloLoop dashboard] 看板采集失败，将在 ${delaySeconds} 秒后自动重试（第 ${nextAttempt} 次）：${String(error?.message || error || "unknown error")}\n`,
      );
      retryCount = nextAttempt;
      await sleep(delaySeconds * 1000);
      continue;
    }

    if (!options.watch) {
      return 0;
    }

    await sleep(pollMs);
  }
}

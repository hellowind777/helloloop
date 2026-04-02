export function resolveView() {
  return localStorage.getItem("hello-app-view") || "command-center";
}

export function defaultSettings(state) {
  return {
    locale: state.locale || "zh-CN",
    theme: state.theme || "light",
    preferred_host: "codex",
    scheduler_mode: "central_supervisor",
    retry_policy: "balanced",
    notifications_enabled: true,
    tray_launch_on_start: true,
    daemon_auto_start: true,
    refresh_interval_seconds: 5,
  };
}

export function normalizeSettings(state, settings) {
  return {
    ...defaultSettings(state),
    ...(settings || {}),
    refresh_interval_seconds: Math.max(3, Number(settings?.refresh_interval_seconds || 5)),
  };
}

export function normalizeWorkspaceSnapshot(workspace) {
  const workflow = workspace?.workflow || {};
  const docAnalysis = workspace?.docAnalysis || workspace?.doc_analysis || {};

  return {
    repoRoot: workspace?.repoRoot || "",
    repoName: workspace?.repoName || "",
    configDirName: workspace?.configDirName || "",
    engine: workspace?.engine || "",
    summary: workspace?.summary || null,
    nextTask: workspace?.nextTask || null,
    automationNextTask: workspace?.automationNextTask || null,
    tasks: Array.isArray(workspace?.tasks) ? workspace.tasks : [],
    workflow: {
      currentFocus: workflow.currentFocus || "",
      mainlineSummary: workflow.mainlineSummary || "",
      profileLabel: workflow.profileLabel || "",
      methodology: workflow.methodology || "",
      profile: workflow.profile || "",
      orchestrationMode: workflow.orchestrationMode || "",
      parallelStrategy: workflow.parallelStrategy || "",
      docCoverageSummary: workflow.docCoverageSummary || "",
      phaseOrder: Array.isArray(workflow.phaseOrder) ? workflow.phaseOrder : [],
      parallelLanes: Array.isArray(workflow.parallelLanes) ? workflow.parallelLanes : [],
      coordinationRules: Array.isArray(workflow.coordinationRules) ? workflow.coordinationRules : [],
    },
    docAnalysis: {
      summary: docAnalysis.summary || "",
      entries: Array.isArray(docAnalysis.entries) ? docAnalysis.entries : [],
      gaps: Array.isArray(docAnalysis.gaps) ? docAnalysis.gaps : [],
      repoProfile: docAnalysis.repoProfile || null,
    },
    supervisor: workspace?.supervisor ? {
      sessionId: workspace.supervisor.sessionId || "",
      status: workspace.supervisor.status || "",
      command: workspace.supervisor.command || "",
      lease: workspace.supervisor.lease || null,
      startedAt: workspace.supervisor.startedAt || "",
      pid: workspace.supervisor.pid || 0,
      guardianPid: workspace.supervisor.guardianPid || 0,
      workerPid: workspace.supervisor.workerPid || 0,
      exitCode: workspace.supervisor.exitCode,
      completedAt: workspace.supervisor.completedAt || "",
      message: workspace.supervisor.message || "",
      updatedAt: workspace.supervisor.updatedAt || "",
      guardianRestartCount: workspace.supervisor.guardianRestartCount || 0,
      keepAliveEnabled: Boolean(workspace.supervisor.keepAliveEnabled),
    } : null,
    latestStatus: workspace?.latestStatus ? {
      ok: Boolean(workspace.latestStatus.ok),
      stage: workspace.latestStatus.stage || "",
      taskId: workspace.latestStatus.taskId || "",
      taskTitle: workspace.latestStatus.taskTitle || "",
      runDir: workspace.latestStatus.runDir || "",
      summary: workspace.latestStatus.summary || null,
      message: workspace.latestStatus.message || "",
      updatedAt: workspace.latestStatus.updatedAt || "",
    } : null,
    runtime: workspace?.runtime ? {
      engine: workspace.runtime.engine || "",
      engineDisplayName: workspace.runtime.engineDisplayName || "",
      phase: workspace.runtime.phase || "",
      outputPrefix: workspace.runtime.outputPrefix || "",
      hardRetryBudget: workspace.runtime.hardRetryBudget || 0,
      softRetryBudget: workspace.runtime.softRetryBudget || 0,
      attemptPrefix: workspace.runtime.attemptPrefix || "",
      recoveryCount: workspace.runtime.recoveryCount || 0,
      recoveryHistory: Array.isArray(workspace.runtime.recoveryHistory) ? workspace.runtime.recoveryHistory : [],
      heartbeat: workspace.runtime.heartbeat || null,
      activityFile: workspace.runtime.activityFile || "",
      activityEventsFile: workspace.runtime.activityEventsFile || "",
      status: workspace.runtime.status || "",
      updatedAt: workspace.runtime.updatedAt || "",
      failureCode: workspace.runtime.failureCode || "",
      failureFamily: workspace.runtime.failureFamily || "",
      failureReason: workspace.runtime.failureReason || "",
      failureHttpStatus: workspace.runtime.failureHttpStatus || 0,
      nextRetryAt: workspace.runtime.nextRetryAt || "",
    } : null,
    activity: workspace?.activity ? {
      schemaVersion: workspace.activity.schemaVersion || 0,
      engine: workspace.activity.engine || "",
      phase: workspace.activity.phase || "",
      repoRoot: workspace.activity.repoRoot || "",
      runDir: workspace.activity.runDir || "",
      outputPrefix: workspace.activity.outputPrefix || "",
      attemptPrefix: workspace.activity.attemptPrefix || "",
      activityFile: workspace.activity.activityFile || "",
      activityEventsFile: workspace.activity.activityEventsFile || "",
      status: workspace.activity.status || "",
      threadId: workspace.activity.threadId || "",
      current: workspace.activity.current || null,
      todo: workspace.activity.todo || null,
      activeCommands: Array.isArray(workspace.activity.activeCommands) ? workspace.activity.activeCommands : [],
      recentCommands: Array.isArray(workspace.activity.recentCommands) ? workspace.activity.recentCommands : [],
      recentReasoning: Array.isArray(workspace.activity.recentReasoning) ? workspace.activity.recentReasoning : [],
      recentFileChanges: Array.isArray(workspace.activity.recentFileChanges) ? workspace.activity.recentFileChanges : [],
      recentEvents: Array.isArray(workspace.activity.recentEvents) ? workspace.activity.recentEvents : [],
      runtime: workspace.activity.runtime || null,
      finalMessage: workspace.activity.finalMessage || "",
      code: workspace.activity.code,
      startedAt: workspace.activity.startedAt || "",
      updatedAt: workspace.activity.updatedAt || "",
    } : null,
    statusModel: workspace?.statusModel ? {
      category: workspace.statusModel.category || "",
      code: workspace.statusModel.code || "",
      severity: workspace.statusModel.severity || "",
      label: workspace.statusModel.label || "",
      reason: workspace.statusModel.reason || "",
      reasonCode: workspace.statusModel.reasonCode || "",
      detail: workspace.statusModel.detail || "",
      autoAction: workspace.statusModel.autoAction || "",
      waitType: workspace.statusModel.waitType || "",
      waitLabel: workspace.statusModel.waitLabel || "",
      waitTargetLabel: workspace.statusModel.waitTargetLabel || "",
      waitTargets: Array.isArray(workspace.statusModel.waitTargets) ? workspace.statusModel.waitTargets : [],
      currentAction: workspace.statusModel.currentAction || "",
      todoProgress: workspace.statusModel.todoProgress || "",
      httpStatusCode: workspace.statusModel.httpStatusCode || 0,
      httpStatusLabel: workspace.statusModel.httpStatusLabel || "",
      failureCode: workspace.statusModel.failureCode || "",
      failureLabel: workspace.statusModel.failureLabel || "",
      schedulerLabel: workspace.statusModel.schedulerLabel || "",
      activity: workspace.statusModel.activity || null,
      failure: workspace.statusModel.failure || null,
      wait: workspace.statusModel.wait || null,
      scheduler: workspace.statusModel.scheduler || null,
    } : null,
    updatedAt: workspace?.updatedAt || "",
  };
}

export function createEmptyWorkspaceSelection() {
  return {
    repo_root: "",
    docs_path: "",
    config_dir_name: ".helloloop",
    preferred_engine: "codex",
  };
}

export function normalizeWorkspaceSelection(selection) {
  return {
    ...createEmptyWorkspaceSelection(),
    ...(selection || {}),
    repo_root: String(selection?.repo_root || "").trim(),
    docs_path: String(selection?.docs_path || "").trim(),
    config_dir_name: String(selection?.config_dir_name || ".helloloop").trim() || ".helloloop",
    preferred_engine: String(selection?.preferred_engine || "codex").trim() || "codex",
  };
}

export function inferWorkspaceSelection(workspace, health) {
  return normalizeWorkspaceSelection({
    repo_root: workspace?.repoRoot || health?.context?.workspace_root || "",
    docs_path: workspace?.docAnalysis?.entries?.[0]?.path || "docs",
    config_dir_name: workspace?.configDirName || health?.context?.config_dir_name || ".helloloop",
    preferred_engine: workspace?.engine || "codex",
  });
}

export function readSettingValue(field, target) {
  if (field === "refresh_interval_seconds") {
    return Number(target.value);
  }
  if (target.type === "checkbox") {
    return Boolean(target.checked);
  }
  return target.value;
}

export function controlNotice(locale, result) {
  if (result?.action_key === "pause_mainline" || result?.command === "pause-mainline") {
    return translateMessage(locale, "已暂停当前主线", "Mainline paused");
  }
  if (result?.action_key === "ack_blocker") {
    return translateMessage(locale, "已确认当前阻塞", "Current blocker acknowledged");
  }
  if (result?.action_key === "rerun_analysis" || result?.command === "analyze") {
    return translateMessage(locale, "已请求重新分析", "Analysis rerun requested");
  }
  if (result?.action_key === "retry_current" && result?.task_id) {
    return translateMessage(
      locale,
      `已请求立即重试任务 ${result.task_id}`,
      `Retry requested for task ${result.task_id}`,
    );
  }
  if (result?.action_key === "retry_current" && result?.command === "run-loop") {
    return translateMessage(locale, "已请求立即重试主线", "Retry requested for mainline");
  }
  if (result?.command === "run-once" && result?.task_id) {
    return translateMessage(
      locale,
      `已请求恢复任务 ${result.task_id}`,
      `Resume requested for task ${result.task_id}`,
    );
  }
  if (result?.command === "run-loop") {
    return translateMessage(locale, "已请求恢复主线执行", "Resume requested for mainline");
  }
  return translateMessage(locale, "动作已提交", "Action submitted");
}

function translateMessage(locale, zh, en) {
  return locale === "zh-CN" ? zh : en;
}

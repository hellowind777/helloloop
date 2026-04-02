import { escapeHtml, formatDate, translate } from "./app-i18n.js";
import { taskColumn } from "./app-render-cards.js";
import {
  buildLaneRows,
  infoCard,
  renderLaneCard,
} from "./app-view-shared.js";
import {
  formatTodoProgress,
  joinLabels,
  joinValues,
  renderBulletCard,
  renderStoryCard,
  renderWorkspaceOnboardingSection,
} from "./app-view-workspaces-parts.js";

export function renderWorkspacesView(state, snapshot, sessions, tasks) {
  const workspace = state.workspace;
  const selection = state.workspaceSelection || {
    repo_root: workspace?.repoRoot || "",
    docs_path: "docs",
    config_dir_name: workspace?.configDirName || ".helloloop",
    preferred_engine: workspace?.engine || "codex",
  };
  const lanes = buildLaneRows(tasks, sessions);
  const workspaceTasks = normalizeWorkspaceTasks(workspace);
  const context = state.health?.context || {};
  const workflow = workspace?.workflow || {};
  const docAnalysis = workspace?.docAnalysis || {};
  const supervisor = workspace?.supervisor || {};
  const runtime = workspace?.runtime || {};
  const heartbeat = runtime.heartbeat || {};
  const latestStatus = workspace?.latestStatus || {};
  const statusModel = workspace?.statusModel || {};
  const activity = workspace?.activity || {};
  const currentActivity = statusModel.activity || activity.current || null;
  const todoProgress = statusModel.todoProgress
    || formatTodoProgress(activity.todo);
  const statusSummary = [
    statusModel.label,
    statusModel.reason,
    statusModel.httpStatusLabel || statusModel.failure?.httpStatusLabel,
  ].filter(Boolean).join(" · ");

  return `
    <div class="view-stack">
      <div class="grid">
        ${renderWorkspaceOnboardingSection(state, selection, workspace)}
        <section class="panel">
          <div class="section-header">
            <div>
              <div class="section-kicker">${escapeHtml(t(state, "workspaces"))}</div>
              <h3 class="section-title">${escapeHtml(t(state, "workspaceOverview"))}</h3>
            </div>
          </div>
          <div class="workspace-grid">
            ${infoCard(t(state, "currentWorkspace"), workspace?.repoName || snapshot?.workspace_label || t(state, "none"), workspace?.engine || t(state, "none"))}
            ${infoCard(t(state, "repoRoot"), workspace?.repoRoot || context.workspace_root || t(state, "none"))}
            ${infoCard(t(state, "configDir"), workspace?.configDirName || context.config_dir_name || t(state, "none"))}
            ${infoCard(t(state, "bridgeMode"), context.bridge_mode || t(state, "none"), context.bootstrap_source || t(state, "none"))}
            ${infoCard(t(state, "currentFocus"), workflow.currentFocus || snapshot?.focus_summary || t(state, "none"))}
            ${infoCard(t(state, "workflowProfile"), workflow.profileLabel || snapshot?.methodology || t(state, "none"))}
            ${infoCard(t(state, "parallelStrategy"), workflow.parallelStrategy || t(state, "none"))}
            ${infoCard(t(state, "phaseOrder"), joinValues(workflow.phaseOrder, " → ") || t(state, "none"))}
          </div>
        </section>
        <section class="panel">
          <div class="section-header">
            <div>
              <div class="section-kicker">${escapeHtml(t(state, "projectSignals"))}</div>
              <h3 class="section-title">${escapeHtml(t(state, "workspaceSummary"))}</h3>
            </div>
          </div>
          <div class="workspace-grid">
            ${infoCard(t(state, "taskCount"), String(workspace?.summary?.total ?? tasks.length))}
            ${infoCard(t(state, "runningQueue"), String(workspace?.summary?.inProgress ?? workspaceTasks.filter((task) => task.state === "running").length))}
            ${infoCard(t(state, "blockedQueue"), String((workspace?.summary?.blocked ?? 0) + (workspace?.summary?.failed ?? 0)))}
            ${infoCard(t(state, "completedQueue"), String(workspace?.summary?.done ?? workspaceTasks.filter((task) => task.state === "completed").length))}
            ${infoCard(t(state, "nextRecommendedTask"), workspace?.nextTask?.title || t(state, "none"))}
            ${infoCard(t(state, "nextAutomationTask"), workspace?.automationNextTask?.title || t(state, "none"))}
            ${infoCard(t(state, "latestSummary"), latestStatus.message || latestStatus.taskTitle || t(state, "none"))}
            ${infoCard(t(state, "docCoverage"), workflow.docCoverageSummary || docAnalysis.summary || t(state, "none"))}
          </div>
        </section>
      </div>
      <div class="grid">
        <section class="panel">
          <div class="section-header">
            <div>
              <div class="section-kicker">${escapeHtml(t(state, "runtimeContext"))}</div>
              <h3 class="section-title">${escapeHtml(t(state, "runtimeControl"))}</h3>
            </div>
          </div>
          ${workspace
            ? `<div class="workspace-grid">
                ${infoCard(t(state, "supervisorSession"), supervisor.sessionId || t(state, "none"), supervisor.command || t(state, "none"))}
                ${infoCard(t(state, "supervisorStatus"), supervisor.status || t(state, "none"), formatDate(state.locale, supervisor.startedAt) || t(state, "none"))}
                ${infoCard(t(state, "runtimeStatus"), runtime.status || t(state, "none"), formatDate(state.locale, runtime.updatedAt) || t(state, "none"))}
                ${infoCard(t(state, "runtimePhase"), runtime.phase || latestStatus.stage || t(state, "none"), runtime.engineDisplayName || workspace?.engine || t(state, "none"))}
                ${infoCard(t(state, "currentAction"), statusModel.currentAction || currentActivity?.label || t(state, "none"))}
                ${infoCard(t(state, "todoProgress"), todoProgress || t(state, "none"))}
                ${infoCard(t(state, "retryAt"), formatDate(state.locale, runtime.nextRetryAt || statusModel.failure?.nextRetryAt) || statusModel.failure?.nextRetryLabel || t(state, "none"))}
                ${infoCard(t(state, "runtimeRecoveryCount"), String(runtime.recoveryCount ?? 0), `${runtime.hardRetryBudget ?? 0}/${runtime.softRetryBudget ?? 0}`)}
                ${infoCard(t(state, "heartbeat"), formatDate(state.locale, heartbeat.lastOutputAt || latestStatus.updatedAt) || t(state, "none"), heartbeat.idleSeconds != null ? `${heartbeat.idleSeconds}s idle` : t(state, "none"))}
                ${infoCard(t(state, "keepAlive"), supervisor.keepAliveEnabled ? t(state, "optionEnabled") : t(state, "optionDisabled"), supervisor.guardianRestartCount != null ? String(supervisor.guardianRestartCount) : t(state, "none"))}
              </div>
              <div class="workspace-callout">${escapeHtml(statusSummary || latestStatus.message || t(state, "none"))}</div>`
            : `<div class="empty">${escapeHtml(t(state, "workflowBridgeUnavailable"))}</div>`}
        </section>
        <section class="panel">
          <div class="section-header">
            <div>
              <div class="section-kicker">${escapeHtml(t(state, "projectSignals"))}</div>
              <h3 class="section-title">${escapeHtml(t(state, "workspaceMainline"))}</h3>
            </div>
          </div>
          ${workspace
            ? `<div class="workspace-grid">
                ${infoCard(t(state, "parallelLanes"), joinValues(workflow.parallelLanes, " · ") || t(state, "none"))}
                ${infoCard(t(state, "backlogState"), `${workspace.summary?.pending ?? 0} / ${workspace.summary?.total ?? 0}`)}
                ${infoCard(t(state, "currentStage"), latestStatus.stage || runtime.phase || t(state, "none"))}
                ${infoCard(t(state, "currentRun"), latestStatus.runDir || activity.runDir || t(state, "none"))}
              </div>
              <div class="story-list">
                ${renderStoryCard(
                  state,
                  t(state, "currentFocus"),
                  workflow.currentFocus || snapshot?.focus_summary || t(state, "none"),
                  workflow.profileLabel || snapshot?.methodology || "",
                )}
                ${renderStoryCard(
                  state,
                  t(state, "workspaceMainline"),
                  workflow.mainlineSummary || latestStatus.message || t(state, "none"),
                  workflow.parallelStrategy || "",
                )}
              </div>`
            : `<div class="empty">${escapeHtml(t(state, "workflowBridgeUnavailable"))}</div>`}
        </section>
      </div>
      <div class="grid">
        <section class="panel">
          <div class="section-header">
            <div>
              <div class="section-kicker">${escapeHtml(t(state, "docAnalysis"))}</div>
              <h3 class="section-title">${escapeHtml(t(state, "workspaceHealth"))}</h3>
            </div>
          </div>
          ${workspace
            ? `<div class="story-list">
                ${renderBulletCard(state, t(state, "coordinationRules"), workflow.coordinationRules)}
                ${renderBulletCard(state, t(state, "documentGaps"), docAnalysis.gaps)}
              </div>`
            : `<div class="empty">${escapeHtml(t(state, "workflowBridgeUnavailable"))}</div>`}
        </section>
        <section class="panel">
          <div class="section-header">
            <div>
              <div class="section-kicker">${escapeHtml(t(state, "timeline"))}</div>
              <h3 class="section-title">${escapeHtml(t(state, "recentActivity"))}</h3>
            </div>
          </div>
          <div class="story-list">
            ${renderStoryCard(
              state,
              t(state, "currentActivity"),
              currentActivity?.label || currentActivity?.rawLabel || statusModel.currentAction || t(state, "none"),
              currentActivity?.updatedAt ? formatDate(state.locale, currentActivity.updatedAt) : "",
            )}
            ${renderStoryCard(
              state,
              t(state, "reasoningPulse"),
              joinLabels(activity.recentReasoning, 3) || t(state, "none"),
              activity.recentReasoning?.[0]?.updatedAt ? formatDate(state.locale, activity.recentReasoning[0].updatedAt) : "",
            )}
            ${renderStoryCard(
              state,
              t(state, "activeCommand"),
              joinLabels(activity.activeCommands, 2) || joinLabels(activity.recentCommands, 2) || t(state, "none"),
              activity.recentCommands?.[0]?.updatedAt ? formatDate(state.locale, activity.recentCommands[0].updatedAt) : "",
            )}
          </div>
        </section>
      </div>
      <div class="grid">
        <section class="panel">
          <div class="section-header">
            <div>
              <div class="section-kicker">${escapeHtml(t(state, "laneMap"))}</div>
              <h3 class="section-title">${escapeHtml(t(state, "laneHealth"))}</h3>
            </div>
          </div>
          <div class="lane-grid">
            ${lanes.length ? lanes.map((lane) => renderLaneCard(state, lane)).join("") : `<div class="empty">${escapeHtml(t(state, "noTasks"))}</div>`}
          </div>
        </section>
        <section class="panel">
          <div class="section-header">
            <div>
              <div class="section-kicker">${escapeHtml(t(state, "tasks"))}</div>
              <h3 class="section-title">${escapeHtml(t(state, "taskSummary"))}</h3>
            </div>
          </div>
          <div class="task-columns">
            ${taskColumn(state, t(state, "readyQueue"), workspaceTasks.filter((task) => task.state === "ready"))}
            ${taskColumn(state, t(state, "runningQueue"), workspaceTasks.filter((task) => task.state === "running"))}
            ${taskColumn(state, t(state, "blockedQueue"), workspaceTasks.filter((task) => !["ready", "running", "completed"].includes(task.state)))}
            ${taskColumn(state, t(state, "completedQueue"), workspaceTasks.filter((task) => task.state === "completed"))}
          </div>
        </section>
      </div>
    </div>
  `;
}

function normalizeWorkspaceTasks(workspace) {
  return (workspace?.tasks || []).map((task) => ({
    id: task.id,
    title: task.title,
    stage: task.stage,
    owner_role: task.role || "developer",
    state: normalizeWorkspaceState(task),
    lane: task.lane,
    priority: task.priority,
    depends_on: task.depends_on || [],
  }));
}

function normalizeWorkspaceState(task) {
  if (task.status === "done") {
    return "completed";
  }
  if (task.status === "in_progress") {
    return "running";
  }
  if (task.status === "blocked" || task.status === "failed") {
    return task.depends_on?.length ? "waiting_dependency" : "failed_recoverable";
  }
  return task.depends_on?.length ? "waiting_dependency" : "ready";
}

function t(state, key) {
  return translate(state.locale, key);
}

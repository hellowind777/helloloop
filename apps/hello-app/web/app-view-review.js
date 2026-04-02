import { escapeHtml, translate } from "./app-i18n.js";
import {
  infoCard,
  renderSessionGroup,
  renderSessionsSection,
  renderTasksSection,
  renderTimelineSection,
  groupSessionsByState,
} from "./app-view-shared.js";

export function renderReviewView(state, sessions, tasks) {
  const workspace = state.workspace;
  const statusModel = workspace?.statusModel || {};
  const runtime = workspace?.runtime || {};
  const latestStatus = workspace?.latestStatus || {};
  const workflow = workspace?.workflow || {};
  const docAnalysis = workspace?.docAnalysis || {};
  const activity = workspace?.activity || {};
  const completedTasks = tasks.filter((item) => item.state === "completed");
  const riskySessions = sessions.filter((item) => ["failed_recoverable", "failed_terminal", "human_input_required"].includes(item.state));
  const waitingSessions = sessions.filter((item) => ["waiting_dependency", "waiting_external_signal", "retry_scheduled", "rate_limited"].includes(item.state));
  const readyTasks = tasks.filter((item) => item.state === "ready");
  const blockedTasks = tasks.filter((item) => !["ready", "running", "completed"].includes(item.state));
  const grouped = groupSessionsByState([...riskySessions, ...waitingSessions]);
  const recentFailures = (activity.recentCommands || []).filter((item) => item.status === "failed");
  const recentFiles = activity.recentFileChanges || [];
  const guidance = [
    workspace?.nextTask?.title,
    workspace?.automationNextTask?.title,
    ...(workflow.coordinationRules || []),
    ...(docAnalysis.gaps || []),
  ].filter(Boolean);
  const diagnosisSummary = [
    statusModel.label,
    statusModel.reason,
    statusModel.failure?.httpStatusLabel || statusModel.failureLabel,
    statusModel.wait?.label || statusModel.waitLabel,
  ].filter(Boolean).join(" · ");

  return `
    <div class="view-stack">
      <div class="grid">
        <section class="panel">
          <div class="section-header">
            <div>
              <div class="section-kicker">${escapeHtml(t(state, "review"))}</div>
              <h3 class="section-title">${escapeHtml(t(state, "reviewSummary"))}</h3>
            </div>
          </div>
          <div class="workspace-grid">
            ${infoCard(t(state, "completionSignal"), String(completedTasks.length))}
            ${infoCard(t(state, "recoverableFailures"), String(riskySessions.length))}
            ${infoCard(t(state, "criticalAlerts"), String(waitingSessions.length))}
            ${infoCard(t(state, "riskPosture"), riskySessions.length ? t(state, "manualFollowup") : t(state, "willAutoResume"))}
            ${infoCard(t(state, "reviewSignals"), diagnosisSummary || t(state, "noSignals"))}
            ${infoCard(t(state, "nextAutomationTask"), workspace?.automationNextTask?.title || t(state, "none"))}
          </div>
        </section>
        <section class="panel">
          <div class="section-header">
            <div>
              <div class="section-kicker">${escapeHtml(t(state, "review"))}</div>
              <h3 class="section-title">${escapeHtml(t(state, "structuredDiagnosis"))}</h3>
            </div>
          </div>
          <div class="workspace-grid">
            ${infoCard(t(state, "stateLabel"), statusModel.label || t(state, "none"))}
            ${infoCard(t(state, "reasonLabel"), statusModel.reason || latestStatus.message || t(state, "none"))}
            ${infoCard(t(state, "waitingReason"), statusModel.wait?.label || statusModel.waitLabel || t(state, "none"), statusModel.wait?.targetLabel || statusModel.waitTargetLabel || "")}
            ${infoCard(t(state, "failureReason"), statusModel.failure?.httpStatusLabel || statusModel.failureLabel || runtime.failureReason || t(state, "none"), statusModel.failure?.detail || "")}
            ${infoCard(t(state, "currentAction"), statusModel.currentAction || latestStatus.taskTitle || t(state, "none"))}
            ${infoCard(t(state, "retryAt"), statusModel.failure?.nextRetryLabel || t(state, "none"), runtime.nextRetryAt || statusModel.failure?.nextRetryAt || "")}
          </div>
          <div class="workspace-callout">${escapeHtml(diagnosisSummary || latestStatus.message || t(state, "noSignals"))}</div>
        </section>
      </div>
      <div class="grid">
        ${renderSessionsSection(state, riskySessions, t(state, "attentionNow"))}
        ${renderSessionsSection(state, waitingSessions, t(state, "followupQueue"))}
      </div>
      <section class="panel">
        <div class="section-header">
          <div>
            <div class="section-kicker">${escapeHtml(t(state, "statusSemantics"))}</div>
            <h3 class="section-title">${escapeHtml(t(state, "reviewSignals"))}</h3>
          </div>
        </div>
        <div class="session-group-grid">
          ${Object.keys(grouped).length
            ? Object.entries(grouped).map(([groupKey, items]) => renderSessionGroup(state, groupKey, items)).join("")
            : `<div class="empty">${escapeHtml(t(state, "noSignals"))}</div>`}
        </div>
      </section>
      <div class="grid">
        <section class="panel">
          <div class="section-header">
            <div>
              <div class="section-kicker">${escapeHtml(t(state, "review"))}</div>
              <h3 class="section-title">${escapeHtml(t(state, "reviewGuidance"))}</h3>
            </div>
          </div>
          <div class="story-list">
            ${guidance.length
              ? guidance.slice(0, 6).map((item) => `<article class="story-card"><div class="story-copy">${escapeHtml(item)}</div></article>`).join("")
              : `<div class="empty">${escapeHtml(t(state, "noGuidance"))}</div>`}
          </div>
        </section>
        ${renderTimelineSection(state, t(state, "eventFeed"))}
      </div>
      <div class="grid">
        <section class="panel">
          <div class="section-header">
            <div>
              <div class="section-kicker">${escapeHtml(t(state, "review"))}</div>
              <h3 class="section-title">${escapeHtml(t(state, "verificationEvidence"))}</h3>
            </div>
          </div>
          <div class="story-list">
            ${recentFailures.length
              ? recentFailures.slice(0, 4).map((item) => renderEvidenceCard(state, item.label, item.summary, item.updatedAt)).join("")
              : renderEvidenceCard(state, t(state, "recentFailures"), t(state, "noEvidence"), runtime.failureReason || latestStatus.message || "")}
          </div>
        </section>
        <section class="panel">
          <div class="section-header">
            <div>
              <div class="section-kicker">${escapeHtml(t(state, "review"))}</div>
              <h3 class="section-title">${escapeHtml(t(state, "recentFileChanges"))}</h3>
            </div>
          </div>
          <div class="story-list">
            ${recentFiles.length
              ? recentFiles.slice(0, 6).map((item) => renderEvidenceCard(state, item.path || item.file || t(state, "none"), item.summary || item.kind || t(state, "none"), item.updatedAt || "")).join("")
              : renderEvidenceCard(state, t(state, "recentFileChanges"), t(state, "noEvidence"), activity.runDir || "")}
          </div>
        </section>
      </div>
      <section class="panel">
        <div class="section-header">
          <div>
            <div class="section-kicker">${escapeHtml(t(state, "review"))}</div>
            <h3 class="section-title">${escapeHtml(t(state, "reviewChecklist"))}</h3>
          </div>
        </div>
        <div class="review-grid">
          ${renderTasksSection(state, readyTasks, t(state, "readyQueue"))}
          ${renderTasksSection(state, blockedTasks, t(state, "blockedQueue"))}
          ${renderTasksSection(state, completedTasks, t(state, "completedQueue"))}
        </div>
      </section>
    </div>
  `;
}

function t(state, key) {
  return translate(state.locale, key);
}

function renderEvidenceCard(state, title, summary, meta) {
  return `
    <article class="story-card">
      <div class="detail-key">${escapeHtml(title || t(state, "none"))}</div>
      <div class="story-copy">${escapeHtml(summary || t(state, "none"))}</div>
      ${meta ? `<div class="story-meta">${escapeHtml(meta)}</div>` : ""}
    </article>
  `;
}

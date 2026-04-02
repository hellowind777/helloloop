import { escapeHtml, translate } from "./app-i18n.js";
import {
  infoCard,
  renderHostsSection,
  renderSessionsSection,
  renderTasksSection,
  renderTimelineSection,
} from "./app-view-shared.js";

export function renderCommandCenterView(state, sessions, tasks) {
  const readyCount = tasks.filter((task) => task.state === "ready").length;
  const runningCount = tasks.filter((task) => task.state === "running").length;
  const waitingCount = tasks.filter((task) => !["ready", "running", "completed"].includes(task.state)).length;
  const completedCount = tasks.filter((task) => task.state === "completed").length;

  return `
    <div class="view-stack">
      <section class="panel">
        <div class="section-header">
          <div>
            <div class="section-kicker">${escapeHtml(t(state, "commandCenter"))}</div>
            <h3 class="section-title">${escapeHtml(t(state, "operatorQueue"))}</h3>
          </div>
        </div>
        <div class="workspace-grid">
          ${infoCard(t(state, "runningQueue"), String(runningCount), runningCount ? t(state, "liveQueue") : t(state, "none"))}
          ${infoCard(t(state, "readyQueue"), String(readyCount), readyCount ? t(state, "availableNow") : t(state, "none"))}
          ${infoCard(t(state, "blockedQueue"), String(waitingCount), waitingCount ? t(state, "manualFollowup") : t(state, "none"))}
          ${infoCard(t(state, "completedQueue"), String(completedCount), completedCount ? t(state, "reviewSummary") : t(state, "none"))}
        </div>
      </section>
      <div class="grid">
        ${renderSessionsSection(state, sessions, t(state, "sessionOverview"))}
        ${renderHostsSection(state)}
      </div>
      ${renderTasksSection(state, tasks, t(state, "taskBoard"))}
      <div class="grid">
        <section class="panel">
          <div class="section-header">
            <div>
              <div class="section-kicker">${escapeHtml(t(state, "review"))}</div>
              <h3 class="section-title">${escapeHtml(t(state, "attentionNow"))}</h3>
            </div>
          </div>
          <div class="workspace-grid">
            ${infoCard(t(state, "currentTask"), sessions.find((item) => item.state === "running")?.current_task || t(state, "none"))}
            ${infoCard(t(state, "nextTask"), sessions.find((item) => item.next_task)?.next_task || t(state, "none"))}
            ${infoCard(t(state, "riskPosture"), waitingCount ? t(state, "manualFollowup") : t(state, "willAutoResume"))}
            ${infoCard(t(state, "completionSignal"), String(completedCount))}
          </div>
        </section>
        ${renderTimelineSection(state, t(state, "eventFeed"))}
      </div>
    </div>
  `;
}

function t(state, key) {
  return translate(state.locale, key);
}

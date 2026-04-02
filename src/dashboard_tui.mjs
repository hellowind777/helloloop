import { collectDashboardSnapshot } from "./dashboard_command.mjs";
import { sleep } from "./common.mjs";
import { loadRuntimeSettings } from "./runtime_settings_loader.mjs";
import { hasRetryBudget, pickRetryDelaySeconds } from "./runtime_settings.mjs";
import { formatTaskRoleLabel, formatTaskStageLabel } from "./workflow_model.mjs";

const REFRESH_SPINNER = ["|", "/", "-", "\\"];

const STATUS_GROUPS = [
  { key: "in_progress", label: "进行中" },
  { key: "pending", label: "待处理" },
  { key: "done", label: "已完成" },
  { key: "blocked", label: "阻塞" },
  { key: "failed", label: "失败" },
];

const OVERVIEW_HELP = [
  "↑/↓ 或 j/k 选择",
  "PgUp/PgDn 翻页",
  "Enter 详情",
  "1-9 直达",
  "r 刷新",
  "q 退出",
];

const DETAIL_HELP = [
  "←/→ 切仓库",
  "↑/↓ 或 j/k 滚动",
  "PgUp/PgDn 翻页",
  "Esc 返回总览",
  "1-9 直达",
  "r 刷新",
  "q 退出",
];

function truncateText(text, maxWidth) {
  if (maxWidth <= 0) {
    return "";
  }
  const normalized = String(text || "").replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxWidth) {
    return normalized.padEnd(maxWidth, " ");
  }
  if (maxWidth <= 1) {
    return normalized.slice(0, maxWidth);
  }
  return `${normalized.slice(0, Math.max(0, maxWidth - 1))}…`;
}

function repeat(char, count) {
  return count > 0 ? char.repeat(count) : "";
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatClock(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return "--:--:--";
  }
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function formatRetryCountdown(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }
  const remainingMs = date.getTime() - Date.now();
  if (remainingMs <= 0) {
    return "即将重试";
  }
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function renderRefreshIndicator(snapshot, state) {
  const spinner = REFRESH_SPINNER[state.refreshTick % REFRESH_SPINNER.length] || "|";
  return `轮询 ${spinner} ${formatClock(state.lastPolledAt)} | 数据 ${formatClock(snapshot.generatedAt)}`;
}

function normalizeSelectedIndex(snapshot, currentIndex) {
  if (!snapshot.sessions.length) {
    return 0;
  }
  const bounded = Number(currentIndex || 0);
  if (!Number.isFinite(bounded) || bounded < 0) {
    return 0;
  }
  return Math.min(bounded, snapshot.sessions.length - 1);
}

function resolveSelectedIndex(snapshot, state) {
  if (!snapshot.sessions.length) {
    return 0;
  }
  const selectedSessionKey = String(state.selectedSessionKey || "");
  if (selectedSessionKey) {
    const matchedIndex = snapshot.sessions.findIndex((session) => session.sessionKey === selectedSessionKey);
    if (matchedIndex >= 0) {
      return matchedIndex;
    }
  }
  return normalizeSelectedIndex(snapshot, state.selectedIndex);
}

function groupTasks(session) {
  const grouped = new Map(STATUS_GROUPS.map((item) => [item.key, []]));
  for (const task of Array.isArray(session?.tasks) ? session.tasks : []) {
    const status = String(task.status || "pending");
    const bucket = grouped.get(status) || grouped.get("pending");
    bucket.push(task);
  }
  return grouped;
}

function formatRuntimeLabel(session) {
  const runtimeStatus = session.runtime?.status || "idle";
  const recoveryCount = Number(session.runtime?.recoveryCount || 0);
  const idleSeconds = Number(session.runtime?.heartbeat?.idleSeconds || 0);
  const parts = [runtimeStatus];
  if (recoveryCount > 0) {
    parts.push(`recovery=${recoveryCount}`);
  }
  if (idleSeconds > 0) {
    parts.push(`idle=${idleSeconds}s`);
  }
  return parts.join(" | ");
}

function formatCurrentAction(session) {
  if (session.runtime?.nextRetryAt && ["retry_waiting", "probe_waiting"].includes(String(session.runtime?.status || ""))) {
    const countdown = formatRetryCountdown(session.runtime.nextRetryAt);
    const prefix = session.runtime.status === "probe_waiting" ? "健康探测倒计时" : "重试倒计时";
    const actionLabel = session.statusModel?.currentAction || session.currentActionLabel || "等待自动重试";
    return countdown ? `${actionLabel} | ${prefix} ${countdown}` : actionLabel;
  }
  return session.statusModel?.currentAction
    || session.currentActionLabel
    || session.activity?.current?.label
    || session.latestStatus?.message
    || session.runtime?.failureReason
    || "等待新事件";
}

function summarizeTaskCounts(session) {
  return [
    `待处理 ${session.summary?.pending || 0}`,
    `进行中 ${session.summary?.inProgress || 0}`,
    `已完成 ${session.summary?.done || 0}`,
    `阻塞 ${session.summary?.blocked || 0}`,
    `失败 ${session.summary?.failed || 0}`,
  ].join(" / ");
}

function summarizeCompactTaskCounts(session) {
  return [
    `待 ${session.summary?.pending || 0}`,
    `进 ${session.summary?.inProgress || 0}`,
    `完 ${session.summary?.done || 0}`,
    `阻 ${session.summary?.blocked || 0}`,
    `败 ${session.summary?.failed || 0}`,
  ].join(" / ");
}

function renderOverviewSessionBlock(session, index, selected, width) {
  const marker = selected ? ">" : " ";
  const sessionLine = `${marker} [${index + 1}] ${session.repoName} | 会话 ${session.displaySessionId || session.sessionId || "unknown"}`;
  const taskLine = `  任务：${session.latestStatus?.taskTitle || session.nextTask?.title || "无"}`;
  const statusLine = `  状态：${session.statusModel?.label || "未知"} | 调度：${session.statusModel?.scheduler?.label || "无"}`;
  const reasonLine = `  原因：${session.statusModel?.reason || "无"}`;
  const workflowLine = `  主线：${session.workflow?.currentFocus || session.workflow?.mainlineSummary || "无"}`;
  const failureLine = session.statusModel?.failure?.label
    ? `  故障：${session.statusModel.failure.label}`
    : "";
  const waitLine = session.statusModel?.wait?.label || session.statusModel?.waitTargetLabel
    ? `  等待：${session.statusModel?.wait?.label || "无"}${session.statusModel?.waitTargetLabel ? ` | 对象 ${session.statusModel.waitTargetLabel}` : ""}`
    : "";
  const summaryLine = `  自动：${session.statusModel?.autoAction || "无"}${session.statusModel?.todoProgress ? ` | 进度 ${session.statusModel.todoProgress}` : ""} | 动作：${formatCurrentAction(session)}`;
  return [
    truncateText(sessionLine, width),
    truncateText(taskLine, width),
    truncateText(statusLine, width),
    truncateText(reasonLine, width),
    ...(failureLine ? [truncateText(failureLine, width)] : []),
    ...(waitLine ? [truncateText(waitLine, width)] : []),
    truncateText(workflowLine, width),
    truncateText(summaryLine, width),
  ];
}

function buildOverviewContent(snapshot, selectedIndex, width) {
  const lines = [];
  const blocks = [];
  snapshot.sessions.forEach((session, index) => {
    const start = lines.length;
    lines.push(...renderOverviewSessionBlock(session, index, index === selectedIndex, width));
    const end = lines.length - 1;
    blocks.push({ start, end });
  });
  return { lines, blocks };
}

function ensureVisibleBlock(blocks, selectedIndex, availableHeight, scrollOffset) {
  if (!blocks.length || availableHeight <= 0) {
    return 0;
  }
  const selectedBlock = blocks[selectedIndex];
  if (!selectedBlock) {
    return clamp(scrollOffset, 0, Math.max(0, blocks.at(-1).end - availableHeight + 1));
  }
  let nextOffset = Math.max(0, Number(scrollOffset || 0));
  if (selectedBlock.start < nextOffset) {
    nextOffset = selectedBlock.start;
  }
  if (selectedBlock.end >= nextOffset + availableHeight) {
    nextOffset = selectedBlock.end - availableHeight + 1;
  }
  const maxOffset = Math.max(0, blocks.at(-1).end - availableHeight + 1);
  return clamp(nextOffset, 0, maxOffset);
}

function buildSessionMetaLines(session, width) {
  const lines = [
    `仓库：${session.repoRoot}`,
    `会话：${session.displaySessionId || session.sessionId || "unknown"}`,
    `当前任务：${session.latestStatus?.taskTitle || "无"}`,
    `当前状态：${session.statusModel?.label || "未知"}`,
    `工作流画像：${session.workflow?.profileLabel || "无"}`,
    `主线焦点：${session.workflow?.currentFocus || session.workflow?.mainlineSummary || "无"}`,
    `并行 lane：${Array.isArray(session.workflow?.parallelLanes) && session.workflow.parallelLanes.length ? session.workflow.parallelLanes.join(" / ") : "mainline"}`,
    `文档画像：${session.docAnalysis?.summary || "无"}`,
    `调度语义：${session.statusModel?.scheduler?.label || "无"}`,
    `状态原因：${session.statusModel?.reason || "无"}`,
    `故障归类：${session.statusModel?.failure?.label || "无"}`,
    `自动动作：${session.statusModel?.autoAction || "无"}`,
    `等待状态：${session.statusModel?.wait?.label || "无"}`,
    `等待对象：${session.statusModel?.waitTargetLabel || "无"}`,
    `运行状态：${formatRuntimeLabel(session)}`,
    `当前动作：${formatCurrentAction(session)}`,
    `步骤进度：${session.statusModel?.todoProgress || "无"}`,
    `backlog：总计 ${session.summary?.total || 0} / 待处理 ${session.summary?.pending || 0} / 进行中 ${session.summary?.inProgress || 0} / 已完成 ${session.summary?.done || 0} / 阻塞 ${session.summary?.blocked || 0} / 失败 ${session.summary?.failed || 0}`,
  ];

  return lines.map((line) => truncateText(line, width));
}

function renderTaskLine(task, width) {
  const meta = `[${task.priority || "P2"}|${task.risk || "low"}|${formatTaskStageLabel(task.stage || "implementation")}|${formatTaskRoleLabel(task.role || "developer")}|${task.lane || "mainline"}]`;
  return truncateText(`${meta} ${task.title}`, width);
}

function renderTaskSections(session, width) {
  const sections = [];
  const grouped = groupTasks(session);

  for (const statusGroup of STATUS_GROUPS) {
    const tasks = grouped.get(statusGroup.key) || [];
    sections.push(`${statusGroup.label} (${tasks.length})`);
    if (!tasks.length) {
      sections.push("  - 无");
      sections.push("");
      continue;
    }

    for (const task of tasks) {
      sections.push(`  - ${renderTaskLine(task, Math.max(10, width - 4))}`);
    }
    sections.push("");
  }

  return sections;
}

function renderEmptyState(width, height, message) {
  const lines = [
    "HelloLoop TUI Dashboard",
    repeat("=", Math.max(20, Math.min(width, 40))),
    "",
    message,
  ];
  while (lines.length < height) {
    lines.push("");
  }
  return lines.slice(0, height).map((line) => truncateText(line, width)).join("\n");
}

function renderOverview(snapshot, state, width, height) {
  const selectedIndex = resolveSelectedIndex(snapshot, state);
  const selectedSession = snapshot.sessions[selectedIndex];
  state.selectedIndex = selectedIndex;
  state.selectedSessionKey = selectedSession?.sessionKey || "";

  const lines = [
    truncateText(`HelloLoop TUI Dashboard | 总览模式 | 仓库 ${snapshot.repoCount || 0} | 活跃会话 ${snapshot.activeCount || 0} | 任务总计 ${snapshot.taskTotals?.total || 0}`, width),
    truncateText(`刷新：${renderRefreshIndicator(snapshot, state)} | 键位：${OVERVIEW_HELP.join(" / ")}`, width),
    repeat("─", width),
  ];

  const availableContentHeight = Math.max(1, height - lines.length - 1);
  state.viewportHeight = availableContentHeight;
  const content = buildOverviewContent(snapshot, selectedIndex, width);
  state.scrollOffset = ensureVisibleBlock(content.blocks, selectedIndex, availableContentHeight, state.scrollOffset);
  const maxOffset = Math.max(0, content.lines.length - availableContentHeight);
  const scrollOffset = clamp(state.scrollOffset, 0, maxOffset);
  const visibleContent = content.lines.slice(scrollOffset, scrollOffset + availableContentHeight);

  while (visibleContent.length < availableContentHeight) {
    visibleContent.push("");
  }

  const footer = truncateText(
    `选中仓库 ${selectedIndex + 1}/${snapshot.sessions.length} | 行 ${scrollOffset + 1}-${Math.min(content.lines.length, scrollOffset + visibleContent.length)}/${content.lines.length}`,
    width,
  );

  return [...lines, ...visibleContent, footer]
    .slice(0, height)
    .map((line) => truncateText(line, width))
    .join("\n");
}

function renderDetail(snapshot, state, width, height) {
  const selectedIndex = resolveSelectedIndex(snapshot, state);
  const selectedSession = snapshot.sessions[selectedIndex];
  state.selectedIndex = selectedIndex;
  state.selectedSessionKey = selectedSession?.sessionKey || "";

  const lines = [
    truncateText(`HelloLoop TUI Dashboard | 详情模式 | 仓库 ${selectedIndex + 1}/${snapshot.sessions.length} ${selectedSession.repoName}`, width),
    truncateText(`刷新：${renderRefreshIndicator(snapshot, state)} | 键位：${DETAIL_HELP.join(" / ")}`, width),
    repeat("─", width),
    ...buildSessionMetaLines(selectedSession, width),
    repeat("─", width),
  ];

  const contentLines = renderTaskSections(selectedSession, width);
  const availableContentHeight = Math.max(1, height - lines.length - 1);
  state.viewportHeight = availableContentHeight;
  const maxOffset = Math.max(0, contentLines.length - availableContentHeight);
  state.scrollOffset = clamp(state.scrollOffset, 0, maxOffset);
  const visibleContent = contentLines.slice(state.scrollOffset, state.scrollOffset + availableContentHeight);

  while (visibleContent.length < availableContentHeight) {
    visibleContent.push("");
  }

  const footer = truncateText(
    `详情滚动 ${state.scrollOffset + 1}-${Math.min(contentLines.length, state.scrollOffset + visibleContent.length)}/${contentLines.length}`,
    width,
  );

  return [...lines, ...visibleContent, footer]
    .slice(0, height)
    .map((line) => truncateText(line, width))
    .join("\n");
}

function renderTui(snapshot, state) {
  const width = Math.max(60, Number(process.stdout.columns || 120));
  const height = Math.max(24, Number(process.stdout.rows || 40));

  if (!snapshot.sessions.length) {
    return renderEmptyState(width, height, "当前没有已登记仓库或后台会话。");
  }

  if (state.viewMode === "detail") {
    return renderDetail(snapshot, state, width, height);
  }

  return renderOverview(snapshot, state, width, height);
}

function selectAdjacentSession(snapshot, state, delta) {
  if (!snapshot.sessions.length) {
    return;
  }
  const currentIndex = resolveSelectedIndex(snapshot, state);
  const nextIndex = clamp(currentIndex + delta, 0, snapshot.sessions.length - 1);
  state.selectedIndex = nextIndex;
  state.selectedSessionKey = snapshot.sessions[nextIndex]?.sessionKey || "";
}

function selectByDigit(snapshot, state, input) {
  const digit = Number.parseInt(input, 10);
  if (!Number.isInteger(digit) || digit <= 0 || digit > snapshot.sessions.length) {
    return false;
  }
  state.selectedIndex = digit - 1;
  state.selectedSessionKey = snapshot.sessions[state.selectedIndex]?.sessionKey || "";
  state.scrollOffset = 0;
  state.forceRefresh = true;
  return true;
}

function getPageStep(state) {
  return Math.max(1, Number(state.viewportHeight || 8) - 2);
}

function selectSessionByPage(snapshot, state, delta) {
  if (!snapshot.sessions.length) {
    return;
  }
  const step = Math.max(1, Math.floor(getPageStep(state) / 4));
  selectAdjacentSession(snapshot, state, step * delta);
}

function scrollDetailPage(state, delta) {
  const step = getPageStep(state);
  state.scrollOffset = Math.max(0, state.scrollOffset + step * delta);
}

function applyInputKey(buffer, state, snapshot) {
  const input = String(buffer || "");
  if (!input) {
    return false;
  }

  if (input === "\u0003" || input === "q") {
    state.running = false;
    return true;
  }
  if (input === "r") {
    state.forceRefresh = true;
    return true;
  }
  if (selectByDigit(snapshot, state, input)) {
    return true;
  }

  if (state.viewMode === "overview") {
    if (input === "\u001b[A" || input === "k" || input === "w") {
      selectAdjacentSession(snapshot, state, -1);
      state.forceRefresh = true;
      return true;
    }
    if (input === "\u001b[B" || input === "j" || input === "s") {
      selectAdjacentSession(snapshot, state, 1);
      state.forceRefresh = true;
      return true;
    }
    if (input === "\u001b[5~") {
      selectSessionByPage(snapshot, state, -1);
      state.forceRefresh = true;
      return true;
    }
    if (input === "\u001b[6~") {
      selectSessionByPage(snapshot, state, 1);
      state.forceRefresh = true;
      return true;
    }
    if (input === "\u001b[H" || input === "\u001bOH" || input === "g") {
      state.selectedIndex = 0;
      state.selectedSessionKey = snapshot.sessions[0]?.sessionKey || "";
      state.forceRefresh = true;
      return true;
    }
    if (input === "\u001b[F" || input === "\u001bOF" || input === "G") {
      state.selectedIndex = Math.max(0, snapshot.sessions.length - 1);
      state.selectedSessionKey = snapshot.sessions[state.selectedIndex]?.sessionKey || "";
      state.forceRefresh = true;
      return true;
    }
    if (input === "\r" || input === "\n" || input === " ") {
      state.viewMode = "detail";
      state.scrollOffset = 0;
      state.forceRefresh = true;
      return true;
    }
    return false;
  }

  if (input === "\u001b") {
    state.viewMode = "overview";
    state.scrollOffset = 0;
    state.forceRefresh = true;
    return true;
  }
  if (input === "\u001b[C") {
    selectAdjacentSession(snapshot, state, 1);
    state.scrollOffset = 0;
    state.forceRefresh = true;
    return true;
  }
  if (input === "\u001b[D") {
    selectAdjacentSession(snapshot, state, -1);
    state.scrollOffset = 0;
    state.forceRefresh = true;
    return true;
  }
  if (input === "\u001b[A" || input === "k" || input === "w") {
    state.scrollOffset = Math.max(0, state.scrollOffset - 1);
    state.forceRefresh = true;
    return true;
  }
  if (input === "\u001b[B" || input === "j" || input === "s") {
    state.scrollOffset += 1;
    state.forceRefresh = true;
    return true;
  }
  if (input === "\u001b[5~") {
    scrollDetailPage(state, -1);
    state.forceRefresh = true;
    return true;
  }
  if (input === "\u001b[6~") {
    scrollDetailPage(state, 1);
    state.forceRefresh = true;
    return true;
  }
  if (input === "\u001b[H" || input === "\u001bOH") {
    state.scrollOffset = 0;
    state.forceRefresh = true;
    return true;
  }
  if (input === "\r" || input === "\n" || input === " " || input === "\u007f") {
    state.viewMode = "overview";
    state.scrollOffset = 0;
    state.forceRefresh = true;
    return true;
  }

  return false;
}

function enterAlternateScreen() {
  process.stdout.write("\x1b[?1049h\x1b[?25l");
}

function leaveAlternateScreen() {
  process.stdout.write("\x1b[?25h\x1b[?1049l");
}

export async function runDashboardTuiCommand(options = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("HelloLoop TUI 需要在真实终端中运行。");
  }

  const pollMs = Math.max(500, Number(options.pollMs || options.watchPollMs || 1500));
  const observerRetry = loadRuntimeSettings({
    globalConfigFile: options.globalConfigFile,
  }).observerRetry;

  const state = {
    running: true,
    viewMode: "overview",
    selectedIndex: 0,
    selectedSessionKey: "",
    scrollOffset: 0,
    viewportHeight: 8,
    lastPolledAt: "",
    refreshTick: 0,
    forceRefresh: true,
  };
  let lastFrame = "";
  let retryCount = 0;
  let lastSnapshot = collectDashboardSnapshot();

  const onData = (buffer) => {
    applyInputKey(buffer, state, lastSnapshot);
  };

  enterAlternateScreen();
  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", onData);

  try {
    while (state.running) {
      try {
        lastSnapshot = collectDashboardSnapshot();
        state.lastPolledAt = new Date().toISOString();
        state.refreshTick = (state.refreshTick + 1) % REFRESH_SPINNER.length;
        retryCount = 0;
      } catch (error) {
        const nextAttempt = retryCount + 1;
        if (!observerRetry.enabled || !hasRetryBudget(observerRetry.maxRetryCount, nextAttempt)) {
          throw error;
        }

        const delaySeconds = pickRetryDelaySeconds(observerRetry.retryDelaysSeconds, nextAttempt);
        const frame = renderEmptyState(
          Math.max(60, Number(process.stdout.columns || 120)),
          Math.max(24, Number(process.stdout.rows || 40)),
          `看板采集失败，将在 ${delaySeconds} 秒后自动重试（第 ${nextAttempt} 次）：${String(error?.message || error || "unknown error")}`,
        );
        process.stdout.write("\x1b[H\x1b[2J");
        process.stdout.write(frame);
        retryCount = nextAttempt;
        await sleep(delaySeconds * 1000);
        continue;
      }

      const frame = renderTui(lastSnapshot, state);
      if (frame !== lastFrame || state.forceRefresh) {
        process.stdout.write("\x1b[H\x1b[2J");
        process.stdout.write(frame);
        lastFrame = frame;
        state.forceRefresh = false;
      }

      await sleep(pollMs);
    }
  } finally {
    process.stdin.off("data", onData);
    process.stdin.setRawMode(false);
    process.stdin.pause();
    leaveAlternateScreen();
  }

  return 0;
}

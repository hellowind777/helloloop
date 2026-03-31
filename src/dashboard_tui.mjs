import { collectDashboardSnapshot } from "./dashboard_command.mjs";
import { sleep } from "./common.mjs";
import { loadRuntimeSettings } from "./runtime_settings_loader.mjs";
import { hasRetryBudget, pickRetryDelaySeconds } from "./runtime_settings.mjs";

const STATUS_GROUPS = [
  { key: "in_progress", label: "进行中" },
  { key: "pending", label: "待处理" },
  { key: "done", label: "已完成" },
  { key: "blocked", label: "阻塞" },
  { key: "failed", label: "失败" },
];

const KEYBOARD_HELP = [
  "←/→ 切换仓库",
  "↑/↓ 滚动",
  "1-9 直达仓库",
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

function groupTasks(session) {
  const grouped = new Map(STATUS_GROUPS.map((item) => [item.key, []]));
  for (const task of Array.isArray(session?.tasks) ? session.tasks : []) {
    const status = String(task.status || "pending");
    const bucket = grouped.get(status) || grouped.get("pending");
    bucket.push(task);
  }
  return grouped;
}

function renderRepoTabs(snapshot, selectedIndex, width) {
  const tabs = snapshot.sessions.map((session, index) => {
    const active = index === selectedIndex ? "*" : " ";
    const task = session.latestStatus?.taskTitle || session.nextTask?.title || "无任务";
    return `${active}${index + 1}.${session.repoName} ${session.runtime?.status || "idle"} ${task}`;
  });

  const line = tabs.join("  |  ");
  return truncateText(line, width);
}

function buildSessionMetaLines(session, width) {
  const lines = [
    `仓库：${session.repoRoot}`,
    `会话：${session.sessionId}`,
    `当前任务：${session.latestStatus?.taskTitle || "无"}`,
    `运行状态：${session.runtime?.status || "idle"}${Number.isFinite(Number(session.runtime?.heartbeat?.idleSeconds)) && Number(session.runtime?.heartbeat?.idleSeconds) > 0 ? ` | idle=${session.runtime.heartbeat.idleSeconds}s` : ""}`,
    `当前动作：${session.activity?.current?.label || session.latestStatus?.message || session.runtime?.failureReason || "等待新事件"}`,
    `backlog：总计 ${session.summary?.total || 0} / 待处理 ${session.summary?.pending || 0} / 进行中 ${session.summary?.inProgress || 0} / 已完成 ${session.summary?.done || 0} / 阻塞 ${session.summary?.blocked || 0} / 失败 ${session.summary?.failed || 0}`,
  ];

  return lines.map((line) => truncateText(line, width));
}

function renderTaskLine(task, width) {
  const meta = `[${task.priority || "P2"}|${task.risk || "low"}]`;
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

function renderTui(snapshot, state) {
  const width = Math.max(60, Number(process.stdout.columns || 120));
  const height = Math.max(24, Number(process.stdout.rows || 40));

  if (!snapshot.sessions.length) {
    return renderEmptyState(width, height, "当前没有已登记仓库或后台会话。");
  }

  const selectedIndex = normalizeSelectedIndex(snapshot, state.selectedIndex);
  const selectedSession = snapshot.sessions[selectedIndex];
  const lines = [
    truncateText(`HelloLoop TUI Dashboard | 仓库 ${snapshot.repoCount || 0} | 活跃会话 ${snapshot.activeCount || 0} | 任务总计 ${snapshot.taskTotals?.total || 0} | 待处理 ${snapshot.taskTotals?.pending || 0} | 进行中 ${snapshot.taskTotals?.inProgress || 0} | 已完成 ${snapshot.taskTotals?.done || 0}`, width),
    truncateText(`更新时间：${snapshot.generatedAt} | 键位：${KEYBOARD_HELP.join(" / ")}`, width),
    repeat("─", width),
    renderRepoTabs(snapshot, selectedIndex, width),
    repeat("─", width),
    ...buildSessionMetaLines(selectedSession, width),
    repeat("─", width),
  ];

  const contentLines = renderTaskSections(selectedSession, width);
  const availableContentHeight = Math.max(1, height - lines.length - 1);
  const maxOffset = Math.max(0, contentLines.length - availableContentHeight);
  const scrollOffset = Math.min(Math.max(0, Number(state.scrollOffset || 0)), maxOffset);

  const visibleContent = contentLines.slice(scrollOffset, scrollOffset + availableContentHeight);
  const footer = truncateText(
    `仓库 ${selectedIndex + 1}/${snapshot.sessions.length} | 滚动 ${scrollOffset + 1}-${Math.min(contentLines.length, scrollOffset + visibleContent.length)}/${contentLines.length}`,
    width,
  );

  while (visibleContent.length < availableContentHeight) {
    visibleContent.push("");
  }

  return [...lines, ...visibleContent, footer]
    .slice(0, height)
    .map((line) => truncateText(line, width))
    .join("\n");
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
  if (input === "\u001b[C") {
    state.selectedIndex = Math.min(snapshot.sessions.length - 1, state.selectedIndex + 1);
    state.scrollOffset = 0;
    return true;
  }
  if (input === "\u001b[D") {
    state.selectedIndex = Math.max(0, state.selectedIndex - 1);
    state.scrollOffset = 0;
    return true;
  }
  if (input === "\u001b[A") {
    state.scrollOffset = Math.max(0, state.scrollOffset - 1);
    return true;
  }
  if (input === "\u001b[B") {
    state.scrollOffset += 1;
    return true;
  }

  const digit = Number.parseInt(input, 10);
  if (Number.isInteger(digit) && digit > 0 && digit <= snapshot.sessions.length) {
    state.selectedIndex = digit - 1;
    state.scrollOffset = 0;
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
    selectedIndex: 0,
    scrollOffset: 0,
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

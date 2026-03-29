import path from "node:path";

import { analyzeExecution, summarizeBacklog } from "./backlog.mjs";
import { loadPolicy, loadVerifyCommands } from "./config.mjs";

function toDisplayPath(repoRoot, targetPath) {
  const absolutePath = path.resolve(targetPath);
  const relativePath = path.relative(repoRoot, absolutePath);
  if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    return relativePath.replaceAll("\\", "/");
  }
  return absolutePath.replaceAll("\\", "/");
}

function formatList(items, fallback = "无") {
  if (!Array.isArray(items) || !items.length) {
    return [`- ${fallback}`];
  }
  return items.map((item) => `- ${item}`);
}

function formatTaskPreview(tasks) {
  const preview = tasks
    .filter((task) => ["pending", "in_progress"].includes(String(task.status || "pending")))
    .slice(0, 5);

  if (!preview.length) {
    return ["- 当前没有待执行任务"];
  }

  return preview.map((task) => {
    const parts = [
      task.title,
      `#${task.id}`,
      task.priority || "P2",
      `risk:${task.risk || "low"}`,
    ];
    return `- ${parts.join(" | ")}`;
  });
}

function formatExecutionState(execution) {
  const stateMap = {
    ready: "可自动执行",
    blocked_in_progress: "存在未收束任务",
    blocked_failed: "存在失败或阻塞任务",
    blocked_risk: "风险超过自动阈值",
    blocked_dependencies: "依赖未满足",
    done: "backlog 已完成",
  };

  return stateMap[execution.state] || execution.state;
}

function resolvePreviewVerifyCommands(context, execution) {
  const taskCommands = Array.isArray(execution.task?.verify) && execution.task.verify.length
    ? execution.task.verify
    : [];
  if (taskCommands.length) {
    return taskCommands;
  }
  return loadVerifyCommands(context);
}

export function resolveAutoRunMaxTasks(backlog, options = {}) {
  const explicitMaxTasks = Number(options.maxTasks);
  if (Number.isFinite(explicitMaxTasks) && explicitMaxTasks > 0) {
    return explicitMaxTasks;
  }

  const summary = summarizeBacklog(backlog);
  const pendingTotal = summary.pending + summary.inProgress;
  return Math.max(1, pendingTotal);
}

export function renderAnalyzeConfirmation(context, analysis, backlog, options = {}) {
  const summary = summarizeBacklog(backlog);
  const execution = analyzeExecution(backlog, options);
  const policy = loadPolicy(context);
  const verifyCommands = resolvePreviewVerifyCommands(context, execution);
  const autoRunMaxTasks = resolveAutoRunMaxTasks(backlog, options);
  const docsDisplay = analysis.requiredDocs.map((entry) => (
    toDisplayPath(context.repoRoot, path.resolve(context.repoRoot, entry))
  ));

  return [
    "执行确认单",
    "============",
    `目标仓库：${context.repoRoot.replaceAll("\\", "/")}`,
    `开发文档：${docsDisplay.length ? docsDisplay.join("，") : "未识别"}`,
    "",
    "当前进度：",
    `- ${analysis.summary.currentState}`,
    "",
    "已实现：",
    ...formatList(analysis.summary.implemented, "暂无已实现摘要"),
    "",
    "待完成：",
    ...formatList(analysis.summary.remaining, "暂无待完成摘要"),
    "",
    "任务统计：",
    `- 总任务：${summary.total}`,
    `- 已完成：${summary.done}`,
    `- 待处理：${summary.pending}`,
    `- 进行中：${summary.inProgress}`,
    `- 阻塞：${summary.blocked}`,
    `- 失败：${summary.failed}`,
    "",
    "执行判断：",
    `- 当前状态：${formatExecutionState(execution)}`,
    `- 优先动作：${analysis.summary.nextAction}`,
    execution.task
      ? `- 首个任务：${execution.task.title}`
      : `- 首个任务：${execution.blockedTask?.title || "暂无"}`,
    execution.blockedReason
      ? `- 当前阻塞：${execution.blockedReason}`
      : "- 当前阻塞：无",
    "- 偏差修正：按 backlog 优先级执行；如果分析识别出偏差修正任务，会先收口再继续后续开发",
    `- 自动推进：最多 ${autoRunMaxTasks} 个任务，直到 backlog 清空或遇到硬阻塞`,
    `- 单任务重试：每种策略最多 ${policy.maxTaskAttempts} 次，共 ${policy.maxTaskStrategies} 轮策略`,
    "",
    "待执行任务预览：",
    ...formatTaskPreview(backlog.tasks),
    "",
    "验证命令预览：",
    ...formatList(verifyCommands, "未配置 verify.yaml，执行阶段将仅依赖任务自带验证"),
  ].join("\n");
}

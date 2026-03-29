import path from "node:path";

import { renderInputIssueLines, renderUserIntentLines } from "./analyze_user_input.mjs";
import { analyzeExecution, summarizeBacklog } from "./backlog.mjs";
import { loadPolicy, loadVerifyCommands } from "./config.mjs";
import { getEngineDisplayName } from "./engine_metadata.mjs";

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

function renderResolutionLines(discovery, context, docsDisplay) {
  const repoResolution = discovery?.resolution?.repo;
  const docsResolution = discovery?.resolution?.docs;
  const repoBasis = Array.isArray(repoResolution?.basis) && repoResolution.basis.length
    ? repoResolution.basis.join("；")
    : "无";
  const docsBasis = Array.isArray(docsResolution?.basis) && docsResolution.basis.length
    ? docsResolution.basis.join("；")
    : "无";
  const repoState = repoResolution?.exists === false
    ? "当前目录不存在，将按新项目创建"
    : "已存在项目目录";

  return [
    "路径判断：",
    `- 开发文档：${docsDisplay.length ? docsDisplay.join("，") : "未识别"}`,
    `- 文档来源：${docsResolution?.sourceLabel || "自动判断"}`,
    `- 文档把握：${docsResolution?.confidenceLabel || "中"}`,
    `- 文档依据：${docsBasis}`,
    `- 目标仓库：${context.repoRoot.replaceAll("\\", "/")}`,
    `- 项目状态：${repoState}`,
    `- 仓库来源：${repoResolution?.sourceLabel || "自动判断"}`,
    `- 仓库把握：${repoResolution?.confidenceLabel || "中"}`,
    `- 仓库依据：${repoBasis}`,
  ];
}

function renderRequestInterpretationLines(analysis) {
  const interpretation = analysis?.requestInterpretation;
  if (!interpretation) {
    return [];
  }

  return [
    "需求语义理解：",
    `- 总结：${interpretation.summary || "无"}`,
    ...(interpretation.priorities.length
      ? interpretation.priorities.map((item) => `- 优先关注：${item}`)
      : ["- 优先关注：无"]),
    ...(interpretation.cautions.length
      ? interpretation.cautions.map((item) => `- 特别注意：${item}`)
      : ["- 特别注意：无"]),
  ];
}

function renderRepoDecisionLines(analysis) {
  const decision = analysis?.repoDecision;
  if (!decision) {
    return [];
  }

  const compatibilityMap = {
    compatible: "兼容，可直接接续",
    conflict: "明显冲突",
    uncertain: "存在不确定性",
  };
  const actionMap = {
    continue_existing: "继续在当前项目上接续",
    confirm_rebuild: "先确认是否清理当前项目后重建",
    start_new: "按新项目路径继续推进",
  };

  return [
    "项目匹配判断：",
    `- 匹配结论：${compatibilityMap[decision.compatibility] || decision.compatibility}`,
    `- 建议动作：${actionMap[decision.action] || decision.action}`,
    `- 判断依据：${decision.reason}`,
  ];
}

function renderEngineResolutionLines(engineResolution) {
  if (!engineResolution?.engine) {
    return [];
  }

  const availableDisplay = Array.isArray(engineResolution.availableEngines) && engineResolution.availableEngines.length
    ? engineResolution.availableEngines.map((engine) => getEngineDisplayName(engine)).join("、")
    : "未检测到其他可用引擎";
  const basisText = Array.isArray(engineResolution.basis) && engineResolution.basis.length
    ? engineResolution.basis.join("；")
    : "无";

  return [
    "执行引擎：",
    `- 当前宿主：${engineResolution.hostDisplayName || "终端"}`,
    `- 本次引擎：${engineResolution.displayName || getEngineDisplayName(engineResolution.engine)}`,
    `- 选择来源：${engineResolution.sourceLabel || "自动判断"}`,
    `- 选择依据：${basisText}`,
    `- 当前可用：${availableDisplay}`,
    "- 故障处理：如果当前引擎在分析或执行阶段遇到登录 / 配额 / 限流问题，HelloLoop 会暂停并询问是否切换其他可用引擎",
  ];
}

export function resolveAutoRunMaxTasks(backlog, options = {}) {
  const explicitMaxTasks = Number(options.maxTasks);
  if (Number.isFinite(explicitMaxTasks) && explicitMaxTasks > 0) {
    return explicitMaxTasks;
  }
  return 0;
}

export function renderAnalyzeConfirmation(context, analysis, backlog, options = {}, discovery = {}) {
  const summary = summarizeBacklog(backlog);
  const execution = analyzeExecution(backlog, options);
  const policy = loadPolicy(context);
  const verifyCommands = resolvePreviewVerifyCommands(context, execution);
  const autoRunMaxTasks = resolveAutoRunMaxTasks(backlog, options);
  const docsDisplay = analysis.requiredDocs.map((entry) => (
    toDisplayPath(context.repoRoot, path.resolve(context.repoRoot, entry))
  ));
  const userIntentLines = renderUserIntentLines(options.userIntent);
  const inputIssueLines = renderInputIssueLines(options.inputIssues);

  return [
    "执行确认单",
    "============",
    ...renderResolutionLines(discovery, context, docsDisplay),
    ...(userIntentLines.length ? ["", "本次命令补充输入：", ...formatList(userIntentLines)] : []),
    ...(inputIssueLines.length ? ["", "输入提示：", ...inputIssueLines] : []),
    ...(renderEngineResolutionLines(options.engineResolution).length ? ["", ...renderEngineResolutionLines(options.engineResolution)] : []),
    ...(renderRequestInterpretationLines(analysis).length ? ["", ...renderRequestInterpretationLines(analysis)] : []),
    ...(renderRepoDecisionLines(analysis).length ? ["", ...renderRepoDecisionLines(analysis)] : []),
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
    autoRunMaxTasks > 0
      ? `- 自动推进：最多 ${autoRunMaxTasks} 个任务；若主线终态复核仍发现缺口，则到达上限后暂停`
      : "- 自动推进：持续执行，直到 backlog 清空且主线终态复核通过，或遇到硬阻塞",
    `- 单任务重试：每种策略最多 ${policy.maxTaskAttempts} 次，共 ${policy.maxTaskStrategies} 轮策略`,
    "",
    "待执行任务预览：",
    ...formatTaskPreview(backlog.tasks),
    "",
    "验证命令预览：",
    ...formatList(verifyCommands, "未配置 verify.yaml，执行阶段将仅依赖任务自带验证"),
  ].join("\n");
}

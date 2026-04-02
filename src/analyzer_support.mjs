import path from "node:path";

import { selectNextTask, summarizeBacklog } from "./backlog.mjs";
import { loadBacklog, writeStateMarkdown, writeStatus } from "./config.mjs";
import {
  normalizeTaskLane,
  normalizeTaskParallelGroup,
  normalizeTaskRole,
  normalizeTaskStage,
} from "./workflow_model.mjs";

export function renderAnalysisState(context, backlog, analysis) {
  const summary = summarizeBacklog(backlog);
  const nextTask = selectNextTask(backlog);

  return [
    "## 当前状态",
    `- backlog 文件：${path.relative(context.repoRoot, context.backlogFile).replaceAll("\\", "/")}`,
    `- 总任务数：${summary.total}`,
    `- 已完成：${summary.done}`,
    `- 待处理：${summary.pending}`,
    `- 进行中：${summary.inProgress}`,
    `- 失败：${summary.failed}`,
    `- 阻塞：${summary.blocked}`,
    `- 当前任务：${nextTask ? nextTask.title : "无"}`,
    `- 主线流程：${analysis.workflow?.mainlineSummary || "无"}`,
    `- 并行 lane：${(analysis.workflow?.parallelLanes || []).join(" / ") || "mainline"}`,
    `- 文档画像：${analysis.docAnalysis?.summary || "无"}`,
    `- 最近结果：${analysis.summary.currentState}`,
    `- 下一建议：${analysis.summary.nextAction}`,
  ].join("\n");
}

function createEmptyBacklogSummary() {
  return {
    total: 0,
    pending: 0,
    inProgress: 0,
    done: 0,
    failed: 0,
    blocked: 0,
  };
}

export function getExistingBacklogSnapshot(context) {
  try {
    const backlog = loadBacklog(context);
    return {
      summary: summarizeBacklog(backlog),
      nextTask: selectNextTask(backlog),
    };
  } catch {
    return {
      summary: createEmptyBacklogSummary(),
      nextTask: null,
    };
  }
}

function firstMeaningfulLine(text, fallback) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || fallback;
}

export function summarizeFailedAnalysisResult(result, fallback) {
  const combined = [
    String(result?.stdout || "").trim(),
    String(result?.stderr || "").trim(),
  ].filter(Boolean).join("\n\n").trim();
  return combined || fallback;
}

function renderAnalysisFailureState(context, backlogSummary, nextTask, failureSummary, runDir = "") {
  const runDirHint = runDir
    ? path.relative(context.repoRoot, runDir).replaceAll("\\", "/")
    : "";

  return [
    "## 当前状态",
    `- backlog 文件：${path.relative(context.repoRoot, context.backlogFile).replaceAll("\\", "/")}`,
    `- 总任务数：${backlogSummary.total}`,
    `- 已完成：${backlogSummary.done}`,
    `- 待处理：${backlogSummary.pending}`,
    `- 进行中：${backlogSummary.inProgress}`,
    `- 失败：${backlogSummary.failed}`,
    `- 阻塞：${backlogSummary.blocked}`,
    `- 当前任务：${nextTask ? nextTask.title : "无"}`,
    `- 最近结果：${firstMeaningfulLine(failureSummary, "HelloLoop 分析失败")}`,
    `- 下一建议：${runDirHint ? `先检查 ${runDirHint} 中的日志后再重新执行 npx helloloop` : "修复错误后重新执行 npx helloloop"}`,
  ].join("\n");
}

export function persistAnalysisFailure(context, failureSummary, runDir = "") {
  const snapshot = getExistingBacklogSnapshot(context);
  writeStatus(context, {
    ok: false,
    stage: "analysis_failed",
    taskId: null,
    taskTitle: "",
    runDir,
    summary: snapshot.summary,
    message: failureSummary,
  });
  writeStateMarkdown(
    context,
    renderAnalysisFailureState(context, snapshot.summary, snapshot.nextTask, failureSummary, runDir),
  );
}

function sanitizeTask(task) {
  const stage = normalizeTaskStage(task.stage, "implementation");
  const defaultRoleByStage = {
    product: "product_owner",
    architecture: "architect",
    contract: "control",
    implementation: "developer",
    test: "tester",
    review: "reviewer",
    release: "release_manager",
    operate: "supervisor",
  };
  return {
    id: String(task.id || "").trim(),
    title: String(task.title || "").trim(),
    status: ["done", "blocked"].includes(String(task.status || "")) ? String(task.status) : "pending",
    priority: ["P0", "P1", "P2", "P3"].includes(String(task.priority || "")) ? String(task.priority) : "P2",
    risk: ["medium", "high", "critical"].includes(String(task.risk || "")) ? String(task.risk) : "low",
    stage,
    role: normalizeTaskRole(task.role, defaultRoleByStage[stage] || "developer"),
    lane: normalizeTaskLane(task.lane, "mainline"),
    parallelGroup: normalizeTaskParallelGroup(task.parallelGroup),
    goal: String(task.goal || "").trim(),
    docs: Array.isArray(task.docs) ? task.docs.map((item) => String(item || "").trim()).filter(Boolean) : [],
    paths: Array.isArray(task.paths) ? task.paths.map((item) => String(item || "").trim()).filter(Boolean) : [],
    artifacts: Array.isArray(task.artifacts) ? task.artifacts.map((item) => String(item || "").trim()).filter(Boolean) : [],
    blockedBy: Array.isArray(task.blockedBy)
      ? task.blockedBy.map((item) => ({
        type: ["task", "repo", "manual_input", "approval", "artifact", "external_system"].includes(String(item?.type || ""))
          ? String(item.type)
          : "task",
        id: String(item?.id || item?.label || "").trim(),
        label: String(item?.label || item?.id || "").trim(),
        status: String(item?.status || "").trim() === "resolved" ? "resolved" : "open",
      })).filter((item) => item.id && item.label)
      : [],
    acceptance: Array.isArray(task.acceptance) ? task.acceptance.map((item) => String(item || "").trim()).filter(Boolean) : [],
    dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.map((item) => String(item || "").trim()).filter(Boolean) : [],
    verify: Array.isArray(task.verify) ? task.verify.map((item) => String(item || "").trim()).filter(Boolean) : [],
  };
}

function normalizeTaskDependencies(tasks) {
  const knownTaskIds = new Set(tasks.map((task) => task.id));
  return tasks.map((task) => ({
    ...task,
    dependsOn: task.dependsOn.filter((depId) => depId !== task.id && knownTaskIds.has(depId)),
    blockedBy: task.blockedBy.filter((item) => !(item.type === "task" && (!item.id || item.id === task.id))),
  }));
}

function normalizeWorkflowPayload(payloadWorkflow, derivedWorkflow) {
  const phaseOrder = Array.isArray(payloadWorkflow?.phaseOrder) && payloadWorkflow.phaseOrder.length
    ? payloadWorkflow.phaseOrder.map((item) => normalizeTaskStage(item, "implementation"))
    : (derivedWorkflow?.phaseOrder || []);
  const parallelLanes = Array.isArray(payloadWorkflow?.parallelLanes) && payloadWorkflow.parallelLanes.length
    ? payloadWorkflow.parallelLanes.map((item) => normalizeTaskLane(item, "mainline"))
    : (derivedWorkflow?.parallelLanes || []);
  const coordinationRules = Array.isArray(payloadWorkflow?.coordinationRules)
    ? payloadWorkflow.coordinationRules.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  return {
    methodology: String(derivedWorkflow?.methodology || "hierarchical_role_based_agile_multi_agent_sdlc").trim(),
    profile: String(derivedWorkflow?.profile || "generic_repo").trim(),
    profileLabel: String(derivedWorkflow?.profileLabel || "通用代码仓").trim(),
    orchestrationMode: String(derivedWorkflow?.orchestrationMode || "central_supervisor").trim(),
    parallelStrategy: String(derivedWorkflow?.parallelStrategy || "ordered_mainline").trim(),
    docCoverageSummary: String(derivedWorkflow?.docCoverageSummary || "").trim(),
    currentFocus: String(payloadWorkflow?.currentFocus || derivedWorkflow?.currentFocus || "").trim() || "先对齐主线，再执行当前仓库 backlog。",
    mainlineSummary: String(payloadWorkflow?.mainlineSummary || derivedWorkflow?.mainlineSummary || "").trim() || "按分层 SDLC 主线推进。",
    phaseOrder,
    parallelLanes,
    coordinationRules: coordinationRules.length
      ? coordinationRules
      : (Array.isArray(derivedWorkflow?.coordinationRules) ? derivedWorkflow.coordinationRules : []),
  };
}

export function normalizeAnalysisPayload(payload, options = {}) {
  const docsEntries = Array.isArray(options.docsEntries) ? options.docsEntries : [];
  const derivedDocAnalysis = options.derivedDocAnalysis && typeof options.derivedDocAnalysis === "object"
    ? options.derivedDocAnalysis
    : { summary: "", gaps: [], entries: [] };
  const derivedWorkflow = options.derivedWorkflow && typeof options.derivedWorkflow === "object"
    ? options.derivedWorkflow
    : null;
  const summary = {
    currentState: String(payload?.summary?.currentState || "").trim() || "已完成接续分析。",
    implemented: Array.isArray(payload?.summary?.implemented) ? payload.summary.implemented.map((item) => String(item || "").trim()).filter(Boolean) : [],
    remaining: Array.isArray(payload?.summary?.remaining) ? payload.summary.remaining.map((item) => String(item || "").trim()).filter(Boolean) : [],
    nextAction: String(payload?.summary?.nextAction || "").trim() || "查看下一任务。",
  };
  const tasks = Array.isArray(payload.tasks)
    ? payload.tasks.map((task) => sanitizeTask(task)).filter((task) => (
      task.id && task.title && task.goal && task.acceptance.length
    ))
    : [];
  const normalizedTasks = normalizeTaskDependencies(tasks);

  if (!normalizedTasks.length && summary.remaining.length) {
    throw new Error("分析结果无效：仍存在剩余工作，但未生成可用任务。");
  }

  const requestInterpretation = payload?.requestInterpretation && typeof payload.requestInterpretation === "object"
    ? {
      summary: String(payload.requestInterpretation.summary || "").trim(),
      priorities: Array.isArray(payload.requestInterpretation.priorities)
        ? payload.requestInterpretation.priorities.map((item) => String(item || "").trim()).filter(Boolean)
        : [],
      cautions: Array.isArray(payload.requestInterpretation.cautions)
        ? payload.requestInterpretation.cautions.map((item) => String(item || "").trim()).filter(Boolean)
        : [],
    }
    : null;
  const repoDecision = payload?.repoDecision && typeof payload.repoDecision === "object"
    ? {
      compatibility: ["compatible", "conflict", "uncertain"].includes(String(payload.repoDecision.compatibility || ""))
        ? String(payload.repoDecision.compatibility)
        : "compatible",
      action: ["continue_existing", "confirm_rebuild", "start_new"].includes(String(payload.repoDecision.action || ""))
        ? String(payload.repoDecision.action)
        : "continue_existing",
      reason: String(payload.repoDecision.reason || "").trim(),
    }
    : null;

  return {
    project: String(payload.project || "").trim() || "helloloop-project",
    summary,
    workflow: normalizeWorkflowPayload(payload?.workflow, derivedWorkflow),
    docAnalysis: derivedDocAnalysis,
    constraints: Array.isArray(payload.constraints)
      ? payload.constraints.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    requestInterpretation: requestInterpretation && (
      requestInterpretation.summary
      || requestInterpretation.priorities.length
      || requestInterpretation.cautions.length
    )
      ? requestInterpretation
      : null,
    repoDecision: repoDecision && repoDecision.reason
      ? repoDecision
      : null,
    tasks: normalizedTasks,
    requiredDocs: docsEntries,
  };
}

export function buildAnalysisSummaryText(context, analysis, backlog, engineResolution) {
  const summary = summarizeBacklog(backlog);
  const nextTask = selectNextTask(backlog);

  return [
    "HelloLoop 已完成接续分析。",
    `项目仓库：${context.repoRoot}`,
    `开发文档：${analysis.requiredDocs.join(", ")}`,
    `执行引擎：${engineResolution?.displayName || "未记录"}`,
    `工作流：${analysis.workflow?.profileLabel || "未记录"} / ${(analysis.workflow?.parallelLanes || []).join(" / ") || "mainline"}`,
    "",
    "当前进度：",
    analysis.summary.currentState,
    analysis.workflow?.mainlineSummary || "",
    analysis.docAnalysis?.summary || "",
    "",
    `任务统计：done ${summary.done} / pending ${summary.pending} / blocked ${summary.blocked}`,
    nextTask ? `下一任务：${nextTask.title}` : "下一任务：暂无可执行任务",
    "",
    "下一步建议：",
    `- npx helloloop`,
    `- npx helloloop --dry-run`,
  ].join("\n");
}

export function buildCurrentWorkspaceDiscovery(context, docsEntries) {
  return {
    ok: true,
    repoRoot: context.repoRoot,
    docsEntries,
    resolvedDocs: docsEntries,
    resolution: {
      repo: {
        source: "current_repo",
        sourceLabel: "当前项目",
        confidence: "high",
        confidenceLabel: "高",
        path: context.repoRoot,
        exists: true,
        basis: [
          "已在当前项目基础上执行主线终态复核。",
        ],
      },
      docs: {
        source: "existing_state",
        sourceLabel: "已有 .helloloop 配置",
        confidence: "high",
        confidenceLabel: "高",
        entries: docsEntries,
        basis: [
          "已复用 `.helloloop/project.json` 中记录的 requiredDocs。",
        ],
      },
    },
  };
}

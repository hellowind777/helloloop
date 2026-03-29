import path from "node:path";

import { summarizeBacklog, selectNextTask } from "./backlog.mjs";
import { nowIso, writeJson, writeText, readTextIfExists } from "./common.mjs";
import { loadPolicy, loadProjectConfig, scaffoldIfMissing, writeStateMarkdown, writeStatus } from "./config.mjs";
import { createContext } from "./context.mjs";
import { discoverWorkspace } from "./discovery.mjs";
import { readDocumentPackets } from "./doc_loader.mjs";
import {
  classifySwitchableEngineFailure,
  promptEngineFallbackAfterFailure,
  rememberEngineSelection,
  resolveEngineSelection,
} from "./engine_selection.mjs";
import { getEngineDisplayName } from "./engine_metadata.mjs";
import { runEngineTask } from "./process.mjs";
import { buildAnalysisPrompt } from "./analyze_prompt.mjs";

function renderAnalysisState(context, backlog, analysis) {
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
    `- 最近结果：${analysis.summary.currentState}`,
    `- 下一建议：${analysis.summary.nextAction}`,
  ].join("\n");
}

function sanitizeTask(task) {
  return {
    id: String(task.id || "").trim(),
    title: String(task.title || "").trim(),
    status: ["done", "blocked"].includes(String(task.status || "")) ? String(task.status) : "pending",
    priority: ["P0", "P1", "P2", "P3"].includes(String(task.priority || "")) ? String(task.priority) : "P2",
    risk: ["medium", "high", "critical"].includes(String(task.risk || "")) ? String(task.risk) : "low",
    goal: String(task.goal || "").trim(),
    docs: Array.isArray(task.docs) ? task.docs.map((item) => String(item || "").trim()).filter(Boolean) : [],
    paths: Array.isArray(task.paths) ? task.paths.map((item) => String(item || "").trim()).filter(Boolean) : [],
    acceptance: Array.isArray(task.acceptance) ? task.acceptance.map((item) => String(item || "").trim()).filter(Boolean) : [],
    dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.map((item) => String(item || "").trim()).filter(Boolean) : [],
    verify: Array.isArray(task.verify) ? task.verify.map((item) => String(item || "").trim()).filter(Boolean) : [],
  };
}

function normalizeAnalysisPayload(payload, docsEntries) {
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

  if (!tasks.length && summary.remaining.length) {
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
    tasks,
    requiredDocs: docsEntries,
  };
}

function buildAnalysisSummaryText(context, analysis, backlog, engineResolution) {
  const summary = summarizeBacklog(backlog);
  const nextTask = selectNextTask(backlog);

  return [
    "HelloLoop 已完成接续分析。",
    `项目仓库：${context.repoRoot}`,
    `开发文档：${analysis.requiredDocs.join(", ")}`,
    `执行引擎：${engineResolution?.displayName || "未记录"}`,
    "",
    "当前进度：",
    analysis.summary.currentState,
    "",
    `任务统计：done ${summary.done} / pending ${summary.pending} / blocked ${summary.blocked}`,
    nextTask ? `下一任务：${nextTask.title}` : "下一任务：暂无可执行任务",
    "",
    "下一步建议：",
    `- npx helloloop`,
    `- npx helloloop --dry-run`,
  ].join("\n");
}

async function analyzeResolvedWorkspace(context, discovery, options = {}) {
  scaffoldIfMissing(context);
  const policy = loadPolicy(context);
  let engineResolution = options.engineResolution?.ok
    ? options.engineResolution
    : await resolveEngineSelection({
      context,
      policy,
      options,
      interactive: !options.yes,
    });
  if (!engineResolution.ok) {
    return {
      ok: false,
      code: engineResolution.code,
      summary: engineResolution.message,
      discovery,
      engineResolution,
    };
  }

  const existingProjectConfig = loadProjectConfig(context);
  const existingStateText = readTextIfExists(context.stateFile, "");
  const existingBacklogText = readTextIfExists(context.backlogFile, "");
  const docPackets = readDocumentPackets(context.repoRoot, discovery.docsEntries, {
    maxCharsPerFile: 18000,
    maxTotalChars: 90000,
  });

  const prompt = buildAnalysisPrompt({
    repoRoot: context.repoRoot,
    repoOriginallyExisted: discovery?.resolution?.repo?.exists !== false,
    docsEntries: discovery.docsEntries,
    docPackets,
    existingStateText,
    existingBacklogText,
    existingProjectConstraints: existingProjectConfig.constraints,
    userIntent: options.userIntent,
  });

  const runDir = path.join(context.runsDir, `${nowIso().replaceAll(":", "-").replaceAll(".", "-")}-analysis`);
  const schemaFile = path.join(context.templatesDir, "analysis-output.schema.json");
  let analysisResult = await runEngineTask({
    engine: engineResolution.engine,
    context,
    prompt,
    runDir,
    policy,
    executionMode: "analyze",
    outputSchemaFile: schemaFile,
    outputPrefix: `${engineResolution.engine}-analysis`,
    skipGitRepoCheck: true,
  });

  if (!analysisResult.ok) {
    const failureText = [
      analysisResult.stderr,
      analysisResult.stdout,
    ].filter(Boolean).join("\n").trim();
    const switchableFailure = classifySwitchableEngineFailure(failureText);
    if (switchableFailure && !options.yes) {
      const fallback = await promptEngineFallbackAfterFailure({
        failedEngine: engineResolution.engine,
        hostContext: engineResolution.hostContext,
        probes: engineResolution.probes,
        failureSummary: switchableFailure.reason,
      });
      if (fallback.ok) {
        engineResolution = {
          ...engineResolution,
          engine: fallback.engine,
          displayName: getEngineDisplayName(fallback.engine),
          source: "interactive_fallback",
          sourceLabel: "故障后交互切换",
          basis: [
            `${getEngineDisplayName(engineResolution.engine)} 分析阶段失败。`,
            switchableFailure.reason,
            `用户改为选择 ${getEngineDisplayName(fallback.engine)}。`,
          ],
        };
        analysisResult = await runEngineTask({
          engine: engineResolution.engine,
          context,
          prompt,
          runDir,
          policy,
          executionMode: "analyze",
          outputSchemaFile: schemaFile,
          outputPrefix: `${engineResolution.engine}-analysis`,
          skipGitRepoCheck: true,
        });
      }
    }
  }

  if (!analysisResult.ok) {
    return {
      ok: false,
      code: "analysis_failed",
      summary: analysisResult.stderr || analysisResult.stdout || `${engineResolution.displayName} 接续分析失败。`,
      engineResolution,
      discovery,
    };
  }

  let payload;
  try {
    payload = JSON.parse(analysisResult.finalMessage);
  } catch (error) {
    return {
      ok: false,
      code: "invalid_analysis_json",
      summary: `${engineResolution.displayName} 分析结果无法解析为 JSON：${String(error?.message || error || "")}`,
      engineResolution,
      discovery,
    };
  }

  const analysis = normalizeAnalysisPayload(payload, discovery.docsEntries);
  const backlog = {
    version: 1,
    project: analysis.project,
    updatedAt: nowIso(),
    tasks: analysis.tasks,
  };

  const projectConfig = {
    requiredDocs: analysis.requiredDocs,
    constraints: analysis.constraints.length ? analysis.constraints : existingProjectConfig.constraints,
    defaultEngine: existingProjectConfig.defaultEngine,
    lastSelectedEngine: engineResolution.engine,
    planner: existingProjectConfig.planner,
  };

  writeJson(context.backlogFile, backlog);
  writeJson(context.projectFile, projectConfig);
  rememberEngineSelection(context, engineResolution, options);
  writeStateMarkdown(context, renderAnalysisState(context, backlog, analysis));
  writeStatus(context, {
    ok: true,
    stage: "analyzed",
    taskId: null,
    taskTitle: "",
    runDir,
    summary: summarizeBacklog(backlog),
    message: analysis.summary.currentState,
  });
  writeText(path.join(runDir, "analysis-summary.txt"), buildAnalysisSummaryText(context, analysis, backlog, engineResolution));

  return {
    ok: true,
    code: "analyzed",
    context,
    runDir,
    engineResolution,
    analysis,
    backlog,
    summary: buildAnalysisSummaryText(context, analysis, backlog, engineResolution),
    discovery,
  };
}

function buildCurrentWorkspaceDiscovery(context, docsEntries) {
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

export async function reanalyzeCurrentWorkspace(context, options = {}) {
  const existingProjectConfig = loadProjectConfig(context);
  const docsEntries = Array.isArray(options.requiredDocs) && options.requiredDocs.length
    ? options.requiredDocs
    : existingProjectConfig.requiredDocs;

  if (!docsEntries.length) {
    return {
      ok: false,
      code: "missing_docs",
      summary: "当前 `.helloloop/project.json` 未记录 requiredDocs，无法执行主线终态复核。",
      discovery: null,
    };
  }

  return analyzeResolvedWorkspace(
    context,
    buildCurrentWorkspaceDiscovery(context, docsEntries),
    options,
  );
}

export async function analyzeWorkspace(options = {}) {
  const discovery = discoverWorkspace({
    cwd: options.cwd,
    inputPath: options.inputPath,
    repoRoot: options.repoRoot,
    docsPath: options.docsPath,
    configDirName: options.configDirName,
    allowNewRepoRoot: options.allowNewRepoRoot,
  });

  if (!discovery.ok) {
    return {
      ok: false,
      code: discovery.code,
      summary: discovery.message,
      discovery,
    };
  }

  const context = createContext({
    repoRoot: discovery.repoRoot,
    configDirName: options.configDirName,
  });
  return analyzeResolvedWorkspace(context, discovery, options);
}

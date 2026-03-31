import path from "node:path";

import { summarizeBacklog } from "./backlog.mjs";
import { nowIso, writeJson, writeText, readTextIfExists } from "./common.mjs";
import {
  loadPolicy,
  loadProjectConfig,
  scaffoldIfMissing,
  writeStateMarkdown,
  writeStatus,
} from "./config.mjs";
import { createContext } from "./context.mjs";
import { discoverWorkspace } from "./discovery.mjs";
import { readDocumentPackets } from "./doc_loader.mjs";
import {
  rememberEngineSelection,
  resolveEngineSelection,
} from "./engine_selection.mjs";
import { shouldPromptForEngineSelection } from "./execution_interactivity.mjs";
import {
  buildAnalysisSummaryText,
  buildCurrentWorkspaceDiscovery,
  normalizeAnalysisPayload,
  persistAnalysisFailure,
  renderAnalysisState,
  summarizeFailedAnalysisResult,
} from "./analyzer_support.mjs";
import { runEngineTask } from "./process.mjs";
import { buildAnalysisPrompt } from "./analyze_prompt.mjs";

async function analyzeResolvedWorkspace(context, discovery, options = {}) {
  scaffoldIfMissing(context);
  const policy = loadPolicy(context);
  let engineResolution = options.engineResolution?.ok
    ? options.engineResolution
    : await resolveEngineSelection({
      context,
      policy,
      options,
      interactive: shouldPromptForEngineSelection(options),
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
    hostLease: options.hostLease || null,
  });

  if (!analysisResult.ok) {
    if (analysisResult.leaseExpired) {
      return {
        ok: false,
        code: "host-lease-stopped",
        summary: analysisResult.leaseReason || "检测到宿主窗口已关闭，主线终态复核已停止。",
        stopped: true,
        engineResolution,
        discovery,
      };
    }
    const failureSummary = summarizeFailedAnalysisResult(
      analysisResult,
      `${engineResolution.displayName} 接续分析失败。`,
    );
    persistAnalysisFailure(
      context,
      failureSummary,
      runDir,
    );
    return {
      ok: false,
      code: "analysis_failed",
      summary: failureSummary,
      engineResolution,
      discovery,
    };
  }

  let payload;
  try {
    payload = JSON.parse(analysisResult.finalMessage);
  } catch (error) {
    persistAnalysisFailure(
      context,
      `${engineResolution.displayName} 分析结果无法解析为 JSON：${String(error?.message || error || "")}`,
      runDir,
    );
    return {
      ok: false,
      code: "invalid_analysis_json",
      summary: `${engineResolution.displayName} 分析结果无法解析为 JSON：${String(error?.message || error || "")}`,
      engineResolution,
      discovery,
    };
  }

  let analysis;
  try {
    analysis = normalizeAnalysisPayload(payload, discovery.docsEntries);
  } catch (error) {
    persistAnalysisFailure(
      context,
      `${engineResolution.displayName} 分析结果无效：${String(error?.message || error || "")}`,
      runDir,
    );
    return {
      ok: false,
      code: "invalid_analysis_payload",
      summary: `${engineResolution.displayName} 分析结果无效：${String(error?.message || error || "")}`,
      engineResolution,
      discovery,
    };
  }

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

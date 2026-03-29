import path from "node:path";

import { summarizeBacklog, selectNextTask } from "./backlog.mjs";
import { nowIso, writeJson, writeText, readTextIfExists } from "./common.mjs";
import { loadPolicy, loadProjectConfig, scaffoldIfMissing, writeStateMarkdown, writeStatus } from "./config.mjs";
import { createContext } from "./context.mjs";
import { discoverWorkspace } from "./discovery.mjs";
import { readDocumentPackets } from "./doc_loader.mjs";
import { runCodexTask } from "./process.mjs";
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
  const tasks = Array.isArray(payload.tasks)
    ? payload.tasks.map((task) => sanitizeTask(task)).filter((task) => (
      task.id && task.title && task.goal && task.acceptance.length
    ))
    : [];

  if (!tasks.length) {
    throw new Error("Codex 分析结果无效：未生成可用任务。");
  }

  return {
    project: String(payload.project || "").trim() || "helloloop-project",
    summary: {
      currentState: String(payload?.summary?.currentState || "").trim() || "已完成接续分析。",
      implemented: Array.isArray(payload?.summary?.implemented) ? payload.summary.implemented.map((item) => String(item || "").trim()).filter(Boolean) : [],
      remaining: Array.isArray(payload?.summary?.remaining) ? payload.summary.remaining.map((item) => String(item || "").trim()).filter(Boolean) : [],
      nextAction: String(payload?.summary?.nextAction || "").trim() || "查看下一任务。",
    },
    constraints: Array.isArray(payload.constraints)
      ? payload.constraints.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    tasks,
    requiredDocs: docsEntries,
  };
}

function buildAnalysisSummaryText(context, analysis, backlog) {
  const summary = summarizeBacklog(backlog);
  const nextTask = selectNextTask(backlog);

  return [
    "HelloLoop 已完成接续分析。",
    `项目仓库：${context.repoRoot}`,
    `开发文档：${analysis.requiredDocs.join(", ")}`,
    "",
    "当前进度：",
    analysis.summary.currentState,
    "",
    `任务统计：done ${summary.done} / pending ${summary.pending} / blocked ${summary.blocked}`,
    nextTask ? `下一任务：${nextTask.title}` : "下一任务：暂无可执行任务",
    "",
    "下一步建议：",
    `- npx helloloop next`,
    `- npx helloloop run-once`,
  ].join("\n");
}

export async function analyzeWorkspace(options = {}) {
  const discovery = discoverWorkspace({
    cwd: options.cwd,
    inputPath: options.inputPath,
    repoRoot: options.repoRoot,
    docsPath: options.docsPath,
    configDirName: options.configDirName,
  });

  if (!discovery.ok) {
    return {
      ok: false,
      code: discovery.code,
      summary: discovery.message,
    };
  }

  const context = createContext({
    repoRoot: discovery.repoRoot,
    configDirName: options.configDirName,
  });
  scaffoldIfMissing(context);

  const existingProjectConfig = loadProjectConfig(context);
  const existingStateText = readTextIfExists(context.stateFile, "");
  const existingBacklogText = readTextIfExists(context.backlogFile, "");
  const docPackets = readDocumentPackets(context.repoRoot, discovery.docsEntries, {
    maxCharsPerFile: 18000,
    maxTotalChars: 90000,
  });

  const prompt = buildAnalysisPrompt({
    repoRoot: context.repoRoot,
    docsEntries: discovery.docsEntries,
    docPackets,
    existingStateText,
    existingBacklogText,
    existingProjectConstraints: existingProjectConfig.constraints,
  });

  const runDir = path.join(context.runsDir, `${nowIso().replaceAll(":", "-").replaceAll(".", "-")}-analysis`);
  const policy = loadPolicy(context);
  const schemaFile = path.join(context.templatesDir, "analysis-output.schema.json");
  const codexResult = await runCodexTask({
    context,
    prompt,
    runDir,
    model: policy.codex.model,
    executable: policy.codex.executable,
    sandbox: policy.codex.sandbox,
    dangerouslyBypassSandbox: policy.codex.dangerouslyBypassSandbox,
    outputSchemaFile: schemaFile,
    outputPrefix: "analysis",
    jsonOutput: false,
    skipGitRepoCheck: true,
  });

  if (!codexResult.ok) {
    return {
      ok: false,
      code: "analysis_failed",
      summary: codexResult.stderr || codexResult.stdout || "Codex 接续分析失败。",
    };
  }

  let payload;
  try {
    payload = JSON.parse(codexResult.finalMessage);
  } catch (error) {
    return {
      ok: false,
      code: "invalid_analysis_json",
      summary: `Codex 分析结果无法解析为 JSON：${String(error?.message || error || "")}`,
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
    planner: existingProjectConfig.planner,
  };

  writeJson(context.backlogFile, backlog);
  writeJson(context.projectFile, projectConfig);
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
  writeText(path.join(runDir, "analysis-summary.txt"), buildAnalysisSummaryText(context, analysis, backlog));

  return {
    ok: true,
    code: "analyzed",
    context,
    runDir,
    analysis,
    backlog,
    summary: buildAnalysisSummaryText(context, analysis, backlog),
  };
}

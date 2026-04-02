import path from "node:path";

import { formatList, tailText } from "./common.mjs";
import { runEngineTask } from "./process.mjs";
import { formatTaskRoleLabel, formatTaskStageLabel } from "./workflow_model.mjs";

function section(title, content) {
  if (!content || !String(content).trim()) {
    return "";
  }
  return `## ${title}\n${String(content).trim()}\n`;
}

function listSection(title, items) {
  if (!Array.isArray(items) || !items.length) {
    return "";
  }
  return section(title, formatList(items));
}

function normalizeDocEntry(doc) {
  return String(doc || "").trim().replaceAll("\\", "/");
}

function normalizeDocList(items) {
  const result = [];
  const seen = new Set();

  for (const item of items || []) {
    const normalized = normalizeDocEntry(item);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function renderVerifyResultLines(verifyResult) {
  if (!verifyResult?.results?.length) {
    return [
      "- 未执行额外验证命令",
    ];
  }

  return verifyResult.results.map((item) => {
    const stdoutTail = tailText(item.stdout, 6) || "无";
    const stderrTail = tailText(item.stderr, 6) || "无";
    return [
      `- ${item.ok ? "通过" : "失败"}：${item.command}`,
      `  stdout: ${stdoutTail}`,
      `  stderr: ${stderrTail}`,
    ].join("\n");
  });
}

function buildTaskReviewPrompt({
  task,
  requiredDocs = [],
  constraints = [],
  repoStateText = "",
  engineFinalMessage = "",
  verifyResult = null,
}) {
  const allDocs = normalizeDocList([
    ...requiredDocs,
    ...(task.docs || []),
  ]);

  return [
    "你要做的是“任务完成复核”，目标是判断当前任务是否真的已经完成。",
    "不要相信执行代理口头说“已完成”；必须直接检查仓库当前代码、测试和产物。",
    "如果只是做到一半、只改了部分文件、或者验收条件仍缺项，都不能判定为完成。",
    "",
    section("当前任务", [
      `- 标题：${task.title}`,
      `- 编号：${task.id}`,
      `- 目标：${task.goal || "按文档完成当前工作包。"}`,
      `- 风险：${task.risk || "low"}`,
      `- 阶段：${formatTaskStageLabel(task.stage || "implementation")}`,
      `- 角色：${formatTaskRoleLabel(task.role || "developer")}`,
      `- lane：${task.lane || "mainline"}`,
    ].join("\n")),
    listSection("开发文档", allDocs),
    listSection("涉及路径", task.paths || []),
    listSection("关键产物", task.artifacts || []),
    listSection("显式阻塞", Array.isArray(task.blockedBy)
      ? task.blockedBy.map((item) => `${item.type}:${item.label} (${item.status})`)
      : []),
    listSection("验收条件", task.acceptance || []),
    constraints.length ? listSection("项目约束", constraints) : "",
    repoStateText ? section("当前仓库状态摘要", repoStateText) : "",
    engineFinalMessage
      ? section("执行代理最后输出", tailText(engineFinalMessage, 20))
      : "",
    section("验证结果", renderVerifyResultLines(verifyResult).join("\n")),
    section("判定规则", [
      "1. 只有当所有验收条件都有明确仓库证据支撑时，才能输出 `complete`。",
      "2. 只要有任一验收条件未满足、证据不足、或只能部分成立，就输出 `incomplete`。",
      "3. 只有外部权限、环境损坏、文档缺口、不可获得依赖等真正硬阻塞，才允许输出 `blocked`。",
      "4. “代理提前停止”“只完成一部分”“建议下次继续”都属于 `incomplete`，不是 `blocked`。",
      "5. 不要给泛泛建议，`missing` 和 `nextAction` 必须直接指出还差什么。",
    ].join("\n")),
    section("输出要求", [
      "1. 严格输出 JSON，不要带 Markdown 代码块。",
      "2. `verdict` 只能是 `complete`、`incomplete`、`blocked`。",
      "3. `acceptanceChecks` 必须逐条覆盖本任务所有验收条件。",
      "4. `acceptanceChecks[].status` 只能是 `met`、`not_met`、`uncertain`。",
      "5. `acceptanceChecks[].evidence` 必须写具体证据或缺口，不能只写“已完成”。",
      "6. 若 `verdict=complete`，则所有 `acceptanceChecks[].status` 必须都是 `met`，且 `missing` 为空。",
      "7. 若 `verdict=blocked`，`blockerReason` 必须明确写出硬阻塞原因。",
    ].join("\n")),
  ].filter(Boolean).join("\n");
}

function normalizeAcceptanceCheck(check) {
  return {
    item: String(check?.item || "").trim(),
    status: ["met", "not_met", "uncertain"].includes(String(check?.status || ""))
      ? String(check.status)
      : "uncertain",
    evidence: String(check?.evidence || "").trim() || "未提供可用证据。",
  };
}

function normalizeTaskReviewPayload(payload, task) {
  const requestedAcceptance = Array.isArray(task?.acceptance)
    ? task.acceptance.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const receivedChecks = Array.isArray(payload?.acceptanceChecks)
    ? payload.acceptanceChecks.map((item) => normalizeAcceptanceCheck(item)).filter((item) => item.item)
    : [];

  const normalizedChecks = requestedAcceptance.map((item) => {
    const matched = receivedChecks.find((check) => check.item === item);
    return matched || {
      item,
      status: "uncertain",
      evidence: "复核结果未覆盖该验收条件。",
    };
  });

  const missing = Array.isArray(payload?.missing)
    ? payload.missing.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const blockerReason = String(payload?.blockerReason || "").trim();
  const requestedVerdict = ["complete", "incomplete", "blocked"].includes(String(payload?.verdict || ""))
    ? String(payload.verdict)
    : "incomplete";
  const hasUnmetAcceptance = normalizedChecks.some((item) => item.status !== "met");
  const verdict = requestedVerdict === "complete" && (hasUnmetAcceptance || missing.length)
    ? "incomplete"
    : requestedVerdict;

  return {
    verdict,
    summary: String(payload?.summary || "").trim() || "任务完成复核已结束。",
    acceptanceChecks: normalizedChecks,
    missing,
    blockerReason,
    nextAction: String(payload?.nextAction || "").trim() || "请根据缺口继续完成当前任务。",
    isComplete: verdict === "complete" && !hasUnmetAcceptance && missing.length === 0,
  };
}

export function renderTaskReviewSummary(review) {
  const acceptanceLines = review.acceptanceChecks.map((item) => (
    `- ${item.status === "met" ? "已满足" : (item.status === "not_met" ? "未满足" : "待确认")}：${item.item}；${item.evidence}`
  ));

  return [
    `任务复核结论：${review.summary}`,
    ...acceptanceLines,
    ...(review.missing.length
      ? review.missing.map((item) => `- 剩余缺口：${item}`)
      : []),
    review.blockerReason ? `- 硬阻塞：${review.blockerReason}` : "",
    `- 下一动作：${review.nextAction}`,
  ].filter(Boolean).join("\n");
}

export async function reviewTaskCompletion({
  engine,
  context,
  task,
  requiredDocs = [],
  constraints = [],
  repoStateText = "",
  engineFinalMessage = "",
  verifyResult = null,
  runDir,
  policy = {},
  hostLease = null,
}) {
  const prompt = buildTaskReviewPrompt({
    task,
    requiredDocs,
    constraints,
    repoStateText,
    engineFinalMessage,
    verifyResult,
  });
  const schemaFile = path.join(context.templatesDir, "task-review-output.schema.json");
  const reviewResult = await runEngineTask({
    engine,
    context,
    prompt,
    runDir,
    policy,
    executionMode: "analyze",
    outputSchemaFile: schemaFile,
    outputPrefix: `${engine}-task-review`,
    skipGitRepoCheck: true,
    hostLease,
  });

  if (!reviewResult.ok) {
    return {
      ok: false,
      code: "task_review_failed",
      summary: reviewResult.stderr || reviewResult.stdout || "任务完成复核失败。",
      raw: reviewResult,
    };
  }

  let payload;
  try {
    payload = JSON.parse(reviewResult.finalMessage);
  } catch (error) {
    return {
      ok: false,
      code: "invalid_task_review_json",
      summary: `任务完成复核结果无法解析为 JSON：${String(error?.message || error || "")}`,
      raw: reviewResult,
    };
  }

  const review = normalizeTaskReviewPayload(payload, task);
  return {
    ok: true,
    code: "task_reviewed",
    review,
    summary: renderTaskReviewSummary(review),
    raw: reviewResult,
  };
}

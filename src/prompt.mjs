import { formatList } from "./common.mjs";
import {
  hasCustomProjectConstraints,
  listMandatoryGuardrails,
  listMandatoryEngineeringPrinciples,
  resolveProjectConstraints,
} from "./guardrails.mjs";
import { formatTaskRoleLabel, formatTaskStageLabel } from "./workflow_model.mjs";

function normalizeDocEntry(doc) {
  return String(doc || "").trim().replaceAll("\\", "/");
}

function isAgentsDoc(doc) {
  const normalized = normalizeDocEntry(doc).toLowerCase();
  if (!normalized) {
    return false;
  }

  const segments = normalized.split("/");
  return segments[segments.length - 1] === "agents.md";
}

function normalizeDocList(items) {
  const result = [];
  const seen = new Set();

  for (const item of items || []) {
    const normalized = normalizeDocEntry(item);
    if (!normalized || isAgentsDoc(normalized)) {
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

function section(title, content) {
  if (!content || !String(content).trim()) return "";
  return `## ${title}\n${String(content).trim()}\n`;
}

function listSection(title, items) {
  if (!Array.isArray(items) || !items.length) return "";
  return section(title, formatList(items));
}

export function buildTaskPrompt({
  task,
  repoStateText,
  verifyCommands,
  requiredDocs = [],
  constraints = [],
  previousFailure = "",
  failureHistory = [],
  strategyIndex = 1,
  maxStrategies = 1,
  attemptIndex = 1,
  maxAttemptsPerStrategy = 1,
}) {
  const allDocs = normalizeDocList([
    ...requiredDocs,
    ...(task.docs || []),
  ]);
  const mandatoryGuardrails = listMandatoryGuardrails();
  const mandatoryEngineeringPrinciples = listMandatoryEngineeringPrinciples();
  const effectiveConstraints = resolveProjectConstraints(constraints);
  const usingFallbackConstraints = !hasCustomProjectConstraints(constraints);

  return [
    "你在本地仓库中执行一个连续开发任务。",
    "必须严格按仓库开发文档推进，不要偏离产品路线。",
    "当前执行模式是 Ralph Loop：失败后先修复重试，连续失败后必须换一种思路继续。",
    "",
    listSection("开发前必读", allDocs),
    section("当前循环阶段", [
      `- 当前策略轮次：${strategyIndex}/${maxStrategies}`,
      `- 当前策略内重试：${attemptIndex}/${maxAttemptsPerStrategy}`,
      strategyIndex > 1 ? "- 这是换路后的新一轮尝试，禁止简单重复上一轮做法。" : "",
    ].filter(Boolean).join("\n")),
    section("当前任务", [
      `- 标题：${task.title}`,
      `- 编号：${task.id}`,
      `- 优先级：${task.priority || "P2"}`,
      `- 风险等级：${task.risk || "low"}`,
      `- 阶段：${formatTaskStageLabel(task.stage || "implementation")}`,
      `- 角色：${formatTaskRoleLabel(task.role || "developer")}`,
      `- lane：${task.lane || "mainline"}`,
      task.parallelGroup ? `- 并行组：${task.parallelGroup}` : "",
      `- 目标：${task.goal || "按文档完成当前工作包。"}`,
    ].join("\n")),
    listSection("涉及路径", task.paths || []),
    listSection("关键产物", task.artifacts || []),
    listSection("显式阻塞", Array.isArray(task.blockedBy)
      ? task.blockedBy.map((item) => `${item.type}:${item.label} (${item.status})`)
      : []),
    listSection("验收条件", task.acceptance || []),
    listSection("内建安全底线", mandatoryGuardrails),
    listSection("强制编码与产出基线", mandatoryEngineeringPrinciples),
    listSection(usingFallbackConstraints ? "默认工程约束（文档未明确时生效）" : "项目/用户约束", effectiveConstraints),
    repoStateText ? section("仓库当前状态", repoStateText) : "",
    failureHistory.length
      ? section("已失败尝试摘要", failureHistory.slice(-4).map((item) => (
        `- 策略 ${item.strategyIndex} / 尝试 ${item.attemptIndex} / ${item.kind}：${item.summary}`
      )).join("\n"))
      : "",
    previousFailure ? section("上一轮失败信息", previousFailure) : "",
    listSection("完成前必须运行的验证", verifyCommands),
    section("交付要求", [
      "1. 直接在仓库中完成实现。",
      "2. 用户需求明确且当前任务可完成时，必须一次性做完本轮应交付的全部工作，不要做半成品后停下来问“是否继续”或“如果你要我可以继续”。",
      "3. 运行验证；若失败，先分析根因，再修复并重跑。",
      "4. 同一路径连续失败后，必须明确换一种实现或排查思路。",
      "5. 除非遇到外部权限、环境损坏、文档缺口等硬阻塞，或确实需要用户做关键决策，否则不要停止。",
      "6. 不要提问，不要等待确认，不要把“下一步建议”当成提前停下的理由，直接完成当前任务。",
      "7. 最终只用简洁中文总结必要的变更、验证结果和剩余风险；禁止使用“如果你要”“如果你需要进一步…”“希望这对你有帮助”等套话收尾。",
    ].join("\n")),
  ].filter(Boolean).join("\n");
}

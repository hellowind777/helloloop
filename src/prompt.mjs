import { formatList } from "./common.mjs";

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

  const effectiveConstraints = constraints.length
    ? constraints
    : [
        "所有文件修改必须用 apply_patch。",
        "不得通过压缩代码、删空行、缩短命名来压行数。",
        "Rust / TS / TSX / Vue / Python / Go 单文件强制拆分上限 400 行。",
        "新增可见文案必须同时补齐 zh-CN 与 en-US。",
        "完成后必须同步相关中文文档与联调文档。",
        "完成前必须主动运行验证，不要停在分析层。",
      ];

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
      `- 目标：${task.goal || "按文档完成当前工作包。"}`,
    ].join("\n")),
    listSection("涉及路径", task.paths || []),
    listSection("验收条件", task.acceptance || []),
    listSection("实现约束", effectiveConstraints),
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
      "2. 运行验证；若失败，先分析根因，再修复并重跑。",
      "3. 同一路径连续失败后，必须明确换一种实现或排查思路。",
      "4. 除非遇到外部权限、环境损坏、文档缺口等硬阻塞，否则不要停止。",
      "5. 用简洁中文总结变更、验证结果和剩余风险。",
      "6. 不要提问，不要等待确认，直接完成。",
    ].join("\n")),
  ].filter(Boolean).join("\n");
}

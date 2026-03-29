import { formatList } from "./common.mjs";
import {
  hasCustomProjectConstraints,
  listMandatoryGuardrails,
  resolveProjectConstraints,
} from "./guardrails.mjs";

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

function renderDocPackets(docPackets) {
  return docPackets.map((packet) => [
    `### 文档：${packet.path}`,
    packet.truncated ? "（已截断）" : "",
    "",
    packet.content,
  ].filter(Boolean).join("\n")).join("\n\n");
}

export function buildAnalysisPrompt({
  repoRoot,
  docsEntries,
  docPackets,
  existingStateText = "",
  existingBacklogText = "",
  existingProjectConstraints = [],
}) {
  const mandatoryGuardrails = listMandatoryGuardrails();
  const effectiveConstraints = resolveProjectConstraints(existingProjectConstraints);
  const usingFallbackConstraints = !hasCustomProjectConstraints(existingProjectConstraints);

  return [
    "你要为一个本地代码仓库做“接续开发分析”。",
    "目标不是直接改代码，而是判断当前已经做到哪里，并生成后续可执行 backlog。",
    "",
    "必须遵守以下原则：",
    "1. 代码是事实源，开发文档是目标源。",
    "2. 判断“已完成 / 部分完成 / 未完成”时，以仓库当前真实代码、测试、目录结构为准，不能盲信文档。",
    "3. 生成的任务必须颗粒度足够，能直接进入开发，不允许输出“继续开发”这类空泛任务。",
    "4. 只关注当前目标仓库，不要把其他仓库的任务混进来；如果文档覆盖多仓库，只提取当前仓库相关任务。",
    "5. 如果某项工作依赖其他仓库或外部输入，允许输出 `blocked` 任务，但必须明确阻塞原因。",
    "",
    section("目标仓库", `- 路径：${repoRoot.replaceAll("\\", "/")}`),
    section("开发文档入口", docsEntries.map((item) => `- ${item}`).join("\n")),
    existingStateText ? section("已有状态摘要", existingStateText) : "",
    listSection("内建安全底线", mandatoryGuardrails),
    listSection(usingFallbackConstraints ? "默认工程约束（文档未明确时也必须遵守）" : "已有项目约束", effectiveConstraints),
    existingBacklogText ? section("已有 backlog（供参考，可重组）", existingBacklogText) : "",
    section("文档内容摘录", renderDocPackets(docPackets)),
    section("输出要求", [
      "1. 严格输出 JSON，不要带 Markdown 代码块。",
      "2. `summary.currentState` 要清晰描述当前仓库真实进度。",
      "3. `summary.implemented` 写已确认完成的关键能力。",
      "4. `summary.remaining` 写尚未完成的关键缺口。",
      "5. `summary.nextAction` 写最合理的下一步。",
      "6. `tasks` 总数控制在 4 到 12 个之间，优先覆盖真正剩余工作。",
      "7. 每个任务必须包含：id、title、status、priority、risk、goal、docs、paths、acceptance。",
      "8. `status` 只能是 `done`、`pending`、`blocked`，不要输出 `in_progress` 或 `failed`。",
      "9. `docs` 必须引用本次文档入口中的相关路径；`paths` 必须写当前仓库内的实际目录或文件模式。",
      "10. `acceptance` 必须可验证，不要写空话。",
      "11. `constraints` 只写从项目文档或现有项目配置中提炼出的项目特有约束；不要重复内建安全底线。",
    ].join("\n")),
  ].filter(Boolean).join("\n");
}

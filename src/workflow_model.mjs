import path from "node:path";
import { readWorkflowDocPackets } from "./workflow_doc_recovery.mjs";

function normalizeText(value) {
  return String(value || "").trim();
}

function lowerText(value) {
  return normalizeText(value).toLowerCase();
}

function toSlug(value, fallback = "") {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || fallback;
}

const STAGE_DEFINITIONS = [
  { id: "product", label: "需求梳理", order: 10 },
  { id: "architecture", label: "架构设计", order: 20 },
  { id: "contract", label: "契约对齐", order: 30 },
  { id: "implementation", label: "开发实现", order: 40 },
  { id: "test", label: "测试验证", order: 50 },
  { id: "review", label: "评审收口", order: 60 },
  { id: "release", label: "交付发布", order: 70 },
  { id: "operate", label: "运行维护", order: 80 },
];

const ROLE_LABELS = Object.freeze({
  product_owner: "产品/Sprint",
  architect: "架构/方案",
  summary: "上下文摘要",
  control: "定位/控制",
  ux_designer: "体验/UI",
  developer: "开发实现",
  tester: "测试验证",
  reviewer: "评审复核",
  supervisor: "监督调度",
  release_manager: "交付发布",
});

const STAGE_ALIASES = Object.freeze({
  product: ["product", "requirements", "requirement", "planning", "roadmap", "task-breakdown", "tasks", "intake", "discovery"],
  architecture: ["architecture", "design", "runtime", "summary", "context"],
  contract: ["contract", "protocol", "schema", "api", "manifest"],
  implementation: ["implementation", "implement", "develop", "development", "coding", "build"],
  test: ["test", "qa", "verify", "verification", "validation", "acceptance"],
  review: ["review", "reconcile", "peer-review", "supervise"],
  release: ["release", "delivery", "package", "deploy", "deployment"],
  operate: ["operate", "operations", "ops", "maintenance", "monitor"],
});

const ROLE_ALIASES = Object.freeze({
  product_owner: ["product_owner", "product-owner", "po", "sprint", "planner"],
  architect: ["architect", "architecture", "design"],
  summary: ["summary", "summarizer", "context"],
  control: ["control", "localizer", "localization", "triage"],
  ux_designer: ["ux", "ui", "designer", "design-system"],
  developer: ["developer", "engineer", "implementer", "coder"],
  tester: ["tester", "qa", "verification", "validation"],
  reviewer: ["reviewer", "review", "peer"],
  supervisor: ["supervisor", "lead", "boss", "orchestrator"],
  release_manager: ["release", "release-manager", "delivery", "ops"],
});

const DOC_TYPE_LABELS = Object.freeze({
  requirements: "需求文档",
  roadmap: "路线图",
  task_breakdown: "任务拆解",
  architecture: "架构/运行时方案",
  protocol_reference: "协议/契约参考",
  ui_spec: "UI/视觉规范",
  adr: "决策记录",
  test_plan: "测试/验收文档",
  runbook: "交付/运行文档",
  reference: "参考文档",
  tutorial: "教程/快速开始",
  overview: "索引/总览",
  unknown: "未分类文档",
});

const DOC_RULES = [
  {
    docType: "task_breakdown",
    stage: "product",
    role: "product_owner",
    lane: "planning",
    pathPatterns: [/任务拆解/u, /\bbacklog\b/iu, /\btasks?\b/iu],
    contentPatterns: [/任务拆解/u, /待办/u, /work ?package/iu],
  },
  {
    docType: "roadmap",
    stage: "product",
    role: "product_owner",
    lane: "planning",
    pathPatterns: [/路线图/u, /\broadmap\b/iu, /\bmilestone\b/iu],
    contentPatterns: [/阶段/u, /里程碑/u, /milestone/iu],
  },
  {
    docType: "requirements",
    stage: "product",
    role: "product_owner",
    lane: "planning",
    pathPatterns: [/需求/u, /\bprd\b/iu, /方案/u, /总纲/u],
    contentPatterns: [/验收标准/u, /用户故事/u, /需求/u],
  },
  {
    docType: "protocol_reference",
    stage: "contract",
    role: "architect",
    lane: "contract",
    pathPatterns: [/protocol/u, /schema/u, /contract/u, /manifest/u, /openapi/u],
    contentPatterns: [/错误码/u, /状态码/u, /schema/iu, /websocket/iu],
  },
  {
    docType: "ui_spec",
    stage: "architecture",
    role: "ux_designer",
    lane: "ui",
    pathPatterns: [/视觉/u, /shell/u, /wechat/u, /token/u, /\bui\b/iu, /\bdesign\b/iu],
    contentPatterns: [/视觉/u, /交互/u, /设计令牌/u, /多语言/u],
  },
  {
    docType: "architecture",
    stage: "architecture",
    role: "architect",
    lane: "architecture",
    pathPatterns: [/架构/u, /\barchitecture\b/iu, /运行时/u, /部署/u],
    contentPatterns: [/系统上下文/u, /容器视图/u, /组件视图/u, /runtime/iu],
  },
  {
    docType: "adr",
    stage: "architecture",
    role: "architect",
    lane: "architecture",
    pathPatterns: [/[\\/]\badr\b[\\/]/iu, /决策/u, /\bdecision\b/iu],
    contentPatterns: [/最终决定/u, /备选项/u, /影响范围/u],
  },
  {
    docType: "test_plan",
    stage: "test",
    role: "tester",
    lane: "quality",
    pathPatterns: [/验收/u, /verify/u, /test/u, /baseline/u, /snapshot/u],
    contentPatterns: [/验收/u, /测试/u, /快照/u, /baseline/iu],
  },
  {
    docType: "runbook",
    stage: "release",
    role: "release_manager",
    lane: "release",
    pathPatterns: [/install/u, /deploy/u, /release/u, /启动/u, /打包/u, /交付/u],
    contentPatterns: [/安装/u, /发布/u, /绿色版/u, /启动/u],
  },
  {
    docType: "tutorial",
    stage: "product",
    role: "summary",
    lane: "enablement",
    pathPatterns: [/[\\/]tutorials?[\\/]/iu, /快速开始/u, /入门/u],
    contentPatterns: [/快速开始/u, /步骤/u, /教程/u],
  },
  {
    docType: "reference",
    stage: "contract",
    role: "control",
    lane: "reference",
    pathPatterns: [/[\\/]reference[\\/]/iu, /参考/u, /命令/u],
    contentPatterns: [/参考/u, /参数/u, /配置/u],
  },
  {
    docType: "overview",
    stage: "product",
    role: "summary",
    lane: "planning",
    pathPatterns: [/索引/u, /README/iu, /overview/iu],
    contentPatterns: [/阅读顺序/u, /索引/u, /当前启用文档/u],
  },
];

const REPO_PROFILES = Object.freeze({
  "hellomind-platform": {
    id: "platform_runtime",
    label: "平台运行时/控制面仓",
    lanes: ["gateway", "control-ui", "runtime", "quality"],
    phases: ["product", "architecture", "contract", "implementation", "test", "review", "release"],
  },
  "hellomind-chat": {
    id: "desktop_client",
    label: "桌面聊天客户端仓",
    lanes: ["shell", "adapters", "workbench", "quality"],
    phases: ["product", "architecture", "contract", "implementation", "test", "review", "release"],
  },
  "hellomind-protocols": {
    id: "protocol_contracts",
    label: "协议/生成物仓",
    lanes: ["schema", "generators", "fixtures", "quality"],
    phases: ["product", "architecture", "contract", "implementation", "test", "review", "release"],
  },
  "hellomind-ui": {
    id: "design_standards",
    label: "设计标准仓",
    lanes: ["tokens", "shell-spec", "visual-baseline", "quality"],
    phases: ["product", "architecture", "implementation", "test", "review", "release"],
  },
  helloloop: {
    id: "orchestration_plugin",
    label: "多宿主开发工作流插件",
    lanes: ["planning", "runtime", "dashboard", "quality"],
    phases: ["product", "architecture", "implementation", "test", "review", "release", "operate"],
  },
  default: {
    id: "generic_repo",
    label: "通用代码仓",
    lanes: ["mainline", "quality"],
    phases: ["product", "architecture", "implementation", "test", "review", "release"],
  },
});

function matchAlias(value, aliasMap, fallback) {
  const normalized = lowerText(value).replace(/[_\s]+/gu, "-");
  for (const [canonical, aliases] of Object.entries(aliasMap)) {
    if (canonical === normalized || aliases.includes(normalized)) {
      return canonical;
    }
  }
  return fallback;
}

function findStageDefinition(stage) {
  const normalized = normalizeTaskStage(stage);
  return STAGE_DEFINITIONS.find((item) => item.id === normalized) || STAGE_DEFINITIONS.find((item) => item.id === "implementation");
}

function inferTitle(relativePath, content) {
  const heading = String(content || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => /^(#|##|\*|>)/u.test(line) || line.length > 4);
  if (heading) {
    return heading.replace(/^(#|##|\*|>)+\s*/u, "").trim();
  }
  const baseName = path.basename(relativePath, path.extname(relativePath));
  return baseName || relativePath;
}

function buildRuleScore(rule, relativePath, content) {
  let score = 0;
  const reasons = [];
  for (const pattern of rule.pathPatterns) {
    if (pattern.test(relativePath)) {
      score += 3;
      reasons.push(`路径命中 ${pattern}`);
      break;
    }
  }
  for (const pattern of rule.contentPatterns) {
    if (pattern.test(content)) {
      score += 2;
      reasons.push(`内容命中 ${pattern}`);
      break;
    }
  }
  return { score, reasons };
}

function resolveConfidence(score) {
  if (score >= 5) return "high";
  if (score >= 3) return "medium";
  return "low";
}

export function normalizeTaskStage(value, fallback = "implementation") {
  return matchAlias(value, STAGE_ALIASES, fallback);
}

export function rankTaskStage(value) {
  return findStageDefinition(value).order;
}

export function formatTaskStageLabel(value) {
  return findStageDefinition(value).label;
}

export function normalizeTaskRole(value, fallback = "developer") {
  return matchAlias(value, ROLE_ALIASES, fallback);
}

export function formatTaskRoleLabel(value) {
  return ROLE_LABELS[normalizeTaskRole(value)] || ROLE_LABELS.developer;
}

export function normalizeTaskLane(value, fallback = "mainline") {
  return toSlug(value, fallback);
}

export function normalizeTaskParallelGroup(value) {
  const normalized = toSlug(value, "");
  return normalized || null;
}

export function resolveTaskTrackKey(task) {
  const lane = normalizeTaskLane(task?.lane, "mainline");
  const parallelGroup = normalizeTaskParallelGroup(task?.parallelGroup);
  return parallelGroup ? `${lane}::${parallelGroup}` : lane;
}

export function inferRepoWorkflowProfile(repoRoot) {
  const repoName = path.basename(String(repoRoot || "")).toLowerCase();
  return REPO_PROFILES[repoName] || REPO_PROFILES.default;
}

export function inferDocumentAnalysis(repoRoot, docPackets = []) {
  const entries = docPackets.map((packet) => {
    const relativePath = normalizeText(packet?.path);
    const content = String(packet?.content || "");
    let winner = null;
    for (const rule of DOC_RULES) {
      const match = buildRuleScore(rule, relativePath, content);
      if (!winner || match.score > winner.score) {
        winner = { ...rule, ...match };
      }
    }
    const docType = winner?.score > 0 ? winner.docType : "unknown";
    const stage = winner?.score > 0 ? winner.stage : "architecture";
    const role = winner?.score > 0 ? winner.role : "summary";
    const lane = winner?.score > 0 ? winner.lane : "reference";
    const confidence = resolveConfidence(winner?.score || 0);
    const rationale = winner?.score > 0
      ? winner.reasons.join("；")
      : "未命中明确规则，按通用参考文档处理。";
    return {
      path: relativePath,
      title: inferTitle(relativePath, content),
      docType,
      docTypeLabel: DOC_TYPE_LABELS[docType] || DOC_TYPE_LABELS.unknown,
      stage,
      stageLabel: formatTaskStageLabel(stage),
      role,
      roleLabel: formatTaskRoleLabel(role),
      lane: normalizeTaskLane(lane, "reference"),
      confidence,
      rationale,
    };
  });

  const counts = entries.reduce((accumulator, entry) => {
    accumulator[entry.docType] = (accumulator[entry.docType] || 0) + 1;
    return accumulator;
  }, {});
  const summaryParts = Object.entries(counts)
    .sort((left, right) => right[1] - left[1])
    .map(([docType, count]) => `${DOC_TYPE_LABELS[docType] || docType} ${count}`);
  const gaps = [];
  if (!counts.requirements && !counts.roadmap && !counts.task_breakdown) {
    gaps.push("缺少明确的需求、路线图或任务拆解文档。");
  }
  if (!counts.architecture) {
    gaps.push("缺少明确的架构/运行时方案文档。");
  }
  if (!counts.test_plan) {
    gaps.push("缺少显式的测试/验收文档。");
  }
  return {
    entries,
    summary: summaryParts.length
      ? `已识别 ${entries.length} 份文档：${summaryParts.join(" · ")}`
      : "当前没有可用的文档画像。",
    gaps,
    repoProfile: inferRepoWorkflowProfile(repoRoot),
  };
}

function uniqueStrings(items) {
  const result = [];
  const seen = new Set();
  for (const item of items || []) {
    const normalized = normalizeText(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

const RECOVERED_DOC_ANALYSIS_CACHE = new Map();

function shouldRecoverDocAnalysis(docAnalysis) {
  if (!docAnalysis || typeof docAnalysis !== "object") {
    return true;
  }

  const summary = normalizeText(docAnalysis.summary);
  const entries = Array.isArray(docAnalysis.entries) ? docAnalysis.entries : [];
  return !entries.length || /^尚未重新分析文档画像/u.test(summary) || summary === "当前没有可用的文档画像。";
}

function fallbackDocAnalysis(repoRoot, tasks = [], requiredDocs = []) {
  return {
    entries: [],
    summary: Array.isArray(requiredDocs) && requiredDocs.length
      ? `尚未重新分析文档画像；当前项目记录了 ${requiredDocs.length} 份开发文档。`
      : `尚未重新分析文档画像；当前 backlog 共 ${Array.isArray(tasks) ? tasks.length : 0} 个任务。`,
    gaps: ["运行 `helloloop analyze -y` 可生成新版文档画像与主线蓝图。"],
    repoProfile: inferRepoWorkflowProfile(repoRoot),
  };
}

function recoverDocAnalysis(repoRoot, requiredDocs = []) {
  const { entries, packets } = readWorkflowDocPackets(repoRoot, requiredDocs, {
    maxCharsPerFile: 12000,
    maxTotalChars: 48000,
  });
  if (!entries.length || !packets.length) {
    return null;
  }

  const cacheKey = `${repoRoot}::${entries.join("|")}`;
  if (RECOVERED_DOC_ANALYSIS_CACHE.has(cacheKey)) {
    return RECOVERED_DOC_ANALYSIS_CACHE.get(cacheKey);
  }

  const analysis = inferDocumentAnalysis(repoRoot, packets);
  RECOVERED_DOC_ANALYSIS_CACHE.set(cacheKey, analysis);
  return analysis;
}

export function buildWorkflowBlueprint({ repoRoot, docAnalysis, planner = {} } = {}) {
  const profile = docAnalysis?.repoProfile || inferRepoWorkflowProfile(repoRoot);
  const docEntries = Array.isArray(docAnalysis?.entries) ? docAnalysis.entries : [];
  const docStages = new Set(docEntries.map((item) => normalizeTaskStage(item.stage)));
  const docLanes = uniqueStrings(docEntries.map((item) => normalizeTaskLane(item.lane, "")));
  const maxParallelLanes = Math.max(1, Number(planner.maxParallelLanes || 4));

  const phaseOrder = uniqueStrings([
    ...profile.phases,
    ...[...docStages],
  ].map((item) => normalizeTaskStage(item, "implementation")));
  const orderedPhases = STAGE_DEFINITIONS
    .filter((item) => phaseOrder.includes(item.id))
    .sort((left, right) => left.order - right.order)
    .map((item) => item.id);
  const parallelLanes = uniqueStrings([
    ...profile.lanes,
    ...docLanes,
  ]).slice(0, maxParallelLanes);
  const parallelStrategy = parallelLanes.length > 1
    ? "lane_parallel_with_stage_gates"
    : "ordered_mainline";
  const coordinationRules = [
    "先完成需求/架构/契约层任务，再进入对应 lane 的实现任务。",
    "实现与测试可按 lane 并行推进，但评审与发布必须统一收口。",
    "所有任务都必须带明确验收条件、涉及路径和依赖对象。",
  ];
  const currentFocus = orderedPhases.length
    ? `优先按 ${orderedPhases.map((item) => formatTaskStageLabel(item)).join(" → ")} 主线推进`
    : "优先完成需求、架构、实现、验证的闭环。";

  return {
    methodology: "hierarchical_role_based_agile_multi_agent_sdlc",
    profile: profile.id,
    profileLabel: profile.label,
    orchestrationMode: "central_supervisor",
    parallelStrategy,
    docCoverageSummary: normalizeText(docAnalysis?.summary) || "当前没有文档画像。",
    currentFocus,
    mainlineSummary: `先做需求/架构对齐，再按 ${parallelLanes.join(" / ")} 分 lane 推进实现与验证，最后统一进入评审与交付。`,
    phaseOrder: orderedPhases.length ? orderedPhases : profile.phases,
    parallelLanes: parallelLanes.length ? parallelLanes : ["mainline"],
    coordinationRules,
  };
}

export function backfillWorkflowArtifacts({
  repoRoot,
  workflow,
  docAnalysis,
  tasks = [],
  requiredDocs = [],
} = {}) {
  const effectiveDocAnalysis = shouldRecoverDocAnalysis(docAnalysis)
    ? (recoverDocAnalysis(repoRoot, requiredDocs) || fallbackDocAnalysis(repoRoot, tasks, requiredDocs))
    : docAnalysis;
  if (workflow && typeof workflow === "object") {
    return {
      workflow,
      docAnalysis: effectiveDocAnalysis,
    };
  }

  const stageOrder = uniqueStrings((Array.isArray(tasks) ? tasks : []).map((item) => normalizeTaskStage(item?.stage, "implementation")));
  const taskLanes = uniqueStrings((Array.isArray(tasks) ? tasks : []).map((item) => normalizeTaskLane(item?.lane, "")));
  const derivedWorkflow = buildWorkflowBlueprint({
    repoRoot,
    docAnalysis: effectiveDocAnalysis,
    planner: {
      maxParallelLanes: Math.max(1, taskLanes.length || 4),
    },
  });

  return {
    workflow: {
      ...derivedWorkflow,
      currentFocus: stageOrder.length
        ? `当前 backlog 主要覆盖 ${stageOrder.map((item) => formatTaskStageLabel(item)).join(" -> ")}。`
        : derivedWorkflow.currentFocus,
      mainlineSummary: workflow?.mainlineSummary
        || `${derivedWorkflow.mainlineSummary}（当前展示由历史 backlog 回填，重新 analyze 后会更完整。）`,
      phaseOrder: stageOrder.length ? stageOrder : derivedWorkflow.phaseOrder,
      parallelLanes: taskLanes.length ? taskLanes : derivedWorkflow.parallelLanes,
    },
    docAnalysis: effectiveDocAnalysis,
  };
}

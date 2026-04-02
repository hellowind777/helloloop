import path from "node:path";

import {
  fileExists,
  nowIso,
  readJson,
  readTextIfExists,
  writeJson,
  writeText,
} from "./common.mjs";

const defaultPolicy = {
  version: 1,
  updatedAt: nowIso(),
  maxLoopTasks: 4,
  maxTaskAttempts: 2,
  maxTaskStrategies: 4,
  maxReanalysisPasses: 3,
  stopOnFailure: false,
  stopOnHighRisk: true,
  runtimeRecovery: {
    enabled: true,
    heartbeatIntervalSeconds: 60,
    stallWarningSeconds: 900,
    maxIdleSeconds: 2700,
    killGraceSeconds: 10,
    healthProbeTimeoutSeconds: 120,
    hardRetryDelaysSeconds: [900, 900, 900, 900, 900],
    softRetryDelaysSeconds: [900, 900, 900, 900, 900, 1800, 1800, 3600, 5400, 7200, 9000, 10800],
  },
  codex: {
    model: "",
    executable: "",
    sandbox: "workspace-write",
    dangerouslyBypassSandbox: false,
    jsonOutput: true,
  },
  claude: {
    model: "",
    executable: "",
    permissionMode: "bypassPermissions",
    analysisPermissionMode: "plan",
    outputFormat: "text",
  },
  gemini: {
    model: "",
    executable: "",
    approvalMode: "yolo",
    analysisApprovalMode: "plan",
    outputFormat: "text",
  },
};

const defaultPlanner = {
  minTasks: 3,
  maxTasks: 8,
  methodology: "hierarchical_role_based_agile_multi_agent_sdlc",
  roleInference: true,
  maxParallelLanes: 4,
  stageGateMode: "lane_gated",
  workflowHints: [
    "先识别每份文档在 SDLC 中承担的角色，再组织主线。",
    "优先使用分层角色导向的产品/架构/契约/实现/验证/评审主线。",
    "允许实现与测试按 lane 并行，但必须保留明确的会合点和验收门禁。",
    "避免把整个文档目录压成一个大任务。",
  ],
};

export function loadPolicy(context) {
  const policy = {
    ...defaultPolicy,
    ...(fileExists(context.policyFile) ? readJson(context.policyFile) : {}),
  };
  policy.codex = {
    ...defaultPolicy.codex,
    ...(policy.codex || {}),
  };
  policy.claude = {
    ...defaultPolicy.claude,
    ...(policy.claude || {}),
  };
  policy.gemini = {
    ...defaultPolicy.gemini,
    ...(policy.gemini || {}),
  };
  policy.runtimeRecovery = {
    ...defaultPolicy.runtimeRecovery,
    ...(policy.runtimeRecovery || {}),
    hardRetryDelaysSeconds: Array.isArray(policy?.runtimeRecovery?.hardRetryDelaysSeconds)
      ? policy.runtimeRecovery.hardRetryDelaysSeconds
      : defaultPolicy.runtimeRecovery.hardRetryDelaysSeconds,
    softRetryDelaysSeconds: Array.isArray(policy?.runtimeRecovery?.softRetryDelaysSeconds)
      ? policy.runtimeRecovery.softRetryDelaysSeconds
      : defaultPolicy.runtimeRecovery.softRetryDelaysSeconds,
  };
  return policy;
}

export function loadProjectConfig(context) {
  if (!fileExists(context.projectFile)) {
    return {
      requiredDocs: [],
      constraints: [],
      defaultEngine: "",
      lastSelectedEngine: "",
      workflow: null,
      docAnalysis: null,
      planner: defaultPlanner,
    };
  }

  const config = readJson(context.projectFile);
  return {
    requiredDocs: Array.isArray(config.requiredDocs) ? config.requiredDocs : [],
    constraints: Array.isArray(config.constraints) ? config.constraints : [],
    defaultEngine: typeof config.defaultEngine === "string" ? config.defaultEngine : "",
    lastSelectedEngine: typeof config.lastSelectedEngine === "string" ? config.lastSelectedEngine : "",
    workflow: config.workflow && typeof config.workflow === "object" ? config.workflow : null,
    docAnalysis: config.docAnalysis && typeof config.docAnalysis === "object" ? config.docAnalysis : null,
    planner: {
      ...defaultPlanner,
      ...(config.planner || {}),
      workflowHints: Array.isArray(config?.planner?.workflowHints)
        ? config.planner.workflowHints
        : defaultPlanner.workflowHints,
    },
  };
}

export function loadBacklog(context) {
  const backlog = readJson(context.backlogFile);
  if (!backlog || !Array.isArray(backlog.tasks)) {
    throw new Error("HelloLoop backlog 无效：缺少 tasks 数组。");
  }
  return backlog;
}

export function saveBacklog(context, backlog) {
  writeJson(context.backlogFile, {
    ...backlog,
    updatedAt: nowIso(),
  });
}

export function saveProjectConfig(context, config) {
  writeJson(context.projectFile, config);
}

export function loadVerifyCommands(context) {
  const raw = readTextIfExists(context.repoVerifyFile, "");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => /^\s*-\s+/.test(line))
    .map((line) => line.replace(/^\s*-\s+/, "").trim())
    .filter(Boolean);
}

export function loadRepoStateText(context) {
  return readTextIfExists(context.stateFile, "").trim();
}

export function writeStatus(context, status) {
  writeJson(context.statusFile, {
    ...status,
    updatedAt: nowIso(),
  });
}

export function writeStateMarkdown(context, content) {
  writeText(context.stateFile, `${content.trim()}\n`);
}

export function scaffoldIfMissing(context) {
  const files = [
    ["backlog.template.json", context.backlogFile],
    ["policy.template.json", context.policyFile],
    ["project.template.json", context.projectFile],
    ["status.template.json", context.statusFile],
    ["STATE.template.md", context.stateFile],
  ];

  const created = [];
  for (const [templateName, targetFile] of files) {
    if (fileExists(targetFile)) continue;
    const source = path.join(context.templatesDir, templateName);
    const content = readTextIfExists(source, "");
    writeText(targetFile, content);
    created.push(targetFile);
  }

  const runsKeep = path.join(context.runsDir, ".gitkeep");
  if (!fileExists(runsKeep)) {
    writeText(runsKeep, "\n");
    created.push(runsKeep);
  }

  return created;
}

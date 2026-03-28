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
  stopOnFailure: false,
  stopOnHighRisk: true,
  codex: {
    model: "",
    executable: "",
    sandbox: "workspace-write",
    dangerouslyBypassSandbox: false,
    jsonOutput: true,
  },
};

const defaultPlanner = {
  minTasks: 3,
  maxTasks: 8,
  roleInference: true,
  workflowHints: [
    "先识别每份文档的角色和可信度，再组织主线。",
    "优先输出可逐步开发、测试、验收的任务。",
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
  return policy;
}

export function loadProjectConfig(context) {
  if (!fileExists(context.projectFile)) {
    return {
      requiredDocs: [],
      constraints: [],
      planner: defaultPlanner,
    };
  }

  const config = readJson(context.projectFile);
  return {
    requiredDocs: Array.isArray(config.requiredDocs) ? config.requiredDocs : [],
    constraints: Array.isArray(config.constraints) ? config.constraints : [],
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
    throw new Error("Autoloop backlog 无效：缺少 tasks 数组。");
  }
  return backlog;
}

export function saveBacklog(context, backlog) {
  writeJson(context.backlogFile, {
    ...backlog,
    updatedAt: nowIso(),
  });
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
  return readTextIfExists(context.repoStateFile, "").trim();
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


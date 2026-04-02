import path from "node:path";

import { summarizeBacklog, selectAutomationNextTask, selectNextTask } from "../src/backlog.mjs";
import { nowIso } from "../src/common.mjs";
import { loadBacklog, loadProjectConfig } from "../src/config.mjs";
import { createContext } from "../src/context.mjs";
import { collectRepoStatusSnapshot } from "../src/runner_status.mjs";
import { backfillWorkflowArtifacts } from "../src/workflow_model.mjs";

function parseArgs(argv) {
  const options = {
    repoRoot: process.cwd(),
    configDirName: ".helloloop",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--repo-root") {
      options.repoRoot = argv[index + 1] || options.repoRoot;
      index += 1;
      continue;
    }
    if (argument === "--config-dir-name") {
      options.configDirName = argv[index + 1] || options.configDirName;
      index += 1;
    }
  }

  return options;
}

function buildFallbackSnapshot(context) {
  const projectConfig = loadProjectConfig(context);
  const workflowArtifacts = backfillWorkflowArtifacts({
    repoRoot: context.repoRoot,
    workflow: projectConfig.workflow || null,
    docAnalysis: projectConfig.docAnalysis || null,
    tasks: [],
    requiredDocs: projectConfig.requiredDocs,
  });

  return {
    repoRoot: context.repoRoot,
    repoName: path.basename(context.repoRoot),
    configDirName: context.configDirName,
    engine: projectConfig.lastSelectedEngine || projectConfig.defaultEngine || "",
    summary: {
      total: 0,
      pending: 0,
      inProgress: 0,
      done: 0,
      failed: 0,
      blocked: 0,
    },
    nextTask: null,
    automationNextTask: null,
    tasks: [],
    workflow: workflowArtifacts.workflow,
    docAnalysis: workflowArtifacts.docAnalysis,
    supervisor: null,
    latestStatus: null,
    runtime: null,
    activity: null,
    statusModel: null,
    updatedAt: nowIso(),
  };
}

function buildWorkspaceSnapshot(options) {
  const context = createContext({
    repoRoot: options.repoRoot,
    configDirName: options.configDirName,
  });
  const projectConfig = loadProjectConfig(context);

  try {
    const snapshot = collectRepoStatusSnapshot(context, {});
    return {
      repoRoot: context.repoRoot,
      repoName: path.basename(context.repoRoot),
      configDirName: context.configDirName,
      engine: projectConfig.lastSelectedEngine || projectConfig.defaultEngine || "",
      summary: snapshot.summary,
      nextTask: snapshot.nextTask,
      automationNextTask: snapshot.automationNextTask,
      tasks: snapshot.tasks,
      workflow: snapshot.workflow,
      docAnalysis: snapshot.docAnalysis,
      supervisor: snapshot.supervisor,
      latestStatus: snapshot.latestStatus,
      runtime: snapshot.runtime,
      activity: snapshot.activity,
      statusModel: snapshot.statusModel,
      updatedAt: snapshot.activity?.updatedAt
        || snapshot.runtime?.updatedAt
        || snapshot.latestStatus?.updatedAt
        || snapshot.supervisor?.updatedAt
        || nowIso(),
    };
  } catch {
    try {
      const backlog = loadBacklog(context);
      const workflowArtifacts = backfillWorkflowArtifacts({
        repoRoot: context.repoRoot,
        workflow: backlog.workflow || projectConfig.workflow || null,
        docAnalysis: backlog.docAnalysis || projectConfig.docAnalysis || null,
        tasks: Array.isArray(backlog.tasks) ? backlog.tasks : [],
        requiredDocs: projectConfig.requiredDocs,
      });

      return {
        repoRoot: context.repoRoot,
        repoName: path.basename(context.repoRoot),
        configDirName: context.configDirName,
        engine: projectConfig.lastSelectedEngine || projectConfig.defaultEngine || "",
        summary: summarizeBacklog(backlog),
        nextTask: selectNextTask(backlog),
        automationNextTask: selectAutomationNextTask(backlog),
        tasks: Array.isArray(backlog.tasks) ? backlog.tasks : [],
        workflow: workflowArtifacts.workflow,
        docAnalysis: workflowArtifacts.docAnalysis,
        supervisor: null,
        latestStatus: null,
        runtime: null,
        activity: null,
        statusModel: null,
        updatedAt: String(backlog.updatedAt || nowIso()),
      };
    } catch {
      return buildFallbackSnapshot(context);
    }
  }
}

const options = parseArgs(process.argv.slice(2));
const snapshot = buildWorkspaceSnapshot(options);
process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);

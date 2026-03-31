import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { saveBacklog, saveProjectConfig, scaffoldIfMissing } from "../src/config.mjs";
import { createContext } from "../src/context.mjs";
import { waitFor, cleanupTempDir, readJson } from "./helpers/supervisor_test_support.mjs";
import { buildCliEnv, spawnHelloLoop, writeText, writeJson } from "./helpers/analyze_cli_fixture.mjs";

function createUnavailableCli(binDir, commandName) {
  if (process.platform === "win32") {
    writeText(path.join(binDir, `${commandName}.ps1`), `Write-Error '${commandName} unavailable in test' ; exit 1\r\n`);
    return;
  }

  const filePath = path.join(binDir, commandName);
  writeText(filePath, `#!/usr/bin/env sh\necho ${commandName} unavailable in test >&2\nexit 1\n`);
  fs.chmodSync(filePath, 0o755);
}

function createWatchingCodex(binDir, { stepDelayMs = 400 } = {}) {
  const stubFile = path.join(binDir, "codex-watch-stub.cjs");
  writeText(stubFile, `
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const stepDelayMs = ${JSON.stringify(stepDelayMs)};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildReviewPayload() {
  return {
    verdict: "complete",
    summary: "实现主业务流程已真正完成。",
    acceptanceChecks: [
      { item: "主业务流程可运行", status: "met", evidence: "执行输出已产生。" },
      { item: "关键路径通过验证", status: "met", evidence: "verify 命令通过。" },
    ],
    missing: [],
    blockerReason: "",
    nextAction: "继续主线下一任务。",
  };
}

async function main() {
  if (args.includes("--version")) {
    process.stdout.write("codex 0.118.0\\n");
    return;
  }

  const schemaIndex = args.indexOf("--output-schema");
  const schemaName = schemaIndex >= 0 && args[schemaIndex + 1]
    ? path.basename(args[schemaIndex + 1])
    : "";
  const outputIndex = args.indexOf("-o");
  const outputFile = outputIndex >= 0 ? args[outputIndex + 1] : "";

  if (outputFile) {
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  }

  if (schemaName === "task-review-output.schema.json") {
    fs.writeFileSync(outputFile, JSON.stringify(buildReviewPayload()), "utf8");
    process.stdout.write("review ok\\n");
    return;
  }

  if (!schemaName) {
    process.stdout.write("step 1: 正在分析开发文档\\n");
    await sleep(stepDelayMs);
    process.stdout.write("step 2: 正在落地实现\\n");
    await sleep(stepDelayMs);
    process.stdout.write("step 3: 正在准备交付\\n");
    await sleep(stepDelayMs);
    fs.writeFileSync(outputFile, "任务执行完成", "utf8");
    return;
  }

  throw new Error("unexpected schema: " + schemaName);
}

main().catch((error) => {
  process.stderr.write(String(error?.stack || error || ""));
  process.exit(1);
});
`);

  if (process.platform === "win32") {
    const script = path.join(binDir, "codex.ps1");
    writeText(script, "node \"$PSScriptRoot/codex-watch-stub.cjs\" @args\r\nexit $LASTEXITCODE\r\n");
    return script;
  }

  const shellFile = path.join(binDir, "codex");
  writeText(shellFile, "#!/usr/bin/env sh\nnode \"$(dirname \"$0\")/codex-watch-stub.cjs\" \"$@\"\n");
  fs.chmodSync(shellFile, 0o755);
  return shellFile;
}

function sampleTask() {
  return {
    id: "finish-main-flow",
    title: "实现主业务流程",
    status: "pending",
    priority: "P1",
    risk: "low",
    goal: "根据开发文档补齐主业务流程。",
    docs: ["docs/plan.md"],
    paths: ["src/"],
    acceptance: ["主业务流程可运行", "关键路径通过验证"],
    dependsOn: [],
    verify: ["node --version"],
  };
}

function createPolicy(codexExecutable, binDir) {
  return {
    version: 1,
    updatedAt: "2026-03-31T00:00:00.000Z",
    maxLoopTasks: 4,
    maxTaskAttempts: 2,
    maxTaskStrategies: 2,
    maxReanalysisPasses: 1,
    stopOnFailure: false,
    stopOnHighRisk: true,
    runtimeRecovery: {
      enabled: true,
      heartbeatIntervalSeconds: 1,
      stallWarningSeconds: 30,
      maxIdleSeconds: 60,
      killGraceSeconds: 1,
      healthProbeTimeoutSeconds: 5,
      hardRetryDelaysSeconds: [1],
      softRetryDelaysSeconds: [1],
    },
    codex: {
      model: "",
      executable: codexExecutable,
      sandbox: "workspace-write",
      dangerouslyBypassSandbox: false,
      jsonOutput: true,
    },
    claude: {
      model: "",
      executable: path.join(binDir, process.platform === "win32" ? "claude.ps1" : "claude"),
      permissionMode: "bypassPermissions",
      analysisPermissionMode: "plan",
      outputFormat: "text",
    },
    gemini: {
      model: "",
      executable: path.join(binDir, process.platform === "win32" ? "gemini.ps1" : "gemini"),
      approvalMode: "yolo",
      analysisApprovalMode: "plan",
      outputFormat: "text",
    },
  };
}

function setupTaskRepo(repoDir, context, task) {
  writeText(path.join(repoDir, "docs", "plan.md"), "# 开发计划\n- 实现主业务流程\n");
  writeText(path.join(repoDir, "src", "index.js"), "console.log('hello');\n");
  writeText(path.join(repoDir, ".helloagents", "verify.yaml"), "commands:\n  - node --version\n");
  scaffoldIfMissing(context);
  saveProjectConfig(context, {
    requiredDocs: ["docs/plan.md"],
    constraints: [],
    defaultEngine: "",
    lastSelectedEngine: "",
    planner: {
      minTasks: 3,
      maxTasks: 8,
      roleInference: true,
      workflowHints: [],
    },
  });
  saveBacklog(context, {
    project: "demo-project",
    tasks: [task],
  });
}

test("run-once --watch 会附着后台 supervisor 并显示实时输出", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-watch-run-once-"));
  const binDir = path.join(tempRoot, "bin");
  const repoDir = path.join(tempRoot, "repo");
  const context = createContext({ repoRoot: repoDir });
  const task = sampleTask();
  const codexExecutable = createWatchingCodex(binDir);
  createUnavailableCli(binDir, "claude");
  createUnavailableCli(binDir, "gemini");
  setupTaskRepo(repoDir, context, task);
  writeJson(context.policyFile, createPolicy(codexExecutable, binDir));
  const env = buildCliEnv(binDir);

  try {
    const result = spawnHelloLoop(["run-once", "--engine", "codex", "--watch"], {
      cwd: repoDir,
      env,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /HelloLoop supervisor 已启动/);
    assert.match(result.stdout, /已进入附着观察模式/);
    assert.match(result.stdout, /当前任务：实现主业务流程/);
    assert.match(result.stdout, /step 1: 正在分析开发文档/);
    assert.match(result.stdout, /step 2: 正在落地实现/);
    assert.match(result.stdout, /step 3: 正在准备交付/);

    const backlog = readJson(context.backlogFile);
    assert.equal(backlog.tasks[0]?.status, "done");
  } finally {
    await cleanupTempDir(tempRoot, context.supervisorStateFile);
  }
});

test("watch 命令可重新附着已后台化的 supervisor 会话", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-watch-attach-"));
  const binDir = path.join(tempRoot, "bin");
  const repoDir = path.join(tempRoot, "repo");
  const context = createContext({ repoRoot: repoDir });
  const task = sampleTask();
  const codexExecutable = createWatchingCodex(binDir, { stepDelayMs: 500 });
  createUnavailableCli(binDir, "claude");
  createUnavailableCli(binDir, "gemini");
  setupTaskRepo(repoDir, context, task);
  writeJson(context.policyFile, createPolicy(codexExecutable, binDir));
  const env = buildCliEnv(binDir);

  try {
    const detached = spawnHelloLoop(["run-once", "--engine", "codex", "--detach"], {
      cwd: repoDir,
      env,
    });

    assert.equal(detached.status, 0, detached.stderr);
    assert.match(detached.stdout, /已切换为后台执行/);

    await waitFor(() => {
      const state = readJson(context.supervisorStateFile);
      return ["running", "completed"].includes(String(state.status || "")) ? state : false;
    }, 10000);

    const watchResult = spawnHelloLoop(["watch"], {
      cwd: repoDir,
      env,
    });

    assert.equal(watchResult.status, 0, watchResult.stderr);
    assert.match(watchResult.stdout, /已附着后台会话/);
    assert.match(watchResult.stdout, /step 1: 正在分析开发文档/);
    assert.match(watchResult.stdout, /step 3: 正在准备交付/);
  } finally {
    await cleanupTempDir(tempRoot, context.supervisorStateFile);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildCliEnv,
  cliExecutable,
  createSmtpCaptureServer,
  createDemoRepo,
  createSequencedAgentCli,
  createUnavailableCli,
  readJson,
  sampleAnalysisPayload,
  sampleReviewPayload,
  sampleTask,
  spawnHelloLoop,
  spawnHelloLoopAsync,
  writeJson,
} from "./helpers/multi_host_runtime_fixture.mjs";

test("claude 引擎可完成分析、执行、任务复核和主线终态复核的完整自动链路", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-runtime-claude-"));
  const binDir = path.join(tempRoot, "bin");
  const tempRepo = createDemoRepo(tempRoot);
  const task = sampleTask("finish-main-flow", "实现主业务流程");
  const stateFile = createSequencedAgentCli(binDir, "claude", {
    versionText: "claude 2.1.87\n",
    analyzeSequence: [
      { payload: sampleAnalysisPayload([task]) },
      { payload: sampleReviewPayload(task.title) },
      { payload: sampleAnalysisPayload([]) },
    ],
    executeSequence: [
      { finalMessage: "Claude 已完成主业务流程。" },
    ],
  });
  createUnavailableCli(binDir, "codex");
  createUnavailableCli(binDir, "gemini");

  const result = spawnHelloLoop(["claude", "-y"], {
    cwd: tempRepo,
    env: buildCliEnv(binDir),
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /本次引擎：Claude/);
    assert.match(result.stdout, /开始自动接续执行/);
    assert.match(result.stdout, /主线终态复核通过/);

    const state = readJson(stateFile);
    const backlog = readJson(path.join(tempRepo, ".helloloop", "backlog.json"));
    assert.equal(state.analyze, 3);
    assert.equal(state.execute, 1);
    assert.equal(backlog.tasks.length, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("gemini 引擎可完成分析、执行、任务复核和主线终态复核的完整自动链路", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-runtime-gemini-"));
  const binDir = path.join(tempRoot, "bin");
  const tempRepo = createDemoRepo(tempRoot);
  const task = sampleTask("finish-main-flow", "实现主业务流程");
  const stateFile = createSequencedAgentCli(binDir, "gemini", {
    versionText: "gemini 0.36.0-preview.6\n",
    analyzeSequence: [
      { payload: sampleAnalysisPayload([task]) },
      { payload: sampleReviewPayload(task.title) },
      { payload: sampleAnalysisPayload([]) },
    ],
    executeSequence: [
      { finalMessage: "Gemini 已完成主业务流程。" },
    ],
  });
  createUnavailableCli(binDir, "codex");
  createUnavailableCli(binDir, "claude");

  const result = spawnHelloLoop(["gemini", "-y"], {
    cwd: tempRepo,
    env: buildCliEnv(binDir),
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /本次引擎：Gemini/);
    assert.match(result.stdout, /开始自动接续执行/);
    assert.match(result.stdout, /主线终态复核通过/);

    const state = readJson(stateFile);
    const backlog = readJson(path.join(tempRepo, ".helloloop", "backlog.json"));
    assert.equal(state.analyze, 3);
    assert.equal(state.execute, 1);
    assert.equal(backlog.tasks.length, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("run-once 执行阶段遇到 429 限流时会按无人值守策略同引擎自动恢复", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-runtime-autorecover-"));
  const binDir = path.join(tempRoot, "bin");
  const tempRepo = createDemoRepo(tempRoot);
  const task = sampleTask("finish-main-flow", "实现主业务流程");
  const codexStateFile = createSequencedAgentCli(binDir, "codex", {
    versionText: "codex 0.117.0\n",
    analyzeSequence: [
      { payload: sampleReviewPayload(task.title) },
    ],
    probeSequence: [
      { finalMessage: "HELLOLOOP_ENGINE_OK" },
    ],
    executeSequence: [
      { fail: true, errorText: "429 rate limit exceeded\n" },
      { finalMessage: "Codex 已自动恢复并完成主业务流程。" },
    ],
  });
  createUnavailableCli(binDir, "claude");
  createUnavailableCli(binDir, "gemini");

  writeJson(path.join(tempRepo, ".helloloop", "backlog.json"), {
    version: 1,
    project: "demo-project",
    updatedAt: "2026-03-29T00:00:00.000Z",
    tasks: [task],
  });
  writeJson(path.join(tempRepo, ".helloloop", "project.json"), {
    requiredDocs: ["docs/plan.md"],
    constraints: [
      "严格按开发文档推进。",
    ],
    defaultEngine: "",
    lastSelectedEngine: "",
    planner: {
      minTasks: 3,
      maxTasks: 8,
      roleInference: true,
      workflowHints: [],
    },
  });
  writeJson(path.join(tempRepo, ".helloloop", "policy.json"), {
    version: 1,
    updatedAt: "2026-03-29T00:00:00.000Z",
    maxLoopTasks: 4,
    maxTaskAttempts: 2,
    maxTaskStrategies: 4,
    maxReanalysisPasses: 3,
    stopOnFailure: false,
    stopOnHighRisk: true,
    runtimeRecovery: {
      enabled: true,
      heartbeatIntervalSeconds: 1,
      stallWarningSeconds: 30,
      maxIdleSeconds: 60,
      killGraceSeconds: 1,
      healthProbeTimeoutSeconds: 5,
      hardRetryDelaysSeconds: [0],
      softRetryDelaysSeconds: [0],
    },
    codex: {
      model: "",
      executable: cliExecutable(binDir, "codex"),
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
  });

  const result = spawnHelloLoop(["run-once", "--engine", "codex"], {
    cwd: tempRepo,
    env: buildCliEnv(binDir),
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /完成任务：实现主业务流程/);
    assert.doesNotMatch(result.stdout, /是否切换到其他可用引擎继续/);

    const codexState = readJson(codexStateFile);
    const backlog = readJson(path.join(tempRepo, ".helloloop", "backlog.json"));
    assert.equal(codexState.analyze, 1);
    assert.equal(codexState.probe, 1);
    assert.equal(codexState.execute, 2);
    assert.equal(backlog.tasks[0].status, "done");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("run-once 执行阶段遇到 400 请求错误时会先探测再按硬阻塞额度停止，不会自动切引擎", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-runtime-hardfail-"));
  const binDir = path.join(tempRoot, "bin");
  const tempRepo = createDemoRepo(tempRoot);
  const task = sampleTask("finish-main-flow", "实现主业务流程");
  const codexStateFile = createSequencedAgentCli(binDir, "codex", {
    versionText: "codex 0.117.0\n",
    analyzeSequence: [],
    probeSequence: [
      { finalMessage: "HELLOLOOP_ENGINE_OK" },
    ],
    executeSequence: [
      { fail: true, errorText: "400 bad request: invalid schema\n" },
      { fail: true, errorText: "400 bad request: invalid schema\n" },
    ],
  });
  createUnavailableCli(binDir, "claude");
  createUnavailableCli(binDir, "gemini");

  writeJson(path.join(tempRepo, ".helloloop", "backlog.json"), {
    version: 1,
    project: "demo-project",
    updatedAt: "2026-03-29T00:00:00.000Z",
    tasks: [task],
  });
  writeJson(path.join(tempRepo, ".helloloop", "project.json"), {
    requiredDocs: ["docs/plan.md"],
    constraints: ["严格按开发文档推进。"],
    defaultEngine: "",
    lastSelectedEngine: "",
    planner: {
      minTasks: 3,
      maxTasks: 8,
      roleInference: true,
      workflowHints: [],
    },
  });
  writeJson(path.join(tempRepo, ".helloloop", "policy.json"), {
    version: 1,
    updatedAt: "2026-03-29T00:00:00.000Z",
    maxLoopTasks: 4,
    maxTaskAttempts: 2,
    maxTaskStrategies: 4,
    maxReanalysisPasses: 3,
    stopOnFailure: false,
    stopOnHighRisk: true,
    runtimeRecovery: {
      enabled: true,
      heartbeatIntervalSeconds: 1,
      stallWarningSeconds: 30,
      maxIdleSeconds: 60,
      killGraceSeconds: 1,
      healthProbeTimeoutSeconds: 5,
      hardRetryDelaysSeconds: [0],
      softRetryDelaysSeconds: [0],
    },
    codex: {
      model: "",
      executable: cliExecutable(binDir, "codex"),
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
  });

  const result = spawnHelloLoop(["run-once", "--engine", "codex"], {
    cwd: tempRepo,
    env: buildCliEnv(binDir),
  });

  try {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /400 bad request/i);
    assert.match(result.stderr, /自动恢复额度已用尽/);
    assert.doesNotMatch(result.stderr, /是否切换到其他可用引擎继续/);
    const codexState = readJson(codexStateFile);
    const backlog = readJson(path.join(tempRepo, ".helloloop", "backlog.json"));
    assert.equal(codexState.probe, 1);
    assert.equal(codexState.execute, 2);
    assert.equal(backlog.tasks[0].status, "failed");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("最终停止自动恢复后会按全局配置发送邮件通知", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-runtime-email-"));
  const binDir = path.join(tempRoot, "bin");
  const tempRepo = createDemoRepo(tempRoot);
  const helloLoopHome = path.join(tempRoot, "helloloop-home");
  const smtpServer = await createSmtpCaptureServer();
  const task = sampleTask("finish-main-flow", "实现主业务流程");
  const codexStateFile = createSequencedAgentCli(binDir, "codex", {
    versionText: "codex 0.117.0\n",
    analyzeSequence: [],
    probeSequence: [
      { finalMessage: "HELLOLOOP_ENGINE_OK" },
    ],
    executeSequence: [
      { fail: true, errorText: "payment required: insufficient balance\n" },
      { fail: true, errorText: "payment required: insufficient balance\n" },
    ],
  });
  createUnavailableCli(binDir, "claude");
  createUnavailableCli(binDir, "gemini");

  writeJson(path.join(helloLoopHome, "settings.json"), {
    notifications: {
      email: {
        enabled: true,
        to: ["notify@example.com"],
        from: "helloloop@example.com",
        smtp: {
          host: smtpServer.host,
          port: smtpServer.port,
          secure: false,
          starttls: false,
          timeoutSeconds: 5,
          rejectUnauthorized: false,
        },
      },
    },
  });

  writeJson(path.join(tempRepo, ".helloloop", "backlog.json"), {
    version: 1,
    project: "demo-project",
    updatedAt: "2026-03-29T00:00:00.000Z",
    tasks: [task],
  });
  writeJson(path.join(tempRepo, ".helloloop", "project.json"), {
    requiredDocs: ["docs/plan.md"],
    constraints: ["严格按开发文档推进。"],
    defaultEngine: "",
    lastSelectedEngine: "",
    planner: {
      minTasks: 3,
      maxTasks: 8,
      roleInference: true,
      workflowHints: [],
    },
  });
  writeJson(path.join(tempRepo, ".helloloop", "policy.json"), {
    version: 1,
    updatedAt: "2026-03-29T00:00:00.000Z",
    maxLoopTasks: 4,
    maxTaskAttempts: 2,
    maxTaskStrategies: 4,
    maxReanalysisPasses: 3,
    stopOnFailure: false,
    stopOnHighRisk: true,
    runtimeRecovery: {
      enabled: true,
      heartbeatIntervalSeconds: 1,
      stallWarningSeconds: 30,
      maxIdleSeconds: 60,
      killGraceSeconds: 1,
      healthProbeTimeoutSeconds: 5,
      hardRetryDelaysSeconds: [0],
      softRetryDelaysSeconds: [0],
    },
    codex: {
      model: "",
      executable: cliExecutable(binDir, "codex"),
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
  });

  const result = await spawnHelloLoopAsync(["run-once", "--engine", "codex"], {
    cwd: tempRepo,
    env: buildCliEnv(binDir, {
      HELLOLOOP_HOME: helloLoopHome,
      HELLOLOOP_SETTINGS_FILE: path.join(helloLoopHome, "settings.json"),
    }),
  });

  try {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /告警邮件已发送/);
    const codexState = readJson(codexStateFile);
    const backlog = readJson(path.join(tempRepo, ".helloloop", "backlog.json"));
    assert.equal(codexState.probe, 1);
    assert.equal(codexState.execute, 2);
    assert.equal(backlog.tasks[0].status, "failed");
    assert.equal(smtpServer.messages.length, 1);
    assert.match(smtpServer.messages[0], /HelloLoop 已暂停本轮自动恢复/);
    assert.match(smtpServer.messages[0], /payment required: insufficient balance/i);
  } finally {
    await smtpServer.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

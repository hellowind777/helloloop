import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildCliEnv,
  cliExecutable,
  cleanupTempDir,
  createSmtpCaptureServer,
  createDemoRepo,
  createSequencedAgentCli,
  createUnavailableCli,
  readJson,
  sampleReviewPayload,
  sampleTask,
  spawnHelloLoop,
  spawnHelloLoopAsync,
  waitFor,
  waitForSupervisorCompletion,
  waitForTaskStatus,
  writeJson,
} from "./helpers/multi_host_runtime_fixture.mjs";

function writeRuntimeProjectConfig(tempRepo) {
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
}

function writeRuntimePolicy(tempRepo, binDir) {
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
}

function writeSingleTaskBacklog(tempRepo, task) {
  writeJson(path.join(tempRepo, ".helloloop", "backlog.json"), {
    version: 1,
    project: "demo-project",
    updatedAt: "2026-03-29T00:00:00.000Z",
    tasks: [task],
  });
}

test("run-once 执行阶段遇到 429 限流时会按无人值守策略同引擎自动恢复", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-runtime-autorecover-"));
  const binDir = path.join(tempRoot, "bin");
  const tempRepo = createDemoRepo(tempRoot);
  const task = sampleTask("finish-main-flow", "实现主业务流程");
  const codexStateFile = createSequencedAgentCli(binDir, "codex", {
    versionText: "codex 0.117.0\n",
    analyzeSequence: [{ payload: sampleReviewPayload(task.title) }],
    probeSequence: [{ finalMessage: "HELLOLOOP_ENGINE_OK" }],
    executeSequence: [
      { fail: true, errorText: "429 rate limit exceeded\n" },
      { finalMessage: "Codex 已自动恢复并完成主业务流程。" },
    ],
  });
  createUnavailableCli(binDir, "claude");
  createUnavailableCli(binDir, "gemini");

  writeSingleTaskBacklog(tempRepo, task);
  writeRuntimeProjectConfig(tempRepo);
  writeRuntimePolicy(tempRepo, binDir);

  const result = spawnHelloLoop(["run-once", "--engine", "codex"], {
    cwd: tempRepo,
    env: buildCliEnv(binDir),
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /HelloLoop supervisor 已启动/);
    assert.match(result.stdout, /已切换为后台执行/);
    assert.doesNotMatch(result.stdout, /是否切换到其他可用引擎继续/);

    await waitForTaskStatus(tempRepo, "done");
    await waitForSupervisorCompletion(tempRepo);
    const codexState = readJson(codexStateFile);
    const backlog = readJson(path.join(tempRepo, ".helloloop", "backlog.json"));
    assert.equal(codexState.analyze, 1);
    assert.equal(codexState.probe, 1);
    assert.equal(codexState.execute, 2);
    assert.equal(backlog.tasks[0].status, "done");
  } finally {
    await cleanupTempDir(tempRoot, path.join(tempRepo, ".helloloop", "supervisor", "state.json"));
  }
});

test("run-once 执行阶段遇到 400 请求错误时会先探测再按硬阻塞额度停止，不会自动切引擎", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-runtime-hardfail-"));
  const binDir = path.join(tempRoot, "bin");
  const tempRepo = createDemoRepo(tempRoot);
  const task = sampleTask("finish-main-flow", "实现主业务流程");
  const codexStateFile = createSequencedAgentCli(binDir, "codex", {
    versionText: "codex 0.117.0\n",
    analyzeSequence: [],
    probeSequence: [{ finalMessage: "HELLOLOOP_ENGINE_OK" }],
    executeSequence: [
      { fail: true, errorText: "400 bad request: invalid schema\n" },
      { fail: true, errorText: "400 bad request: invalid schema\n" },
    ],
  });
  createUnavailableCli(binDir, "claude");
  createUnavailableCli(binDir, "gemini");

  writeSingleTaskBacklog(tempRepo, task);
  writeRuntimeProjectConfig(tempRepo);
  writeRuntimePolicy(tempRepo, binDir);

  const result = spawnHelloLoop(["run-once", "--engine", "codex"], {
    cwd: tempRepo,
    env: buildCliEnv(binDir),
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /HelloLoop supervisor 已启动/);
    assert.match(result.stdout, /已切换为后台执行/);
    const supervisorState = await waitForSupervisorCompletion(tempRepo);
    const codexState = readJson(codexStateFile);
    const backlog = readJson(path.join(tempRepo, ".helloloop", "backlog.json"));
    assert.equal(supervisorState.status, "failed");
    assert.match(supervisorState.message || "", /400 bad request/i);
    assert.match(supervisorState.message || "", /自动恢复额度已用尽/);
    assert.doesNotMatch(supervisorState.message || "", /是否切换到其他可用引擎继续/);
    assert.equal(codexState.probe, 1);
    assert.equal(codexState.execute, 2);
    assert.equal(backlog.tasks[0].status, "failed");
  } finally {
    await cleanupTempDir(tempRoot, path.join(tempRepo, ".helloloop", "supervisor", "state.json"));
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
    probeSequence: [{ finalMessage: "HELLOLOOP_ENGINE_OK" }],
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

  writeSingleTaskBacklog(tempRepo, task);
  writeRuntimeProjectConfig(tempRepo);
  writeRuntimePolicy(tempRepo, binDir);

  const result = await spawnHelloLoopAsync(["run-once", "--engine", "codex"], {
    cwd: tempRepo,
    env: buildCliEnv(binDir, {
      HELLOLOOP_HOME: helloLoopHome,
      HELLOLOOP_SETTINGS_FILE: path.join(helloLoopHome, "settings.json"),
    }),
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /HelloLoop supervisor 已启动/);
    assert.match(result.stdout, /已切换为后台执行/);
    await waitForSupervisorCompletion(tempRepo);
    await waitFor(() => smtpServer.messages.length === 1, 10000, 100);
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
    await cleanupTempDir(tempRoot, path.join(tempRepo, ".helloloop", "supervisor", "state.json"));
  }
});

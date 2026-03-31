import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildCliEnv,
  cleanupTempDir,
  createDemoRepo,
  createSequencedAgentCli,
  createUnavailableCli,
  readJson,
  sampleAnalysisPayload,
  sampleReviewPayload,
  sampleTask,
  spawnHelloLoop,
  waitForBacklogTaskCount,
  waitForSupervisorCompletion,
} from "./helpers/multi_host_runtime_fixture.mjs";

test("claude 引擎可完成分析、执行、任务复核和主线终态复核的完整自动链路", async () => {
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
    executeSequence: [{ finalMessage: "Claude 已完成主业务流程。" }],
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
    assert.match(result.stdout, /HelloLoop supervisor 已启动/);
    assert.match(result.stdout, /已切换为后台执行/);

    await waitForBacklogTaskCount(tempRepo, 0);
    await waitForSupervisorCompletion(tempRepo);
    const state = readJson(stateFile);
    const backlog = readJson(path.join(tempRepo, ".helloloop", "backlog.json"));
    assert.equal(state.analyze, 3);
    assert.equal(state.execute, 1);
    assert.equal(backlog.tasks.length, 0);
  } finally {
    await cleanupTempDir(tempRoot, path.join(tempRepo, ".helloloop", "supervisor", "state.json"));
  }
});

test("gemini 引擎可完成分析、执行、任务复核和主线终态复核的完整自动链路", async () => {
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
    executeSequence: [{ finalMessage: "Gemini 已完成主业务流程。" }],
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
    assert.match(result.stdout, /HelloLoop supervisor 已启动/);
    assert.match(result.stdout, /已切换为后台执行/);

    await waitForBacklogTaskCount(tempRepo, 0);
    await waitForSupervisorCompletion(tempRepo);
    const state = readJson(stateFile);
    const backlog = readJson(path.join(tempRepo, ".helloloop", "backlog.json"));
    assert.equal(state.analyze, 3);
    assert.equal(state.execute, 1);
    assert.equal(backlog.tasks.length, 0);
  } finally {
    await cleanupTempDir(tempRoot, path.join(tempRepo, ".helloloop", "supervisor", "state.json"));
  }
});

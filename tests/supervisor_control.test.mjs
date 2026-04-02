import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { readJson, writeJson } from "../src/common.mjs";
import { createContext } from "../src/context.mjs";
import { pauseMainline } from "../src/supervisor_control.mjs";
import { isPidAlive, waitFor } from "./helpers/supervisor_test_support.mjs";

test("pauseMainline 会终止当前 supervisor 进程并把运行态落盘为 operator paused", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-pause-mainline-"));
  const repoRoot = path.join(tempRoot, "repo");
  const context = createContext({ repoRoot });
  const sessionId = "session-2026-04-02-10-00-00-000Z";
  const runDir = path.join(context.runsDir, sessionId);
  const runtimeFile = path.join(runDir, "attempt-1-runtime.json");
  const activityFile = path.join(runDir, "attempt-1-activity.json");
  const message = "测试触发主线暂停。";

  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  child.unref();

  try {
    writeJson(context.statusFile, {
      ok: true,
      sessionId,
      stage: "implementation",
      taskId: "task-pause-mainline",
      taskTitle: "落盘主线暂停状态",
      runDir,
      message: "当前任务执行中",
      updatedAt: "2026-04-02T10:00:00.000Z",
    });
    writeJson(context.supervisorStateFile, {
      sessionId,
      command: "run-loop",
      status: "running",
      pid: child.pid,
      guardianPid: 0,
      workerPid: child.pid,
      startedAt: "2026-04-02T10:00:00.000Z",
      updatedAt: "2026-04-02T10:00:00.000Z",
    });
    writeJson(runtimeFile, {
      engine: "codex",
      status: "running",
      outputPrefix: "attempt-1",
      attemptPrefix: "attempt-1",
      activityFile,
      updatedAt: "2026-04-02T10:00:00.000Z",
    });
    writeJson(activityFile, {
      status: "running",
      current: {
        kind: "command",
        status: "in_progress",
        label: "执行当前任务",
        itemId: "cmd-1",
      },
      runtime: {
        status: "running",
      },
      updatedAt: "2026-04-02T10:00:00.000Z",
    });

    const result = await pauseMainline(context, { message });

    assert.equal(result.accepted, true);
    assert.equal(result.sessionId, sessionId);
    assert.equal(result.command, "pause-mainline");
    assert.equal(result.paused, true);
    assert.equal(result.terminated.length, 1);
    assert.equal(result.terminated[0].pid, child.pid);

    await waitFor(() => !isPidAlive(child.pid), 5000);

    const pauseControl = readJson(context.supervisorPauseFile);
    const supervisorState = readJson(context.supervisorStateFile);
    const supervisorResult = readJson(context.supervisorResultFile);
    const latestStatus = readJson(context.statusFile);
    const runtime = readJson(runtimeFile);
    const activity = readJson(activityFile);

    assert.equal(pauseControl.paused, true);
    assert.equal(pauseControl.reasonCode, "operator_paused");
    assert.equal(pauseControl.message, message);
    assert.equal(pauseControl.sessionId, sessionId);
    assert.equal(pauseControl.command, "run-loop");
    assert.equal(pauseControl.runDir, runDir);

    assert.equal(supervisorState.status, "stopped");
    assert.equal(supervisorState.stoppedBy, "operator");
    assert.equal(supervisorState.pauseReasonCode, "operator_paused");
    assert.equal(supervisorState.pid, 0);
    assert.equal(supervisorState.workerPid, 0);

    assert.equal(supervisorResult.paused, true);
    assert.equal(supervisorResult.stopped, true);
    assert.equal(supervisorResult.command, "run-loop");

    assert.equal(latestStatus.stage, "paused_operator");
    assert.equal(latestStatus.message, message);
    assert.equal(latestStatus.runDir, runDir);

    assert.equal(runtime.status, "paused_operator");
    assert.equal(runtime.failureCode, "operator_paused");
    assert.equal(runtime.failureFamily, "manual");
    assert.equal(runtime.failureReason, message);

    assert.equal(activity.status, "paused_operator");
    assert.equal(activity.current.kind, "operator");
    assert.equal(activity.current.status, "paused");
    assert.equal(activity.current.label, message);
    assert.equal(activity.runtime.status, "paused_operator");
    assert.equal(activity.runtime.failureCode, "operator_paused");
  } finally {
    if (isPidAlive(child.pid)) {
      try {
        process.kill(child.pid);
      } catch {
        // ignore cleanup race
      }
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

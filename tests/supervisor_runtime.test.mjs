import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { saveBacklog, saveProjectConfig, scaffoldIfMissing } from "../src/config.mjs";
import { createContext } from "../src/context.mjs";
import { runOnce, renderStatusText } from "../src/runner.mjs";
import {
  cleanupTempDir,
  readJson,
  waitFor,
} from "./helpers/supervisor_test_support.mjs";
import {
  buildCliEnv,
  sampleAnalysisPayload,
  spawnHelloLoop,
} from "./helpers/analyze_cli_fixture.mjs";

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createUnavailableCli(binDir, commandName) {
  if (process.platform === "win32") {
    writeText(path.join(binDir, `${commandName}.ps1`), `Write-Error '${commandName} unavailable in test' ; exit 1\r\n`);
    return;
  }

  const filePath = path.join(binDir, commandName);
  writeText(filePath, `#!/usr/bin/env sh\necho ${commandName} unavailable in test >&2\nexit 1\n`);
  fs.chmodSync(filePath, 0o755);
}

function createSupervisorCodex(binDir, { analysisPayload, reviewPayload, executeDelayMs = 0 }) {
  const stubFile = path.join(binDir, "codex-stub.cjs");
  writeText(stubFile, `
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const delayMs = ${JSON.stringify(executeDelayMs)};
const analysisPayload = ${JSON.stringify(analysisPayload)};
const reviewPayload = ${JSON.stringify(reviewPayload)};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  if (outputIndex >= 0 && args[outputIndex + 1]) {
    fs.mkdirSync(path.dirname(args[outputIndex + 1]), { recursive: true });
    if (schemaName === "analysis-output.schema.json") {
      fs.writeFileSync(args[outputIndex + 1], JSON.stringify(analysisPayload), "utf8");
    } else if (schemaName === "task-review-output.schema.json") {
      fs.writeFileSync(args[outputIndex + 1], JSON.stringify(reviewPayload), "utf8");
    } else {
      if (delayMs > 0) {
        await sleep(delayMs);
      }
      fs.writeFileSync(args[outputIndex + 1], "任务执行完成", "utf8");
    }
  }

  process.stdout.write(schemaName ? "analysis ok\\n" : "exec ok\\n");
}

main().catch((error) => {
  process.stderr.write(String(error?.stack || error || ""));
  process.exit(1);
});
`);

  if (process.platform === "win32") {
    writeText(path.join(binDir, "codex.ps1"), "node \"$PSScriptRoot/codex-stub.cjs\" @args\r\nexit $LASTEXITCODE\r\n");
    return path.join(binDir, "codex.ps1");
  }

  const shellFile = path.join(binDir, "codex");
  writeText(shellFile, "#!/usr/bin/env sh\nnode \"$(dirname \"$0\")/codex-stub.cjs\" \"$@\"\n");
  fs.chmodSync(shellFile, 0o755);
  return shellFile;
}

function sampleTask(id, title) {
  return {
    id,
    title,
    status: "pending",
    priority: "P1",
    risk: "low",
    goal: `${title}，并满足验收条件。`,
    docs: ["docs/plan.md"],
    paths: ["src/"],
    acceptance: ["主业务流程可运行", "关键路径通过验证"],
    dependsOn: [],
    verify: ["node --version"],
  };
}

function sampleReviewPayload(title) {
  return {
    verdict: "complete",
    summary: `${title}已真正完成。`,
    acceptanceChecks: [
      {
        item: "主业务流程可运行",
        status: "met",
        evidence: "执行结果与验证均已通过。",
      },
      {
        item: "关键路径通过验证",
        status: "met",
        evidence: "verify 命令执行成功。",
      },
    ],
    missing: [],
    blockerReason: "",
    nextAction: "继续主线下一任务。",
  };
}

function createPolicy(binDir, codexExecutable) {
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

test("Codex 宿主内 analyze 自动执行会转入后台 supervisor，status 可见运行中会话", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-supervisor-analyze-"));
  const binDir = path.join(tempRoot, "bin");
  const repoDir = path.join(tempRoot, "repo");
  const task = sampleTask("finish-main-flow", "实现主业务流程");
  const codexExecutable = createSupervisorCodex(binDir, {
    analysisPayload: sampleAnalysisPayload({ tasks: [task] }),
    reviewPayload: sampleReviewPayload(task.title),
    executeDelayMs: 3000,
  });
  createUnavailableCli(binDir, "claude");
  createUnavailableCli(binDir, "gemini");
  const env = buildCliEnv(binDir, {
    HELLOLOOP_HOST_CONTEXT: "codex",
    HELLOLOOP_HOST_LEASE_PID: String(process.pid),
    HELLOLOOP_HOST_LEASE_NAME: process.platform === "win32" ? "node.exe" : "node",
  });

  try {
    writeText(path.join(repoDir, "docs", "plan.md"), "# 开发计划\n- 实现主业务流程\n");
    writeText(path.join(repoDir, "src", "index.js"), "console.log('hello');\n");
    writeText(path.join(repoDir, ".helloagents", "verify.yaml"), "commands:\n  - node --version\n");
    writeJson(path.join(repoDir, ".helloloop", "policy.json"), createPolicy(binDir, codexExecutable));

    const startedAt = Date.now();
    const result = spawnHelloLoop([], {
      cwd: repoDir,
      env,
      input: "1\ny\n",
    });
    const durationMs = Date.now() - startedAt;

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /HelloLoop supervisor 已启动/);
    assert.match(result.stdout, /已切换为后台执行/);
    assert.doesNotMatch(result.stdout, /完成任务：/);
    assert.ok(durationMs < 12000, `后台启动耗时过长：${durationMs}ms`);

    const context = createContext({ repoRoot: repoDir });
    await waitFor(() => {
      const statusText = renderStatusText(context);
      assert.match(statusText, /后台会话：(running|launching)/);
      assert.match(statusText, /后台会话 ID：/);
      return true;
    }, 5000);

    await waitFor(() => {
      const backlog = readJson(context.backlogFile);
      return backlog.tasks[0]?.status === "done";
    }, 20000);
  } finally {
    await cleanupTempDir(tempRoot, path.join(repoDir, ".helloloop", "supervisor", "state.json"));
  }
});

test("run-once 在宿主租约中途失效时会停止当前引擎并把任务回退为 pending", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-host-lease-stop-"));
  const binDir = path.join(tempRoot, "bin");
  const repoDir = path.join(tempRoot, "repo");
  const context = createContext({ repoRoot: repoDir });
  const task = sampleTask("finish-main-flow", "实现主业务流程");
  const codexExecutable = createSupervisorCodex(binDir, {
    analysisPayload: sampleAnalysisPayload({ tasks: [task] }),
    reviewPayload: sampleReviewPayload(task.title),
    executeDelayMs: 4000,
  });
  createUnavailableCli(binDir, "claude");
  createUnavailableCli(binDir, "gemini");
  setupTaskRepo(repoDir, context, task);
  writeJson(context.policyFile, createPolicy(binDir, codexExecutable));

  const leaseProcess = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 500)"], {
    stdio: "ignore",
  });

  try {
    const result = await runOnce(context, {
      engine: "codex",
      engineSource: "flag",
      yes: true,
      hostLease: {
        pid: leaseProcess.pid,
        name: process.platform === "win32" ? "node.exe" : "node",
        hostContext: "codex",
        hostDisplayName: "Codex CLI",
      },
    });

    const backlog = readJson(context.backlogFile);
    assert.equal(result.ok, false);
    assert.equal(result.kind, "host-lease-stopped");
    assert.match(result.summary, /宿主窗口已关闭/);
    assert.equal(backlog.tasks[0].status, "pending");
  } finally {
    leaseProcess.kill();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Codex 宿主内 run-once 默认通过后台 supervisor 执行", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-supervisor-run-once-"));
  const binDir = path.join(tempRoot, "bin");
  const repoDir = path.join(tempRoot, "repo");
  const context = createContext({ repoRoot: repoDir });
  const task = sampleTask("finish-main-flow", "实现主业务流程");
  const codexExecutable = createSupervisorCodex(binDir, {
    analysisPayload: sampleAnalysisPayload({ tasks: [task] }),
    reviewPayload: sampleReviewPayload(task.title),
    executeDelayMs: 2500,
  });
  createUnavailableCli(binDir, "claude");
  createUnavailableCli(binDir, "gemini");
  setupTaskRepo(repoDir, context, task);
  writeJson(context.policyFile, createPolicy(binDir, codexExecutable));

  const env = buildCliEnv(binDir, {
    HELLOLOOP_HOST_CONTEXT: "codex",
    HELLOLOOP_HOST_LEASE_PID: String(process.pid),
    HELLOLOOP_HOST_LEASE_NAME: process.platform === "win32" ? "node.exe" : "node",
  });

  try {
    const result = spawnHelloLoop(["run-once", "--engine", "codex"], {
      cwd: repoDir,
      env,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /HelloLoop supervisor 已启动/);
    assert.match(result.stdout, /已切换为后台执行/);
    assert.doesNotMatch(result.stdout, /完成任务：/);

    await waitFor(() => {
      const statusText = renderStatusText(context, { engine: "codex" });
      assert.match(statusText, /后台会话：(running|launching)/);
      return true;
    }, 5000);

    await waitFor(() => {
      const backlog = readJson(context.backlogFile);
      return backlog.tasks[0]?.status === "done";
    }, 60000);

    await waitFor(() => {
      const supervisorState = readJson(context.supervisorStateFile);
      return supervisorState.status === "completed";
    }, 60000);
  } finally {
    await cleanupTempDir(tempRoot, context.supervisorStateFile);
  }
});

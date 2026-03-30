import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { scaffoldIfMissing, saveBacklog, saveProjectConfig } from "../src/config.mjs";
import { createContext } from "../src/context.mjs";
import { runOnce } from "../src/runner.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const npmBinEntry = path.join(repoRoot, "bin", "helloloop.js");

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function createUnavailableCli(binDir, commandName) {
  if (process.platform === "win32") {
    writeText(path.join(binDir, `${commandName}.ps1`), `Write-Error '${commandName} unavailable in test' ; exit 1\r\n`);
    return;
  }

  const shellFile = path.join(binDir, commandName);
  writeText(shellFile, `#!/usr/bin/env sh\necho ${commandName} unavailable in test >&2\nexit 1\n`);
  fs.chmodSync(shellFile, 0o755);
}

function createProgrammableCodex(binDir, config) {
  const configFile = path.join(binDir, "codex-config.json");
  const stateFile = path.join(binDir, "codex-state.json");
  writeJson(configFile, config);
  writeJson(stateFile, {
    analysis: 0,
    review: 0,
    execute: 0,
  });

  const stubFile = path.join(binDir, "codex-stub.cjs");
  writeText(stubFile, `
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(${JSON.stringify(configFile)}, "utf8"));
const state = JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}, "utf8"));

function saveState(nextState) {
  fs.writeFileSync(${JSON.stringify(stateFile)}, JSON.stringify(nextState), "utf8");
}

if (args.includes("--version")) {
  process.stdout.write("codex 0.117.0\\n");
  process.exit(0);
}

const schemaIndex = args.indexOf("--output-schema");
const schemaName = schemaIndex >= 0 && args[schemaIndex + 1]
  ? path.basename(args[schemaIndex + 1])
  : "";
const outputIndex = args.indexOf("-o");

let phase = "execute";
if (schemaName === "analysis-output.schema.json") {
  phase = "analysis";
} else if (schemaName === "task-review-output.schema.json") {
  phase = "review";
}

state[phase] = Number(state[phase] || 0) + 1;
saveState(state);

function pickSequence(items, count) {
  if (!Array.isArray(items) || !items.length) {
    return null;
  }
  return items[Math.min(count - 1, items.length - 1)];
}

if (outputIndex >= 0 && args[outputIndex + 1]) {
  fs.mkdirSync(path.dirname(args[outputIndex + 1]), { recursive: true });
  let content = "";
  if (phase === "analysis") {
    content = JSON.stringify(pickSequence(config.analysisPayloads, state.analysis) || {});
  } else if (phase === "review") {
    content = JSON.stringify(pickSequence(config.reviewPayloads, state.review) || {});
  } else {
    content = String(pickSequence(config.executeMessages, state.execute) || "任务执行完成");
  }
  fs.writeFileSync(args[outputIndex + 1], content, "utf8");
}

process.stdout.write(phase + " ok\\n");
process.exit(0);
`);

  if (process.platform === "win32") {
    writeText(path.join(binDir, "codex.ps1"), `node "$PSScriptRoot/codex-stub.cjs" @args\r\nexit $LASTEXITCODE\r\n`);
    return stateFile;
  }

  const shellFile = path.join(binDir, "codex");
  writeText(shellFile, `#!/usr/bin/env sh\nnode "$(dirname "$0")/codex-stub.cjs" "$@"\n`);
  fs.chmodSync(shellFile, 0o755);
  return stateFile;
}

function cliExecutable(binDir, commandName) {
  return path.join(binDir, process.platform === "win32" ? `${commandName}.ps1` : commandName);
}

function buildCliEnv(binDir, extra = {}) {
  const isolatedHome = path.join(path.dirname(binDir), "user-home");
  const parsedHome = path.parse(isolatedHome);
  return {
    ...process.env,
    PATH: [binDir, process.env.PATH || ""].join(path.delimiter),
    HELLOLOOP_CODEX_EXECUTABLE: cliExecutable(binDir, "codex"),
    HELLOLOOP_CLAUDE_EXECUTABLE: cliExecutable(binDir, "claude"),
    HELLOLOOP_GEMINI_EXECUTABLE: cliExecutable(binDir, "gemini"),
    HELLOLOOP_SETTINGS_FILE: path.join(binDir, "settings.json"),
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    HOMEDRIVE: parsedHome.root ? parsedHome.root.replace(/[\\/]+$/, "") : "",
    HOMEPATH: parsedHome.root ? isolatedHome.slice(parsedHome.root.length - 1) : isolatedHome,
    ...extra,
  };
}

function spawnHelloLoop(args, options = {}) {
  return spawnSync("node", [npmBinEntry, ...args], {
    cwd: options.cwd || repoRoot,
    encoding: "utf8",
    env: options.env || process.env,
    input: options.input,
  });
}

function sampleTask(id, title) {
  return {
    id,
    title,
    status: "pending",
    priority: "P1",
    risk: "low",
    goal: `${title}，并满足验收条件。`,
    docs: [
      "docs",
    ],
    paths: [
      "src/",
    ],
    acceptance: [
      `${title}的关键能力已完成`,
      `${title}相关验证通过`,
    ],
    verify: [
      "node --version",
    ],
  };
}

function sampleAnalysisPayload(tasks, overrides = {}) {
  return {
    project: "demo-project",
    summary: {
      currentState: tasks.length ? "仍有主线任务待完成。" : "开发文档目标已完成。",
      implemented: tasks.length ? ["基础骨架已存在"] : ["开发文档目标已全部闭合"],
      remaining: tasks.map((item) => item.title),
      nextAction: tasks.length ? `继续执行：${tasks[0].title}` : "无需继续开发。",
    },
    constraints: [
      "严格按开发文档推进。",
    ],
    tasks,
    ...overrides,
  };
}

function sampleReviewPayload(verdict, title, overrides = {}) {
  const complete = verdict === "complete";
  return {
    verdict,
    summary: complete ? `${title}已真正完成。` : `${title}尚未完成。`,
    acceptanceChecks: [
      {
        item: `${title}的关键能力已完成`,
        status: complete ? "met" : "not_met",
        evidence: complete ? "仓库内已存在对应实现。" : "关键能力仍缺失。",
      },
      {
        item: `${title}相关验证通过`,
        status: complete ? "met" : "uncertain",
        evidence: complete ? "相关验证命令已通过。" : "虽然基础验证通过，但任务验收证据仍不足。",
      },
    ],
    missing: complete ? [] : [
      `${title}的验收尚未闭合`,
    ],
    blockerReason: "",
    nextAction: complete ? "继续主线下一任务。" : `继续收口 ${title} 的剩余实现。`,
    ...overrides,
  };
}

test("任务复核发现只是部分完成时，会继续当前主线任务而不是提前结束", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-task-review-"));
  const binDir = path.join(tempRoot, "bin");
  const repoDir = path.join(tempRoot, "repo");
  const context = createContext({ repoRoot: repoDir });
  const task = sampleTask("finish-main-flow", "实现主业务流程");
  const stateFile = createProgrammableCodex(binDir, {
    analysisPayloads: [],
    reviewPayloads: [
      sampleReviewPayload("incomplete", task.title),
      sampleReviewPayload("complete", task.title),
    ],
    executeMessages: [
      "第一轮执行后自认为完成",
      "第二轮执行后完成收口",
    ],
  });
  createUnavailableCli(binDir, "claude");
  createUnavailableCli(binDir, "gemini");

  try {
    writeText(path.join(repoDir, "docs", "plan.md"), "# 开发计划\n- 实现主业务流程\n");
    writeText(path.join(repoDir, "src", "index.js"), "console.log('hello');\n");
    writeText(path.join(repoDir, ".helloagents", "verify.yaml"), "commands:\n  - node --version\n");
    scaffoldIfMissing(context);
    writeJson(context.policyFile, {
      version: 1,
      updatedAt: "2026-03-29T00:00:00.000Z",
      maxLoopTasks: 4,
      maxTaskAttempts: 2,
      maxTaskStrategies: 4,
      maxReanalysisPasses: 3,
      stopOnFailure: false,
      stopOnHighRisk: true,
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
      version: 1,
      project: "demo-project",
      updatedAt: "2026-03-29T00:00:00.000Z",
      tasks: [task],
    });

    const result = await runOnce(context, {
      maxAttempts: 2,
      maxStrategies: 1,
      yes: true,
      engineResolution: {
        ok: true,
        engine: "codex",
        displayName: "Codex",
        source: "test",
        sourceLabel: "测试注入",
        basis: ["单元测试直接指定 Codex。"],
        hostContext: "terminal",
        hostDisplayName: "终端",
        probes: [],
        availableEngines: ["codex"],
      },
    });

    const state = readJson(stateFile);
    const backlog = readJson(context.backlogFile);

    assert.equal(result.ok, true);
    assert.equal(state.execute, 2);
    assert.equal(state.review, 2);
    assert.equal(backlog.tasks[0].status, "done");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("backlog 清空后会自动复分析主线，并继续执行新发现的剩余任务", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-mainline-reanalysis-"));
  const binDir = path.join(tempRoot, "bin");
  const repoDir = path.join(tempRoot, "repo");
  const taskA = sampleTask("task-a", "实现第一阶段功能");
  const taskB = sampleTask("task-b", "补齐第二阶段功能");
  const stateFile = createProgrammableCodex(binDir, {
    analysisPayloads: [
      sampleAnalysisPayload([taskA]),
      sampleAnalysisPayload([taskB], {
        summary: {
          currentState: "第一阶段已完成，但第二阶段仍未闭合。",
          implemented: ["第一阶段功能已完成"],
          remaining: [taskB.title],
          nextAction: `继续执行：${taskB.title}`,
        },
      }),
      sampleAnalysisPayload([]),
    ],
    reviewPayloads: [
      sampleReviewPayload("complete", taskA.title),
      sampleReviewPayload("complete", taskB.title),
    ],
    executeMessages: [
      "第一阶段执行完成",
      "第二阶段执行完成",
    ],
  });
  createUnavailableCli(binDir, "claude");
  createUnavailableCli(binDir, "gemini");

  try {
    writeText(path.join(repoDir, "docs", "plan.md"), "# 开发计划\n- 实现第一阶段功能\n- 补齐第二阶段功能\n");
    writeText(path.join(repoDir, "src", "index.js"), "console.log('hello');\n");
    writeText(path.join(repoDir, ".helloagents", "verify.yaml"), "commands:\n  - node --version\n");

    const result = spawnHelloLoop(["codex", "-y"], {
      cwd: repoDir,
      env: buildCliEnv(binDir),
    });

    const state = readJson(stateFile);
    const backlog = readJson(path.join(repoDir, ".helloloop", "backlog.json"));

    assert.equal(result.status, 0, result.stderr);
    assert.equal(state.analysis, 3);
    assert.equal(state.execute, 2);
    assert.equal(state.review, 2);
    assert.equal(backlog.tasks.length, 0);
    assert.match(result.stdout, /主线终态复核发现仍有剩余工作/);
    assert.match(result.stdout, /主线终态复核通过/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

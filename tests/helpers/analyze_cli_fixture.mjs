import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const npmBinEntry = path.join(repoRoot, "bin", "helloloop.js");

export function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

export function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function createFakeCodex(binDir, payload) {
  const stubFile = path.join(binDir, "codex-stub.cjs");
  writeText(stubFile, `
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
function buildReviewPayload(sourcePayload) {
  const task = Array.isArray(sourcePayload?.tasks) && sourcePayload.tasks[0]
    ? sourcePayload.tasks[0]
    : { title: "当前任务", acceptance: ["任务已完成"] };
  const acceptance = Array.isArray(task.acceptance) && task.acceptance.length
    ? task.acceptance
    : ["任务已完成"];
  return {
    verdict: "complete",
    summary: task.title + "已真正完成。",
    acceptanceChecks: acceptance.map((item) => ({
      item,
      status: "met",
      evidence: "仓库内已有对应实现，且验证通过。",
    })),
    missing: [],
    blockerReason: "",
    nextAction: "继续主线下一任务。",
  };
}
if (args.includes("--version")) {
  process.stdout.write("codex 0.117.0\\n");
  process.exit(0);
}
const outputIndex = args.indexOf("-o");
if (outputIndex >= 0 && args[outputIndex + 1]) {
  fs.mkdirSync(path.dirname(args[outputIndex + 1]), { recursive: true });
  const schemaIndex = args.indexOf("--output-schema");
  const schemaName = schemaIndex >= 0 && args[schemaIndex + 1]
    ? path.basename(args[schemaIndex + 1])
    : "";
  const isAnalyze = schemaIndex >= 0;
  fs.writeFileSync(
    args[outputIndex + 1],
    !isAnalyze
      ? "任务执行完成"
      : JSON.stringify(
        schemaName === "task-review-output.schema.json"
          ? buildReviewPayload(${JSON.stringify(payload)})
          : ${JSON.stringify(payload)}
      ),
    "utf8"
  );
}
process.stdout.write(args.includes("--output-schema") ? "analysis ok\\n" : "exec ok\\n");
`);

  if (process.platform === "win32") {
    writeText(path.join(binDir, "codex.ps1"), "node \"$PSScriptRoot/codex-stub.cjs\" @args\r\nexit $LASTEXITCODE\r\n");
    writeText(path.join(binDir, "claude.ps1"), "Write-Error 'claude unavailable in test' ; exit 1\r\n");
    writeText(path.join(binDir, "gemini.ps1"), "Write-Error 'gemini unavailable in test' ; exit 1\r\n");
    return;
  }

  writeText(path.join(binDir, "codex"), "#!/usr/bin/env sh\nnode \"$(dirname \"$0\")/codex-stub.cjs\" \"$@\"\n");
  fs.chmodSync(path.join(binDir, "codex"), 0o755);
  writeText(path.join(binDir, "claude"), "#!/usr/bin/env sh\necho claude unavailable in test >&2\nexit 1\n");
  fs.chmodSync(path.join(binDir, "claude"), 0o755);
  writeText(path.join(binDir, "gemini"), "#!/usr/bin/env sh\necho gemini unavailable in test >&2\nexit 1\n");
  fs.chmodSync(path.join(binDir, "gemini"), 0o755);
}

export function createSequencedFakeCodex(binDir, payloads) {
  const stubFile = path.join(binDir, "codex-stub.cjs");
  const payloadFile = path.join(binDir, "payloads.json");
  const stateFile = path.join(binDir, "payload-index.txt");
  writeText(payloadFile, JSON.stringify(payloads));
  writeText(stateFile, "0");
  writeText(stubFile, `
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
function buildReviewPayload(sourcePayload) {
  const task = Array.isArray(sourcePayload?.tasks) && sourcePayload.tasks[0]
    ? sourcePayload.tasks[0]
    : { title: "当前任务", acceptance: ["任务已完成"] };
  const acceptance = Array.isArray(task.acceptance) && task.acceptance.length
    ? task.acceptance
    : ["任务已完成"];
  return {
    verdict: "complete",
    summary: task.title + "已真正完成。",
    acceptanceChecks: acceptance.map((item) => ({
      item,
      status: "met",
      evidence: "仓库内已有对应实现，且验证通过。",
    })),
    missing: [],
    blockerReason: "",
    nextAction: "继续主线下一任务。",
  };
}
if (args.includes("--version")) {
  process.stdout.write("codex 0.117.0\\n");
  process.exit(0);
}
const outputIndex = args.indexOf("-o");
if (outputIndex >= 0 && args[outputIndex + 1]) {
  fs.mkdirSync(path.dirname(args[outputIndex + 1]), { recursive: true });
  const schemaIndex = args.indexOf("--output-schema");
  const schemaName = schemaIndex >= 0 && args[schemaIndex + 1]
    ? path.basename(args[schemaIndex + 1])
    : "";
  const isAnalyze = schemaIndex >= 0;
  if (isAnalyze) {
    const payloads = JSON.parse(fs.readFileSync(${JSON.stringify(payloadFile)}, "utf8"));
    const currentIndex = Number(fs.readFileSync(${JSON.stringify(stateFile)}, "utf8")) || 0;
    const payload = payloads[Math.min(currentIndex, payloads.length - 1)];
    if (schemaName === "task-review-output.schema.json") {
      fs.writeFileSync(args[outputIndex + 1], JSON.stringify(buildReviewPayload(payload)), "utf8");
    } else {
      fs.writeFileSync(${JSON.stringify(stateFile)}, String(currentIndex + 1), "utf8");
      fs.writeFileSync(args[outputIndex + 1], JSON.stringify(payload), "utf8");
    }
  } else {
    fs.writeFileSync(args[outputIndex + 1], "任务执行完成", "utf8");
  }
}
process.stdout.write(args.includes("--output-schema") ? "analysis ok\\n" : "exec ok\\n");
`);

  if (process.platform === "win32") {
    writeText(path.join(binDir, "codex.ps1"), "node \"$PSScriptRoot/codex-stub.cjs\" @args\r\nexit $LASTEXITCODE\r\n");
    writeText(path.join(binDir, "claude.ps1"), "Write-Error 'claude unavailable in test' ; exit 1\r\n");
    writeText(path.join(binDir, "gemini.ps1"), "Write-Error 'gemini unavailable in test' ; exit 1\r\n");
    return;
  }

  writeText(path.join(binDir, "codex"), "#!/usr/bin/env sh\nnode \"$(dirname \"$0\")/codex-stub.cjs\" \"$@\"\n");
  fs.chmodSync(path.join(binDir, "codex"), 0o755);
  writeText(path.join(binDir, "claude"), "#!/usr/bin/env sh\necho claude unavailable in test >&2\nexit 1\n");
  fs.chmodSync(path.join(binDir, "claude"), 0o755);
  writeText(path.join(binDir, "gemini"), "#!/usr/bin/env sh\necho gemini unavailable in test >&2\nexit 1\n");
  fs.chmodSync(path.join(binDir, "gemini"), 0o755);
}

export function spawnHelloLoop(args, options = {}) {
  return spawnSync("node", [npmBinEntry, ...args], {
    cwd: options.cwd || repoRoot,
    encoding: "utf8",
    env: options.env || process.env,
    input: options.input,
  });
}

function cliExecutable(binDir, commandName) {
  return path.join(binDir, process.platform === "win32" ? `${commandName}.ps1` : commandName);
}

export function buildCliEnv(binDir, extra = {}) {
  return {
    ...process.env,
    PATH: [binDir, process.env.PATH || ""].join(path.delimiter),
    HELLOLOOP_CODEX_EXECUTABLE: cliExecutable(binDir, "codex"),
    HELLOLOOP_CLAUDE_EXECUTABLE: cliExecutable(binDir, "claude"),
    HELLOLOOP_GEMINI_EXECUTABLE: cliExecutable(binDir, "gemini"),
    HELLOLOOP_SETTINGS_FILE: path.join(binDir, "settings.json"),
    ...extra,
  };
}

export function sampleAnalysisPayload(overrides = {}) {
  return {
    project: "demo-project",
    summary: {
      currentState: "已完成基础骨架，剩余主流程未收口。",
      implemented: ["项目目录与基础入口已存在"],
      remaining: ["主业务流程未完成", "验证链路未补齐"],
      nextAction: "先实现主业务流程并补上验证。",
    },
    constraints: ["严格按开发文档推进。"],
    tasks: [
      {
        id: "finish-main-flow",
        title: "实现主业务流程",
        status: "pending",
        priority: "P1",
        risk: "low",
        goal: "根据开发文档补齐主业务流程。",
        docs: ["docs"],
        paths: ["src/"],
        acceptance: ["主业务流程可运行", "关键路径通过验证"],
        dependsOn: [],
        verify: ["node --version"],
      },
    ],
    ...overrides,
  };
}

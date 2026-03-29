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

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function spawnHelloLoop(args, options = {}) {
  return spawnSync("node", [npmBinEntry, ...args], {
    cwd: options.cwd || repoRoot,
    encoding: "utf8",
    env: options.env || process.env,
    input: options.input,
  });
}

export function cliExecutable(binDir, commandName) {
  return path.join(binDir, process.platform === "win32" ? `${commandName}.ps1` : commandName);
}

export function buildCliEnv(binDir, extra = {}) {
  return {
    ...process.env,
    PATH: [binDir, process.env.PATH || ""].join(path.delimiter),
    HELLOLOOP_CODEX_EXECUTABLE: cliExecutable(binDir, "codex"),
    HELLOLOOP_CLAUDE_EXECUTABLE: cliExecutable(binDir, "claude"),
    HELLOLOOP_GEMINI_EXECUTABLE: cliExecutable(binDir, "gemini"),
    HELLOLOOP_USER_SETTINGS_FILE: path.join(binDir, "user-settings.json"),
    ...extra,
  };
}

export function createUnavailableCli(binDir, commandName) {
  if (process.platform === "win32") {
    writeText(path.join(binDir, `${commandName}.ps1`), `Write-Error '${commandName} unavailable in test' ; exit 1\r\n`);
    return;
  }

  writeText(path.join(binDir, commandName), `#!/usr/bin/env sh\necho ${commandName} unavailable in test >&2\nexit 1\n`);
  fs.chmodSync(path.join(binDir, commandName), 0o755);
}

export function createSequencedAgentCli(binDir, commandName, config) {
  const configFile = path.join(binDir, `${commandName}-config.json`);
  const stateFile = path.join(binDir, `${commandName}-state.json`);
  writeJson(configFile, config);
  writeJson(stateFile, { analyze: 0, execute: 0 });

  writeText(path.join(binDir, `${commandName}-stub.cjs`), `
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(${JSON.stringify(configFile)}, "utf8"));
const state = JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}, "utf8"));

function saveState(nextState) {
  fs.writeFileSync(${JSON.stringify(stateFile)}, JSON.stringify(nextState), "utf8");
}

function phaseForCommand() {
  if (${JSON.stringify(commandName)} === "codex") {
    return args.includes("--output-schema") ? "analyze" : "execute";
  }
  if (${JSON.stringify(commandName)} === "claude") {
    const modeIndex = args.indexOf("--permission-mode");
    const permissionMode = modeIndex >= 0 ? args[modeIndex + 1] : "";
    return permissionMode === "plan" ? "analyze" : "execute";
  }
  const modeIndex = args.indexOf("--approval-mode");
  const approvalMode = modeIndex >= 0 ? args[modeIndex + 1] : "";
  return approvalMode === "plan" ? "analyze" : "execute";
}

function pickSequence(items, count) {
  if (!Array.isArray(items) || !items.length) {
    return {};
  }
  return items[Math.min(count - 1, items.length - 1)] || {};
}

if (args.includes("--version")) {
  process.stdout.write(config.versionText || (${JSON.stringify(commandName)} + " test-version\\n"));
  process.exit(0);
}

const phase = phaseForCommand();
state[phase] = Number(state[phase] || 0) + 1;
saveState(state);

const entry = pickSequence(config[phase + "Sequence"], state[phase]);
if (entry.fail) {
  process.stderr.write(entry.errorText || "temporary failure\\n");
  process.exit(entry.code || 1);
}

if (${JSON.stringify(commandName)} === "codex") {
  const outputIndex = args.indexOf("-o");
  if (outputIndex >= 0 && args[outputIndex + 1]) {
    fs.mkdirSync(path.dirname(args[outputIndex + 1]), { recursive: true });
    const content = phase === "analyze"
      ? JSON.stringify(entry.payload || {})
      : String(entry.finalMessage || "任务执行完成");
    fs.writeFileSync(args[outputIndex + 1], content, "utf8");
  }
  process.stdout.write(entry.stdoutText || (phase === "analyze" ? "analysis ok\\n" : "exec ok\\n"));
  process.exit(0);
}

if (phase === "analyze") {
  process.stdout.write(JSON.stringify(entry.payload || {}));
  process.exit(0);
}

process.stdout.write(String(entry.finalMessage || "任务执行完成"));
`);

  if (process.platform === "win32") {
    writeText(path.join(binDir, `${commandName}.ps1`), `node "$PSScriptRoot/${commandName}-stub.cjs" @args\r\nexit $LASTEXITCODE\r\n`);
    return stateFile;
  }

  writeText(path.join(binDir, commandName), `#!/usr/bin/env sh\nnode "$(dirname "$0")/${commandName}-stub.cjs" "$@"\n`);
  fs.chmodSync(path.join(binDir, commandName), 0o755);
  return stateFile;
}

export function sampleTask(id, title) {
  return {
    id,
    title,
    status: "pending",
    priority: "P1",
    risk: "low",
    goal: `${title}，并满足验收条件。`,
    docs: ["docs"],
    paths: ["src/"],
    acceptance: [`${title}的关键能力已完成`, `${title}相关验证通过`],
    verify: ["node --version"],
  };
}

export function sampleAnalysisPayload(tasks, overrides = {}) {
  return {
    project: "demo-project",
    summary: {
      currentState: tasks.length ? "仍有主线任务待完成。" : "开发文档目标已完成。",
      implemented: tasks.length ? ["基础骨架已存在"] : ["开发文档目标已全部闭合"],
      remaining: tasks.map((item) => item.title),
      nextAction: tasks.length ? `继续执行：${tasks[0].title}` : "无需继续开发。",
    },
    constraints: ["严格按开发文档推进。"],
    tasks,
    ...overrides,
  };
}

export function sampleReviewPayload(title, verdict = "complete") {
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
        evidence: complete ? "相关验证命令已通过。" : "当前证据不足。",
      },
    ],
    missing: complete ? [] : [`${title}仍有缺口`],
    blockerReason: "",
    nextAction: complete ? "继续主线下一任务。" : `继续收口 ${title}。`,
  };
}

export function createDemoRepo(tempRoot) {
  const tempRepo = path.join(tempRoot, "demo-project");
  writeText(path.join(tempRepo, "docs", "plan.md"), "# 开发计划\n- 完成主业务流程\n");
  writeText(path.join(tempRepo, "src", "index.js"), "console.log('hello');\n");
  writeText(path.join(tempRepo, ".helloagents", "verify.yaml"), "commands:\n  - node --version\n");
  return tempRepo;
}

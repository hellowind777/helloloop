import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

export function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function createAgentCli(binDir, commandName, config) {
  const configFile = path.join(binDir, `${commandName}-config.json`);
  const stateFile = path.join(binDir, `${commandName}-state.json`);
  writeJson(configFile, config);
  writeJson(stateFile, {});

  const stubFile = path.join(binDir, `${commandName}-stub.cjs`);
  writeText(stubFile, `
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const stdin = fs.readFileSync(0, "utf8");
const config = JSON.parse(fs.readFileSync(${JSON.stringify(configFile)}, "utf8"));
const state = JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}, "utf8"));

function saveState(nextState) {
  fs.writeFileSync(${JSON.stringify(stateFile)}, JSON.stringify(nextState), "utf8");
}

function phaseForCommand() {
  if (stdin.includes("HELLOLOOP_ENGINE_HEALTH_PROBE")) {
    return "probe";
  }
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

if (args.includes("--version")) {
  process.stdout.write(config.versionText || (${JSON.stringify(commandName)} + " test-version\\n"));
  process.exit(0);
}

const phase = phaseForCommand();
const phaseConfig = config[phase] || {};
const runCount = Number(state[phase] || 0);
state[phase] = runCount + 1;
saveState(state);

if (phaseConfig.failOnce && runCount === 0) {
  process.stderr.write(phaseConfig.errorText || "temporary failure\\n");
  process.exit(1);
}
if (phaseConfig.failAlways) {
  process.stderr.write(phaseConfig.errorText || "permanent failure\\n");
  process.exit(1);
}

if (${JSON.stringify(commandName)} === "codex") {
  const outputIndex = args.indexOf("-o");
  if (outputIndex >= 0 && args[outputIndex + 1]) {
    fs.mkdirSync(path.dirname(args[outputIndex + 1]), { recursive: true });
    const content = phase === "analyze"
      ? JSON.stringify(phaseConfig.payload || {})
      : String(phaseConfig.finalMessage || (phase === "probe" ? "HELLOLOOP_ENGINE_OK" : "任务执行完成"));
    fs.writeFileSync(args[outputIndex + 1], content, "utf8");
  }
  process.stdout.write(phaseConfig.stdoutText || (phase === "analyze" ? "analysis ok\\n" : (phase === "probe" ? "probe ok\\n" : "exec ok\\n")));
  process.exit(0);
}

const finalText = phase === "analyze"
  ? JSON.stringify(phaseConfig.payload || {})
  : String(phaseConfig.finalMessage || (phase === "probe" ? "HELLOLOOP_ENGINE_OK" : "任务执行完成"));
process.stdout.write(finalText);
`);

  if (process.platform === "win32") {
    writeText(path.join(binDir, `${commandName}.ps1`), `node "$PSScriptRoot/${commandName}-stub.cjs" @args\r\nexit $LASTEXITCODE\r\n`);
    return;
  }

  const shellFile = path.join(binDir, commandName);
  writeText(shellFile, `#!/usr/bin/env sh\nnode "$(dirname "$0")/${commandName}-stub.cjs" "$@"\n`);
  fs.chmodSync(shellFile, 0o755);
}

export function createUnavailableCli(binDir, commandName) {
  if (process.platform === "win32") {
    writeText(path.join(binDir, `${commandName}.ps1`), `Write-Error '${commandName} unavailable in test' ; exit 1\r\n`);
    return;
  }

  const shellFile = path.join(binDir, commandName);
  writeText(shellFile, `#!/usr/bin/env sh\necho ${commandName} unavailable in test >&2\nexit 1\n`);
  fs.chmodSync(shellFile, 0o755);
}

export function spawnHelloLoop(npmBinEntry, args, options = {}) {
  return spawnSync("node", [npmBinEntry, ...args], {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env || process.env,
    input: options.input,
  });
}

export function cliExecutable(binDir, commandName) {
  return path.join(binDir, process.platform === "win32" ? `${commandName}.ps1` : commandName);
}

export function buildCliEnv(binDir, extra = {}) {
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

export function sampleAnalysisPayload() {
  return {
    project: "demo-project",
    summary: {
      currentState: "已完成基础骨架，剩余主流程未收口。",
      implemented: [
        "项目目录与基础入口已存在",
      ],
      remaining: [
        "主业务流程未完成",
      ],
      nextAction: "继续完成剩余开发。",
    },
    constraints: [
      "严格按开发文档推进。",
    ],
    tasks: [
      {
        id: "finish-main-flow",
        title: "实现主业务流程",
        status: "pending",
        priority: "P1",
        risk: "low",
        goal: "补齐主业务流程。",
        docs: [
          "docs",
        ],
        paths: [
          "src/",
        ],
        acceptance: [
          "主业务流程可运行",
        ],
        dependsOn: [],
        verify: [
          "node --version",
        ],
      },
    ],
  };
}

export function createDemoRepo(tempRoot) {
  const tempRepo = path.join(tempRoot, "demo-project");
  writeText(path.join(tempRepo, "docs", "plan.md"), "# 开发计划\n- 完成主业务流程\n");
  writeText(path.join(tempRepo, "src", "index.js"), "console.log('hello');\n");
  return tempRepo;
}

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

function createAgentCli(binDir, commandName, config) {
  const configFile = path.join(binDir, `${commandName}-config.json`);
  const stateFile = path.join(binDir, `${commandName}-state.json`);
  writeJson(configFile, config);
  writeJson(stateFile, {});

  const stubFile = path.join(binDir, `${commandName}-stub.cjs`);
  writeText(stubFile, `
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
      : String(phaseConfig.finalMessage || "任务执行完成");
    fs.writeFileSync(args[outputIndex + 1], content, "utf8");
  }
  process.stdout.write(phaseConfig.stdoutText || (phase === "analyze" ? "analysis ok\\n" : "exec ok\\n"));
  process.exit(0);
}

const finalText = phase === "analyze"
  ? JSON.stringify(phaseConfig.payload || {})
  : String(phaseConfig.finalMessage || "任务执行完成");
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

function createUnavailableCli(binDir, commandName) {
  if (process.platform === "win32") {
    writeText(path.join(binDir, `${commandName}.ps1`), `Write-Error '${commandName} unavailable in test' ; exit 1\r\n`);
    return;
  }

  const shellFile = path.join(binDir, commandName);
  writeText(shellFile, `#!/usr/bin/env sh\necho ${commandName} unavailable in test >&2\nexit 1\n`);
  fs.chmodSync(shellFile, 0o755);
}

function spawnHelloLoop(args, options = {}) {
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

function buildCliEnv(binDir, extra = {}) {
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

function sampleAnalysisPayload() {
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

function createDemoRepo(tempRoot) {
  const tempRepo = path.join(tempRoot, "demo-project");
  writeText(path.join(tempRepo, "docs", "plan.md"), "# 开发计划\n- 完成主业务流程\n");
  writeText(path.join(tempRepo, "src", "index.js"), "console.log('hello');\n");
  return tempRepo;
}

test("命令首参数写 claude 时会直接使用 Claude 引擎", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-engine-claude-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = createDemoRepo(tempRoot);

  createAgentCli(fakeBin, "claude", {
    versionText: "claude 2.1.87\n",
    analyze: {
      payload: sampleAnalysisPayload(),
    },
  });
  createUnavailableCli(fakeBin, "codex");
  createUnavailableCli(fakeBin, "gemini");

  const result = spawnHelloLoop(["claude"], {
    cwd: tempRepo,
    env: buildCliEnv(fakeBin),
    input: "n\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /执行引擎：/);
    assert.match(result.stdout, /本次引擎：Claude/);
    assert.match(result.stdout, /选择来源：命令首参数/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("自然语言里明确提到 gemini 时会按语义选择 Gemini 引擎", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-engine-gemini-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = createDemoRepo(tempRoot);

  createAgentCli(fakeBin, "gemini", {
    versionText: "gemini 0.36.0-preview.6\n",
    analyze: {
      payload: sampleAnalysisPayload(),
    },
  });
  createUnavailableCli(fakeBin, "codex");
  createUnavailableCli(fakeBin, "claude");

  const result = spawnHelloLoop(["please", "use", "gemini", "to", "continue"], {
    cwd: tempRepo,
    env: buildCliEnv(fakeBin),
    input: "n\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /本次引擎：Gemini/);
    assert.match(result.stdout, /选择来源：自然语言要求/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("多个可用引擎且未明确指定时会先询问用户选择", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-engine-prompt-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = createDemoRepo(tempRoot);

  createAgentCli(fakeBin, "codex", {
    versionText: "codex 0.117.0\n",
    analyze: {
      payload: sampleAnalysisPayload(),
    },
  });
  createAgentCli(fakeBin, "claude", {
    versionText: "claude 2.1.87\n",
    analyze: {
      payload: sampleAnalysisPayload(),
    },
  });
  createUnavailableCli(fakeBin, "gemini");

  const result = spawnHelloLoop([], {
    cwd: tempRepo,
    env: buildCliEnv(fakeBin),
    input: "2\nn\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /请选择本次要使用的执行引擎/);
    assert.match(result.stdout, /1\. Codex/);
    assert.match(result.stdout, /2\. Claude/);
    assert.match(result.stdout, /本次引擎：Claude/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("当前引擎在分析阶段遇到限流时会提示切换到其他可用引擎", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-engine-fallback-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = createDemoRepo(tempRoot);

  createAgentCli(fakeBin, "codex", {
    versionText: "codex 0.117.0\n",
    analyze: {
      failAlways: true,
      errorText: "429 rate limit exceeded\n",
    },
  });
  createAgentCli(fakeBin, "claude", {
    versionText: "claude 2.1.87\n",
    analyze: {
      payload: sampleAnalysisPayload(),
    },
  });
  createUnavailableCli(fakeBin, "gemini");

  const result = spawnHelloLoop(["codex"], {
    cwd: tempRepo,
    env: buildCliEnv(fakeBin),
    input: "1\nn\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Codex 本轮执行失败/);
    assert.match(result.stdout, /是否切换到其他可用引擎继续/);
    assert.match(result.stdout, /本次引擎：Claude/);
    assert.match(result.stdout, /选择来源：故障后交互切换/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("在 Codex 宿主内显式要求改用 Claude 时会先确认，不会静默切换", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-cross-host-confirm-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = createDemoRepo(tempRoot);

  createAgentCli(fakeBin, "claude", {
    versionText: "claude 2.1.87\n",
    analyze: {
      payload: sampleAnalysisPayload(),
    },
  });
  createAgentCli(fakeBin, "codex", {
    versionText: "codex 0.117.0\n",
    analyze: {
      payload: sampleAnalysisPayload(),
    },
  });
  createUnavailableCli(fakeBin, "gemini");

  const result = spawnHelloLoop(["--host-context", "codex", "claude"], {
    cwd: tempRepo,
    env: buildCliEnv(fakeBin),
    input: "y\nn\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /当前从 Codex 宿主发起，但本次将改用 Claude 执行/);
    assert.match(result.stdout, /本次引擎：Claude/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

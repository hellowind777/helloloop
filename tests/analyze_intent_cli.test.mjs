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

function createFakeCodex(binDir, payload) {
  const stubFile = path.join(binDir, "codex-stub.cjs");
  writeText(stubFile, `
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("codex 0.117.0\\n");
  process.exit(0);
}
const outputIndex = args.indexOf("-o");
if (outputIndex >= 0 && args[outputIndex + 1]) {
  fs.mkdirSync(path.dirname(args[outputIndex + 1]), { recursive: true });
  const isAnalyze = args.includes("--output-schema");
  fs.writeFileSync(
    args[outputIndex + 1],
    isAnalyze ? ${JSON.stringify(JSON.stringify(payload))} : "任务执行完成",
    "utf8"
  );
}
process.stdout.write(args.includes("--output-schema") ? "analysis ok\\n" : "exec ok\\n");
`);

  if (process.platform === "win32") {
    writeText(path.join(binDir, "codex.ps1"), `node "$PSScriptRoot/codex-stub.cjs" @args\r\nexit $LASTEXITCODE\r\n`);
    writeText(path.join(binDir, "claude.ps1"), "Write-Error 'claude unavailable in test' ; exit 1\r\n");
    writeText(path.join(binDir, "gemini.ps1"), "Write-Error 'gemini unavailable in test' ; exit 1\r\n");
    return;
  }

  const shellFile = path.join(binDir, "codex");
  writeText(shellFile, `#!/usr/bin/env sh\nnode "$(dirname "$0")/codex-stub.cjs" "$@"\n`);
  fs.chmodSync(shellFile, 0o755);
  writeText(path.join(binDir, "claude"), "#!/usr/bin/env sh\necho claude unavailable in test >&2\nexit 1\n");
  fs.chmodSync(path.join(binDir, "claude"), 0o755);
  writeText(path.join(binDir, "gemini"), "#!/usr/bin/env sh\necho gemini unavailable in test >&2\nexit 1\n");
  fs.chmodSync(path.join(binDir, "gemini"), 0o755);
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

function sampleAnalysisPayload(overrides = {}) {
  return {
    project: "demo-project",
    summary: {
      currentState: "已完成基础骨架，剩余主流程未收口。",
      implemented: [
        "项目目录与基础入口已存在",
      ],
      remaining: [
        "主业务流程未完成",
        "验证链路未补齐",
      ],
      nextAction: "先实现主业务流程并补上验证。",
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
        goal: "根据开发文档补齐主业务流程。",
        docs: [
          "docs",
        ],
        paths: [
          "src/",
        ],
        acceptance: [
          "主业务流程可运行",
          "关键路径通过验证",
        ],
        dependsOn: [],
        verify: [
          "node --version",
        ],
      },
    ],
    ...overrides,
  };
}

test("混合输入中的路径与英文需求会一起进入确认单，而不是依赖关键词触发", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-mixed-intent-"));
  const fakeBin = path.join(tempRoot, "bin");
  const docsRoot = path.join(tempRoot, "docs");
  const tempRepo = path.join(tempRoot, "demo-project");
  const requestText = "continue the remaining implementation with professional QA flow";

  createFakeCodex(fakeBin, sampleAnalysisPayload());
  writeText(path.join(docsRoot, "plan.md"), "# Plan\n- Finish remaining work\n");
  writeJson(path.join(tempRepo, "package.json"), { name: "demo-project" });
  writeText(path.join(tempRepo, "src", "index.js"), "console.log('demo');\n");

  const result = spawnHelloLoop([docsRoot, tempRepo, ...requestText.split(" ")], {
    env: buildCliEnv(fakeBin),
    input: "1\nn\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /本次命令补充输入/);
    assert.match(result.stdout, /开发文档：.*docs/);
    assert.match(result.stdout, /项目路径：.*demo-project/);
    assert.match(result.stdout, new RegExp(requestText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(result.stdout, /是否开始自动接续执行/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("只有自然语言补充要求时也会原样进入确认单，不依赖固定关键词", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-freeform-intent-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = path.join(tempRoot, "demo-project");
  const requestText = "please compare the codebase with the docs and continue carefully";

  createFakeCodex(fakeBin, sampleAnalysisPayload());
  writeText(path.join(tempRepo, "docs", "plan.md"), "# Plan\n- Finish remaining work\n");
  writeText(path.join(tempRepo, "src", "index.js"), "console.log('demo');\n");

  const result = spawnHelloLoop(requestText.split(" "), {
    cwd: tempRepo,
    env: buildCliEnv(fakeBin),
    input: "1\nn\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /本次命令补充输入/);
    assert.match(result.stdout, new RegExp(requestText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(result.stdout, /是否开始自动接续执行/);
    assert.doesNotMatch(result.stdout, /已按 --dry-run 跳过自动执行/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("分析结果中的需求语义理解会展示在确认单中", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-request-interpretation-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = path.join(tempRoot, "demo-project");
  const requestText = "please fix the drift first and then finish the remaining tasks with strict validation";

  createFakeCodex(fakeBin, sampleAnalysisPayload({
    requestInterpretation: {
      summary: "用户希望先修正偏差，再继续完成剩余开发，并且全过程保持严格验证。",
      priorities: [
        "先识别并收敛与开发文档的偏差",
        "后续任务继续覆盖剩余未完成内容",
      ],
      cautions: [
        "验证链路不能省略",
      ],
    },
  }));
  writeText(path.join(tempRepo, "docs", "plan.md"), "# Plan\n- Finish remaining work\n");
  writeText(path.join(tempRepo, "src", "index.js"), "console.log('demo');\n");

  const result = spawnHelloLoop(requestText.split(" "), {
    cwd: tempRepo,
    env: buildCliEnv(fakeBin),
    input: "1\nn\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /需求语义理解：/);
    assert.match(result.stdout, /先修正偏差，再继续完成剩余开发/);
    assert.match(result.stdout, /优先关注：先识别并收敛与开发文档的偏差/);
    assert.match(result.stdout, /特别注意：验证链路不能省略/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("冲突的多个项目路径会在分析前直接阻断并要求用户整理输入", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-repo-conflict-"));
  const docsRoot = path.join(tempRoot, "docs");
  const repoA = path.join(tempRoot, "project-alpha");
  const repoB = path.join(tempRoot, "project-beta");

  writeText(path.join(docsRoot, "plan.md"), "# Plan\n- Finish remaining work\n");
  writeJson(path.join(repoA, "package.json"), { name: "project-alpha" });
  writeText(path.join(repoA, "src", "index.js"), "console.log('alpha');\n");
  writeJson(path.join(repoB, "package.json"), { name: "project-beta" });
  writeText(path.join(repoB, "src", "index.js"), "console.log('beta');\n");

  const result = spawnHelloLoop([docsRoot, repoA, repoB, "继续完成后续开发"]);

  try {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /检测到命令输入存在冲突/);
    assert.match(result.stderr, /同时给出了多个项目路径/);
    assert.match(result.stderr, /--repo/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("确认单会展示路径判断来源和把握，而不是黑盒推断", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-resolution-display-"));
  const fakeBin = path.join(tempRoot, "bin");
  const docsRoot = path.join(tempRoot, "docs");
  const tempRepo = path.join(tempRoot, "project-alpha");

  createFakeCodex(fakeBin, sampleAnalysisPayload());
  writeText(path.join(docsRoot, "plan.md"), [
    "# Plan",
    `- 目标产物位于：${path.join(tempRepo, "src", "index.js").replaceAll("\\", "/")}`,
  ].join("\n"));
  writeJson(path.join(tempRepo, "package.json"), { name: "project-alpha" });
  writeText(path.join(tempRepo, "src", "index.js"), "console.log('alpha');\n");

  const result = spawnHelloLoop([docsRoot], {
    env: buildCliEnv(fakeBin),
    input: "1\nn\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /路径判断：/);
    assert.match(result.stdout, /文档来源：命令附带路径/);
    assert.match(result.stdout, /仓库来源：文档中的路径线索/);
    assert.match(result.stdout, /仓库把握：中/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("文档路径线索不会把带 package.json 的用户主目录误判成项目仓库", () => {
  const tempRoot = fs.mkdtempSync(path.join(path.dirname(repoRoot), "helloloop-home-hint-"));
  const fakeBin = path.join(tempRoot, "bin");
  const fakeHome = path.join(tempRoot, "user-home");
  const docsRoot = path.join(fakeHome, "AppData", "Local", "Temp", "resolution-case", "docs");
  const tempRepo = path.join(fakeHome, "AppData", "Local", "Temp", "resolution-case", "project-alpha");
  const fakeHomeDrive = path.parse(fakeHome).root.replace(/[\\/]+$/, "");
  const fakeHomePath = fakeHome.slice(path.parse(fakeHome).root.length - 1);

  createFakeCodex(fakeBin, sampleAnalysisPayload());
  writeJson(path.join(fakeHome, "package.json"), { name: "home-shell" });
  writeText(path.join(docsRoot, "plan.md"), [
    "# Plan",
    `- 目标产物位于：${path.join(tempRepo, "src", "index.js").replaceAll("\\", "/")}`,
  ].join("\n"));
  writeJson(path.join(tempRepo, "package.json"), { name: "project-alpha" });
  writeText(path.join(tempRepo, "src", "index.js"), "console.log('alpha');\n");

  const result = spawnHelloLoop([docsRoot], {
    env: buildCliEnv(fakeBin, {
      HOME: fakeHome,
      USERPROFILE: fakeHome,
      HOMEDRIVE: fakeHomeDrive,
      HOMEPATH: fakeHomePath,
    }),
    input: "1\nn\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /目标仓库：.*project-alpha/);
    assert.ok(!fs.existsSync(path.join(fakeHome, ".helloloop", "backlog.json")));
    assert.ok(fs.existsSync(path.join(tempRepo, ".helloloop", "backlog.json")));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

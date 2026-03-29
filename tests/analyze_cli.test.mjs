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
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("codex 0.117.0\\n");
  process.exit(0);
}
const outputIndex = args.indexOf("-o");
if (outputIndex >= 0 && args[outputIndex + 1]) {
  fs.mkdirSync(require("node:path").dirname(args[outputIndex + 1]), { recursive: true });
  fs.writeFileSync(args[outputIndex + 1], ${JSON.stringify(JSON.stringify(payload))}, "utf8");
}
process.stdout.write("analysis ok\\n");
`);

  if (process.platform === "win32") {
    writeText(path.join(binDir, "codex.ps1"), `node "$PSScriptRoot/codex-stub.cjs" @args\r\n`);
    return;
  }

  const shellFile = path.join(binDir, "codex");
  writeText(shellFile, `#!/usr/bin/env sh\nnode "$(dirname "$0")/codex-stub.cjs" "$@"\n`);
  fs.chmodSync(shellFile, 0o755);
}

function spawnHelloLoop(args, options = {}) {
  return spawnSync("node", [npmBinEntry, ...args], {
    cwd: options.cwd || repoRoot,
    encoding: "utf8",
    env: options.env || process.env,
  });
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
          "docs"
        ],
        paths: [
          "src/"
        ],
        acceptance: [
          "主业务流程可运行",
          "关键路径通过验证"
        ],
        dependsOn: [],
        verify: [
          "node --version"
        ]
      }
    ]
  };
}

test("零参数分析默认使用当前目录仓库与 docs 生成 backlog", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-analyze-default-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = path.join(tempRoot, "demo-project");

  createFakeCodex(fakeBin, sampleAnalysisPayload());
  writeText(path.join(tempRepo, "docs", "plan.md"), "# 开发计划\n- 完成主业务流程\n");
  writeText(path.join(tempRepo, "src", "index.js"), "console.log('hello');\n");

  const result = spawnHelloLoop([], {
    cwd: tempRepo,
    env: {
      ...process.env,
      PATH: [fakeBin, process.env.PATH || ""].join(path.delimiter),
    },
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /HelloLoop 已完成接续分析/);
    assert.match(result.stdout, /npx helloloop next/);

    const backlog = JSON.parse(fs.readFileSync(path.join(tempRepo, ".helloloop", "backlog.json"), "utf8"));
    const projectConfig = JSON.parse(fs.readFileSync(path.join(tempRepo, ".helloloop", "project.json"), "utf8"));

    assert.equal(backlog.project, "demo-project");
    assert.equal(backlog.tasks.length, 1);
    assert.deepEqual(projectConfig.requiredDocs, ["docs"]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("只给开发文档路径但无法确定项目仓库时会停下来提示补充仓库路径", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-missing-repo-"));
  const docsRoot = path.join(tempRoot, "docs-only");
  writeText(path.join(docsRoot, "plan.md"), "# 方案\n- 待开发\n");

  const result = spawnHelloLoop([docsRoot]);

  try {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /无法自动确定要开发的项目仓库路径/);
    assert.match(result.stderr, /--repo <PROJECT_ROOT>/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("只给项目路径但找不到 docs 时会停下来提示补充文档路径", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-missing-docs-"));
  const tempRepo = path.join(tempRoot, "demo-project");
  writeText(path.join(tempRepo, "src", "index.js"), "console.log('hello');\n");

  const result = spawnHelloLoop([tempRepo]);

  try {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /无法自动确定开发文档位置/);
    assert.match(result.stderr, /--docs <DOCS_PATH>/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("文档包含仓库名提示时可自动定位目标项目并生成 backlog", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-doc-repo-hint-"));
  const fakeBin = path.join(tempRoot, "bin");
  const docsRoot = path.join(tempRoot, "docs-bundle", "docs");
  const tempRepo = path.join(tempRoot, "project-alpha");

  createFakeCodex(fakeBin, sampleAnalysisPayload());
  writeText(path.join(docsRoot, "quick-start.md"), "# 快速开始\n- 目标仓库：`project-alpha`\n");
  writeText(path.join(tempRepo, "package.json"), "{ \"name\": \"project-alpha\" }\n");
  writeText(path.join(tempRepo, "src", "index.js"), "console.log('alpha');\n");

  const result = spawnHelloLoop([docsRoot], {
    env: {
      ...process.env,
      PATH: [fakeBin, process.env.PATH || ""].join(path.delimiter),
    },
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /HelloLoop 已完成接续分析/);
    assert.ok(fs.existsSync(path.join(tempRepo, ".helloloop", "backlog.json")));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

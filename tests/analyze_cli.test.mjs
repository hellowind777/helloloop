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
    writeText(path.join(binDir, "codex.ps1"), `node "$PSScriptRoot/codex-stub.cjs" @args\r\n`);
    return;
  }

  const shellFile = path.join(binDir, "codex");
  writeText(shellFile, `#!/usr/bin/env sh\nnode "$(dirname "$0")/codex-stub.cjs" "$@"\n`);
  fs.chmodSync(shellFile, 0o755);
}

function createSequencedFakeCodex(binDir, payloads) {
  const stubFile = path.join(binDir, "codex-stub.cjs");
  const payloadFile = path.join(binDir, "payloads.json");
  const stateFile = path.join(binDir, "payload-index.txt");
  writeText(payloadFile, JSON.stringify(payloads));
  writeText(stateFile, "0");
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
  if (isAnalyze) {
    const payloads = JSON.parse(fs.readFileSync(${JSON.stringify(payloadFile)}, "utf8"));
    const currentIndex = Number(fs.readFileSync(${JSON.stringify(stateFile)}, "utf8")) || 0;
    const payload = payloads[Math.min(currentIndex, payloads.length - 1)];
    fs.writeFileSync(${JSON.stringify(stateFile)}, String(currentIndex + 1), "utf8");
    fs.writeFileSync(args[outputIndex + 1], JSON.stringify(payload), "utf8");
  } else {
    fs.writeFileSync(args[outputIndex + 1], "任务执行完成", "utf8");
  }
}
process.stdout.write(args.includes("--output-schema") ? "analysis ok\\n" : "exec ok\\n");
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
    input: options.input,
  });
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
    ],
    ...overrides
  };
}

test("零参数默认先展示确认单，拒绝后只保留分析结果不自动执行", () => {
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
    input: "n\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /执行确认单/);
    assert.match(result.stdout, /是否开始自动接续执行/);
    assert.match(result.stdout, /已取消自动执行/);

    const backlog = JSON.parse(fs.readFileSync(path.join(tempRepo, ".helloloop", "backlog.json"), "utf8"));
    const projectConfig = JSON.parse(fs.readFileSync(path.join(tempRepo, ".helloloop", "project.json"), "utf8"));

    assert.equal(backlog.project, "demo-project");
    assert.equal(backlog.tasks.length, 1);
    assert.equal(backlog.tasks[0].status, "pending");
    assert.deepEqual(projectConfig.requiredDocs, ["docs"]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("零参数默认在确认后会自动继续执行直到当前任务完成", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-auto-run-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = path.join(tempRoot, "demo-project");

  createFakeCodex(fakeBin, sampleAnalysisPayload());
  writeText(path.join(tempRepo, "docs", "plan.md"), "# 开发计划\n- 完成主业务流程\n");
  writeText(path.join(tempRepo, "src", "index.js"), "console.log('hello');\n");
  writeText(path.join(tempRepo, ".helloagents", "verify.yaml"), "commands:\n  - node --version\n");

  const result = spawnHelloLoop([], {
    cwd: tempRepo,
    env: {
      ...process.env,
      PATH: [fakeBin, process.env.PATH || ""].join(path.delimiter),
    },
    input: "y\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /执行确认单/);
    assert.match(result.stdout, /开始自动接续执行/);
    assert.match(result.stdout, /完成任务：实现主业务流程/);

    const backlog = JSON.parse(fs.readFileSync(path.join(tempRepo, ".helloloop", "backlog.json"), "utf8"));
    assert.equal(backlog.tasks[0].status, "done");
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

test("只给开发文档路径时也会先展示确认单再等待用户决定", () => {
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
    input: "n\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /执行确认单/);
    assert.match(result.stdout, /project-alpha/);
    assert.ok(fs.existsSync(path.join(tempRepo, ".helloloop", "backlog.json")));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("工作区根目录会先提示选择顶层项目，而不是把深层依赖目录当成候选仓库", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-workspace-select-"));
  const fakeBin = path.join(tempRoot, "bin");
  const alphaRepo = path.join(tempRoot, "alpha-project");
  const betaRepo = path.join(tempRoot, "beta-project");
  const noisyPackage = path.join(
    alphaRepo,
    "dist",
    "bundle",
    "node_modules",
    "boolean",
  );

  createFakeCodex(fakeBin, sampleAnalysisPayload());
  writeText(path.join(tempRoot, "ProjectWiki.md"), [
    "# 开发文档",
    `- 参考打包路径：${path.join(noisyPackage, "index.js").replaceAll("\\", "/")}`,
    "- 当前要接续的仓库请选择顶层项目目录。",
  ].join("\n"));
  writeJson(path.join(alphaRepo, "package.json"), { name: "alpha-project" });
  writeText(path.join(alphaRepo, "src", "index.js"), "console.log('alpha');\n");
  writeJson(path.join(betaRepo, "package.json"), { name: "beta-project" });
  writeText(path.join(betaRepo, "src", "index.js"), "console.log('beta');\n");
  writeJson(path.join(noisyPackage, "package.json"), { name: "boolean" });
  writeText(path.join(noisyPackage, "index.js"), "module.exports = true;\n");

  const result = spawnHelloLoop([], {
    cwd: tempRoot,
    env: {
      ...process.env,
      PATH: [fakeBin, process.env.PATH || ""].join(path.delimiter),
    },
    input: "2\nn\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /请选择目标项目仓库/);
    assert.match(result.stdout, /1\. .*alpha-project/);
    assert.match(result.stdout, /2\. .*beta-project/);
    assert.doesNotMatch(result.stdout, /node_modules\/boolean/);
    assert.doesNotMatch(result.stdout, /候选项目：[\s\S]*boolean/);
    assert.match(result.stdout, /目标仓库：.*beta-project/);
    assert.ok(fs.existsSync(path.join(betaRepo, ".helloloop", "backlog.json")));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("工作区没有明确开发文档时会先展示顶层目录并要求输入开发文档路径", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-workspace-docs-first-"));
  const fakeBin = path.join(tempRoot, "bin");
  const plansRoot = path.join(tempRoot, "plans");
  const alphaRepo = path.join(tempRoot, "alpha-project");
  const betaRepo = path.join(tempRoot, "beta-project");

  createFakeCodex(fakeBin, sampleAnalysisPayload());
  writeText(path.join(plansRoot, "plan.md"), "# 开发计划\n- 先补齐主流程\n");
  writeJson(path.join(alphaRepo, "package.json"), { name: "alpha-project" });
  writeText(path.join(alphaRepo, "src", "index.js"), "console.log('alpha');\n");
  writeJson(path.join(betaRepo, "package.json"), { name: "beta-project" });
  writeText(path.join(betaRepo, "src", "index.js"), "console.log('beta');\n");

  const result = spawnHelloLoop([], {
    cwd: tempRoot,
    env: {
      ...process.env,
      PATH: [fakeBin, process.env.PATH || ""].join(path.delimiter),
    },
    input: `${plansRoot}\n2\nn\n`,
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /当前目录顶层概览/);
    assert.match(result.stdout, /顶层目录：/);
    assert.match(result.stdout, /请输入开发文档目录或文件路径/);
    assert.match(result.stdout, /请选择目标项目仓库/);
    assert.match(result.stdout, /目标仓库：.*beta-project/);
    assert.ok(fs.existsSync(path.join(betaRepo, ".helloloop", "backlog.json")));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("多个顶层文档文件时会先让用户选择开发文档而不是直接把根目录当文档源", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-multi-doc-files-"));
  const fakeBin = path.join(tempRoot, "bin");
  const alphaRepo = path.join(tempRoot, "alpha-project");
  const betaRepo = path.join(tempRoot, "beta-project");

  createFakeCodex(fakeBin, sampleAnalysisPayload());
  writeText(path.join(tempRoot, "ProjectWiki.md"), "# 项目概览\n- 待接续开发\n");
  writeText(path.join(tempRoot, "Roadmap.md"), "# 路线图\n- 下个阶段继续补齐\n");
  writeJson(path.join(alphaRepo, "package.json"), { name: "alpha-project" });
  writeText(path.join(alphaRepo, "src", "index.js"), "console.log('alpha');\n");
  writeJson(path.join(betaRepo, "package.json"), { name: "beta-project" });
  writeText(path.join(betaRepo, "src", "index.js"), "console.log('beta');\n");

  const result = spawnHelloLoop([], {
    cwd: tempRoot,
    env: {
      ...process.env,
      PATH: [fakeBin, process.env.PATH || ""].join(path.delimiter),
    },
    input: "1\n2\nn\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /请选择开发文档来源/);
    assert.match(result.stdout, /ProjectWiki\.md|Roadmap\.md/);
    assert.match(result.stdout, /请选择目标项目仓库/);
    assert.match(result.stdout, /目标仓库：.*beta-project/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("文档中的深层依赖路径会回溯到真实项目根目录", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-doc-path-hint-"));
  const fakeBin = path.join(tempRoot, "bin");
  const docsRoot = path.join(tempRoot, "docs");
  const projectRepo = path.join(tempRoot, "project-alpha");
  const noisyPackage = path.join(projectRepo, "target", "release", "node_modules", "@types", "node");

  createFakeCodex(fakeBin, sampleAnalysisPayload());
  writeText(path.join(docsRoot, "plan.md"), [
    "# 接续开发",
    `- 参考产物：${path.join(noisyPackage, "index.d.ts").replaceAll("\\", "/")}`,
    "- 按现有仓库继续完成后续开发。",
  ].join("\n"));
  writeJson(path.join(projectRepo, "package.json"), { name: "project-alpha" });
  writeText(path.join(projectRepo, "src", "index.js"), "console.log('alpha');\n");
  writeJson(path.join(noisyPackage, "package.json"), { name: "@types/node" });
  writeText(path.join(noisyPackage, "index.d.ts"), "export {};\n");

  const result = spawnHelloLoop([docsRoot], {
    env: {
      ...process.env,
      PATH: [fakeBin, process.env.PATH || ""].join(path.delimiter),
    },
    input: "n\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /执行确认单/);
    assert.match(result.stdout, /目标仓库：.*project-alpha/);
    assert.doesNotMatch(result.stdout, /@types\/node/);
    assert.ok(fs.existsSync(path.join(projectRepo, ".helloloop", "backlog.json")));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("无法推断现有项目时允许用户输入一个不存在的项目路径继续分析", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-new-project-path-"));
  const fakeBin = path.join(tempRoot, "bin");
  const plansRoot = path.join(tempRoot, "plans");
  const newRepo = path.join(tempRoot, "brand-new-app");

  createFakeCodex(fakeBin, sampleAnalysisPayload());
  writeText(path.join(plansRoot, "plan.md"), "# 新项目计划\n- 从零开始搭建\n");

  const result = spawnHelloLoop([], {
    cwd: tempRoot,
    env: {
      ...process.env,
      PATH: [fakeBin, process.env.PATH || ""].join(path.delimiter),
    },
    input: `${plansRoot}\n${newRepo}\nn\n`,
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /请输入开发文档目录或文件路径/);
    assert.match(result.stdout, /请输入要开发的项目路径/);
    assert.match(result.stdout, /已指定项目路径（当前不存在，将按新项目创建）/);
    assert.match(result.stdout, /目标仓库：.*brand-new-app/);
    assert.ok(fs.existsSync(path.join(newRepo, ".helloloop", "backlog.json")));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("--dry-run 只展示分析与确认信息，不提示确认也不自动执行", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-dry-run-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = path.join(tempRoot, "demo-project");

  createFakeCodex(fakeBin, sampleAnalysisPayload());
  writeText(path.join(tempRepo, "docs", "plan.md"), "# 开发计划\n- 完成主业务流程\n");
  writeText(path.join(tempRepo, "src", "index.js"), "console.log('hello');\n");

  const result = spawnHelloLoop(["--dry-run"], {
    cwd: tempRepo,
    env: {
      ...process.env,
      PATH: [fakeBin, process.env.PATH || ""].join(path.delimiter),
    },
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /执行确认单/);
    assert.match(result.stdout, /已按 --dry-run 跳过自动执行/);
    assert.doesNotMatch(result.stdout, /是否开始自动接续执行/);

    const backlog = JSON.parse(fs.readFileSync(path.join(tempRepo, ".helloloop", "backlog.json"), "utf8"));
    assert.equal(backlog.tasks[0].status, "pending");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("当前项目与开发文档冲突时，会先询问是否清理重建并在选择后重新分析", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-rebuild-conflict-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = path.join(tempRoot, "demo-project");

  createSequencedFakeCodex(fakeBin, [
    sampleAnalysisPayload({
      repoDecision: {
        compatibility: "conflict",
        action: "confirm_rebuild",
        reason: "当前仓库已有一套无关旧实现，更合理的路径是清理后按文档目标重新开始。",
      },
    }),
    sampleAnalysisPayload({
      summary: {
        currentState: "已按清理后的空仓库重新分析，准备从文档目标开始实施。",
        implemented: [],
        remaining: [
          "主业务流程未完成",
          "验证链路未补齐",
        ],
        nextAction: "从仓库骨架开始实施第一批任务。",
      },
      repoDecision: {
        compatibility: "compatible",
        action: "start_new",
        reason: "当前项目已按清理后的空目录重新开始，可直接按文档推进。",
      },
    }),
  ]);
  writeText(path.join(tempRepo, "docs", "plan.md"), "# 新项目计划\n- 从零搭建新的实现\n");
  writeJson(path.join(tempRepo, "package.json"), { name: "demo-project" });
  writeText(path.join(tempRepo, "src", "legacy.js"), "module.exports = 'legacy';\n");
  writeText(path.join(tempRepo, ".gitignore"), "node_modules/\n");

  const result = spawnHelloLoop([], {
    cwd: tempRepo,
    env: {
      ...process.env,
      PATH: [fakeBin, process.env.PATH || ""].join(path.delimiter),
    },
    input: "2\nn\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /项目匹配判断：/);
    assert.match(result.stdout, /明显冲突/);
    assert.match(result.stdout, /清理当前项目内容后按文档目标重新开始/);
    assert.match(result.stdout, /已按确认结果清理当前项目/);
    assert.match(result.stdout, /已保留开发文档：docs\/plan\.md/);
    assert.ok(!fs.existsSync(path.join(tempRepo, "src", "legacy.js")));
    assert.ok(fs.existsSync(path.join(tempRepo, "docs", "plan.md")));
    assert.ok(fs.existsSync(path.join(tempRepo, ".gitignore")));
    assert.ok(fs.existsSync(path.join(tempRepo, ".helloloop", "backlog.json")));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

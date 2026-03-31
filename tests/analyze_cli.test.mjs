import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildCliEnv,
  createFakeCodex,
  createSequencedFakeCodex,
  sampleAnalysisPayload,
  spawnHelloLoop,
  writeJson,
  writeText,
} from "./helpers/analyze_cli_fixture.mjs";
import {
  cleanupTempDir,
  waitForSupervisorCompletion,
  waitForTaskStatus,
} from "./helpers/supervisor_test_support.mjs";

test("零参数默认先展示确认单，拒绝后只保留分析结果不自动执行", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-analyze-default-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = path.join(tempRoot, "demo-project");

  createFakeCodex(fakeBin, sampleAnalysisPayload());
  writeText(path.join(tempRepo, "docs", "plan.md"), "# 开发计划\n- 完成主业务流程\n");
  writeText(path.join(tempRepo, "src", "index.js"), "console.log('hello');\n");

  const result = spawnHelloLoop([], {
    cwd: tempRepo,
    env: buildCliEnv(fakeBin),
    input: "1\nn\n",
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

test("零参数默认在确认后会自动切到后台执行并最终完成当前任务", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-auto-run-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = path.join(tempRoot, "demo-project");

  createFakeCodex(fakeBin, sampleAnalysisPayload());
  writeText(path.join(tempRepo, "docs", "plan.md"), "# 开发计划\n- 完成主业务流程\n");
  writeText(path.join(tempRepo, "src", "index.js"), "console.log('hello');\n");
  writeText(path.join(tempRepo, ".helloagents", "verify.yaml"), "commands:\n  - node --version\n");

  const result = spawnHelloLoop([], {
    cwd: tempRepo,
    env: buildCliEnv(fakeBin, {
      HELLOLOOP_HOST_LEASE_PID: String(process.pid),
      HELLOLOOP_HOST_LEASE_NAME: process.platform === "win32" ? "node.exe" : "node",
    }),
    input: "1\ny\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /执行确认单/);
    assert.match(result.stdout, /开始自动接续执行/);
    assert.match(result.stdout, /HelloLoop supervisor 已启动/);
    assert.match(result.stdout, /已切换为后台执行/);
    assert.doesNotMatch(result.stdout, /完成任务：实现主业务流程/);

    const waitOptions = { timeoutMs: 60000 };
    const backlog = await waitForTaskStatus(tempRepo, "done", 0, ".helloloop", waitOptions);
    await waitForSupervisorCompletion(tempRepo, ".helloloop", waitOptions);
    assert.equal(backlog.tasks[0].status, "done");
  } finally {
    await cleanupTempDir(tempRoot, path.join(tempRepo, ".helloloop", "supervisor", "state.json"));
  }
});

test("项目目录下只有一个顶层文档文件时会自动将其作为开发文档", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-single-root-doc-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = path.join(tempRoot, "demo-project");

  createFakeCodex(fakeBin, sampleAnalysisPayload());
  writeText(path.join(tempRepo, "README.md"), "# 开发说明\n- 完成主业务流程\n");
  writeText(path.join(tempRepo, "src", "index.js"), "console.log('hello');\n");

  const result = spawnHelloLoop([], {
    cwd: tempRepo,
    env: buildCliEnv(fakeBin),
    input: "1\nn\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /执行确认单/);
    assert.match(result.stdout, /开发文档：.*README\.md/);
    assert.doesNotMatch(result.stdout, /请输入开发文档路径（文件或目录）/);

    const projectConfig = JSON.parse(fs.readFileSync(path.join(tempRepo, ".helloloop", "project.json"), "utf8"));
    assert.deepEqual(projectConfig.requiredDocs, ["README.md"]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("只给开发文档路径时，若只发现一个候选项目目录会自动补全并继续分析", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-missing-repo-"));
  const fakeBin = path.join(tempRoot, "bin");
  const docsRoot = path.join(tempRoot, "docs-only");
  const tempRepo = path.join(tempRoot, "demo-project");

  createFakeCodex(fakeBin, sampleAnalysisPayload());
  writeText(path.join(docsRoot, "plan.md"), "# 方案\n- 待开发\n");
  writeText(path.join(tempRepo, "src", "index.js"), "console.log('hello');\n");

  const result = spawnHelloLoop([docsRoot], {
    cwd: docsRoot,
    env: buildCliEnv(fakeBin),
    input: "1\nn\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /项目目录：.*demo-project/);
    assert.doesNotMatch(result.stdout, /还需要确认项目目录|请选择要开发的项目目录/);
    assert.ok(fs.existsSync(path.join(tempRepo, ".helloloop", "backlog.json")));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("只给项目路径时会要求补充开发文档，并在输入后继续分析", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-missing-docs-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = path.join(tempRoot, "demo-project");
  const docsRoot = path.join(tempRoot, "plans");

  createFakeCodex(fakeBin, sampleAnalysisPayload());
  writeText(path.join(tempRepo, "src", "index.js"), "console.log('hello');\n");
  writeText(path.join(docsRoot, "plan.md"), "# 开发计划\n- 继续补齐主流程\n");

  const result = spawnHelloLoop([tempRepo], {
    env: buildCliEnv(fakeBin),
    input: `1\n${docsRoot}\nn\n`,
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /未找到开发文档/);
    assert.match(result.stdout, /项目目录：.*demo-project/);
    assert.match(result.stdout, /请输入开发文档路径（文件或目录）/);
    assert.match(result.stdout, /已选择开发文档：.*plans/);
    assert.ok(fs.existsSync(path.join(tempRepo, ".helloloop", "backlog.json")));
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
    cwd: docsRoot,
    env: buildCliEnv(fakeBin),
    input: "1\nn\n",
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

test("--dry-run 只展示分析与确认信息，不提示确认也不自动执行", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-dry-run-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = path.join(tempRoot, "demo-project");

  createFakeCodex(fakeBin, sampleAnalysisPayload());
  writeText(path.join(tempRepo, "docs", "plan.md"), "# 开发计划\n- 完成主业务流程\n");
  writeText(path.join(tempRepo, "src", "index.js"), "console.log('hello');\n");

  const result = spawnHelloLoop(["--dry-run"], {
    cwd: tempRepo,
    env: buildCliEnv(fakeBin),
    input: "1\n",
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
        remaining: ["主业务流程未完成", "验证链路未补齐"],
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
    env: buildCliEnv(fakeBin),
    input: "1\n2\nn\n",
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

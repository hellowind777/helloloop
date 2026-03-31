import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildCliEnv,
  createFakeCodex,
  sampleAnalysisPayload,
  spawnHelloLoop,
  writeJson,
  writeText,
} from "./helpers/analyze_cli_fixture.mjs";

test("工作区根目录会要求选择项目目录，而不是把深层依赖目录当成候选仓库", () => {
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
    env: buildCliEnv(fakeBin),
    input: "1\n2\nn\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /当前目录更像工作区，不能直接作为项目目录/);
    assert.match(result.stdout, /请选择要开发的项目目录/);
    assert.match(result.stdout, /1\. .*alpha-project/);
    assert.match(result.stdout, /2\. .*beta-project/);
    assert.doesNotMatch(result.stdout, /node_modules\/boolean/);
    assert.doesNotMatch(result.stdout, /候选项目：[\s\S]*boolean/);
    assert.match(result.stdout, /项目目录：.*beta-project/);
    assert.ok(fs.existsSync(path.join(betaRepo, ".helloloop", "backlog.json")));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("工作区没有明确开发文档时会先说明当前目录更像工作区，再要求输入开发文档路径", () => {
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
    env: buildCliEnv(fakeBin),
    input: `1\n${plansRoot}\n2\nn\n`,
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.ok(
      result.stdout.indexOf("请选择本次要使用的执行引擎")
        < result.stdout.indexOf("请输入开发文档路径（文件或目录）"),
      result.stdout,
    );
    assert.match(result.stdout, /当前目录更像工作区，暂时不直接作为项目目录/);
    assert.match(result.stdout, /请输入开发文档路径（文件或目录）/);
    assert.doesNotMatch(result.stdout, /当前目录顶层概览|顶层目录：|疑似项目目录：/);
    assert.match(result.stdout, /请选择要开发的项目目录/);
    assert.match(result.stdout, /项目目录：.*beta-project/);
    assert.ok(fs.existsSync(path.join(betaRepo, ".helloloop", "backlog.json")));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("用户主目录即使带 package.json 也不会被自动当作项目仓库", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-home-workspace-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempHome = path.join(tempRoot, "user-home");
  const plansRoot = path.join(tempHome, "plans");
  const alphaRepo = path.join(tempHome, "alpha-project");
  const betaRepo = path.join(tempHome, "beta-project");

  createFakeCodex(fakeBin, sampleAnalysisPayload());
  writeJson(path.join(tempHome, "package.json"), { name: "home-shell" });
  writeText(path.join(plansRoot, "plan.md"), "# 开发计划\n- 继续完成剩余开发\n");
  writeJson(path.join(alphaRepo, "package.json"), { name: "alpha-project" });
  writeText(path.join(alphaRepo, "src", "index.js"), "console.log('alpha');\n");
  writeJson(path.join(betaRepo, "package.json"), { name: "beta-project" });
  writeText(path.join(betaRepo, "src", "index.js"), "console.log('beta');\n");

  const result = spawnHelloLoop([], {
    cwd: tempHome,
    env: buildCliEnv(fakeBin, {
      HOME: tempHome,
      USERPROFILE: tempHome,
    }),
    input: `1\n${plansRoot}\n2\nn\n`,
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /当前目录更像工作区，暂时不直接作为项目目录/);
    assert.match(result.stdout, /请输入开发文档路径（文件或目录）/);
    assert.match(result.stdout, /请选择要开发的项目目录/);
    assert.match(result.stdout, /项目目录：.*beta-project/);
    assert.ok(!fs.existsSync(path.join(tempHome, ".helloloop", "backlog.json")));
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
    env: buildCliEnv(fakeBin),
    input: "1\n1\n2\nn\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /请选择开发文档/);
    assert.match(result.stdout, /ProjectWiki\.md|Roadmap\.md/);
    assert.match(result.stdout, /请选择要开发的项目目录/);
    assert.match(result.stdout, /项目目录：.*beta-project/);
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
    cwd: docsRoot,
    env: buildCliEnv(fakeBin),
    input: "1\nn\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /执行确认单/);
    assert.match(result.stdout, /项目目录：.*project-alpha/);
    assert.doesNotMatch(result.stdout, /@types\/node/);
    assert.ok(fs.existsSync(path.join(projectRepo, ".helloloop", "backlog.json")));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("只给开发文档时允许用户输入一个不存在的项目目录继续分析", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-new-project-path-"));
  const fakeBin = path.join(tempRoot, "bin");
  const plansRoot = path.join(tempRoot, "plans");
  const newRepo = path.join(tempRoot, "brand-new-app");

  createFakeCodex(fakeBin, sampleAnalysisPayload());
  writeText(path.join(plansRoot, "plan.md"), "# 新项目计划\n- 从零开始搭建\n");

  const result = spawnHelloLoop([plansRoot], {
    cwd: plansRoot,
    env: buildCliEnv(fakeBin),
    input: `1\n${newRepo}\nn\n`,
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /请输入要开发的项目目录/);
    assert.match(result.stdout, /已指定项目目录（当前不存在，将按新项目创建）/);
    assert.match(result.stdout, /项目目录：.*brand-new-app/);
    assert.ok(fs.existsSync(path.join(newRepo, ".helloloop", "backlog.json")));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("空目录会默认把当前目录作为项目目录，只补充开发文档", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-empty-dir-default-repo-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = path.join(tempRoot, "blank-project");
  const docsRoot = path.join(tempRoot, "docs-bundle");

  createFakeCodex(fakeBin, sampleAnalysisPayload());
  fs.mkdirSync(tempRepo, { recursive: true });
  writeText(path.join(docsRoot, "prd.md"), "# 需求\n- 继续完成剩余开发\n");

  const result = spawnHelloLoop([], {
    cwd: tempRepo,
    env: buildCliEnv(fakeBin),
    input: `1\n${docsRoot}\nn\n`,
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /未找到开发文档/);
    assert.match(result.stdout, /项目目录：.*blank-project/);
    assert.match(result.stdout, /请输入开发文档路径（文件或目录）/);
    assert.doesNotMatch(result.stdout, /请选择要开发的项目目录|还需要确认项目目录/);
    assert.ok(fs.existsSync(path.join(tempRepo, ".helloloop", "backlog.json")));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

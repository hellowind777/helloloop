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
const pluginEntry = path.join(repoRoot, "scripts", "helloloop.mjs");
const npmBinEntry = path.join(repoRoot, "bin", "helloloop.js");

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createFakeCodex(binDir) {
  if (process.platform === "win32") {
    writeText(path.join(binDir, "codex.ps1"), "Write-Output 'codex 0.117.0'\r\n");
    return;
  }

  writeText(path.join(binDir, "codex"), "#!/usr/bin/env sh\necho codex 0.117.0\n");
  fs.chmodSync(path.join(binDir, "codex"), 0o755);
}

function createFakeVersionCli(binDir, commandName, versionText) {
  if (process.platform === "win32") {
    writeText(path.join(binDir, `${commandName}.ps1`), `Write-Output '${versionText}'\r\n`);
    return;
  }

  writeText(path.join(binDir, commandName), `#!/usr/bin/env sh\necho ${versionText}\n`);
  fs.chmodSync(path.join(binDir, commandName), 0o755);
}

test("doctor 只检查纯插件模式前提，不再要求旧目录状态文件", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-cli-surface-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = path.join(tempRoot, "repo");

  createFakeCodex(fakeBin);
  writeJson(path.join(tempRepo, ".helloloop", "backlog.json"), {
    version: 1,
    project: "test-project",
    updatedAt: "2026-03-28T00:00:00.000Z",
    tasks: [],
  });
  writeJson(path.join(tempRepo, ".helloloop", "policy.json"), {
    version: 1,
    maxLoopTasks: 4,
    maxTaskAttempts: 2,
    maxTaskStrategies: 4,
    stopOnFailure: false,
  });
  writeJson(path.join(tempRepo, ".helloloop", "project.json"), {
    requiredDocs: [],
    constraints: [],
  });
  writeText(path.join(tempRepo, ".helloagents", "verify.yaml"), "commands:\n  - node --version\n");

  const result = spawnSync("node", [pluginEntry, "doctor", "--repo", tempRepo], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: [fakeBin, process.env.PATH || ""].join(path.delimiter),
    },
  });

  fs.rmSync(tempRoot, { recursive: true, force: true });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK  codex CLI/);
  assert.match(result.stdout, /OK  project\.json/);
  assert.match(result.stdout, /OK  plugin manifest/);
  assert.match(result.stdout, /OK  plugin skill/);
  assert.doesNotMatch(result.stdout, /hooks\.json/);
});

test("doctor 在插件源码仓库中默认只检查宿主与插件资产，不强制要求目标项目状态目录", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-cli-doctor-plugin-root-"));
  const fakeBin = path.join(tempRoot, "bin");
  const codexHome = path.join(tempRoot, "codex-home");

  createFakeCodex(fakeBin);

  const installResult = spawnSync("node", [
    npmBinEntry,
    "install",
    "--codex-home",
    codexHome,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(installResult.status, 0, installResult.stderr);

  const result = spawnSync("node", [
    pluginEntry,
    "doctor",
    "--codex-home",
    codexHome,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: [fakeBin, process.env.PATH || ""].join(path.delimiter),
    },
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /OK  codex CLI/);
    assert.match(result.stdout, /OK  plugin manifest/);
    assert.match(result.stdout, /OK  codex plugin source/);
    assert.match(result.stdout, /OK  codex installed plugin/);
    assert.match(result.stdout, /OK  codex plugin config/);
    assert.doesNotMatch(result.stdout, /FAIL  backlog\.json/);
    assert.doesNotMatch(result.stdout, /FAIL  project\.json/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("doctor --host all 会同时检查 Codex、Claude 和 Gemini 宿主条件", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-cli-doctor-all-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = path.join(tempRoot, "repo");
  const codexHome = path.join(tempRoot, "codex-home");
  const claudeHome = path.join(tempRoot, "claude-home");
  const geminiHome = path.join(tempRoot, "gemini-home");

  createFakeCodex(fakeBin);
  createFakeVersionCli(fakeBin, "claude", "claude 2.1.87");
  createFakeVersionCli(fakeBin, "gemini", "gemini 0.36.0-preview.6");

  writeJson(path.join(tempRepo, ".helloloop", "backlog.json"), {
    version: 1,
    project: "test-project",
    updatedAt: "2026-03-29T00:00:00.000Z",
    tasks: [],
  });
  writeJson(path.join(tempRepo, ".helloloop", "policy.json"), {
    version: 1,
    maxLoopTasks: 4,
    maxTaskAttempts: 2,
    maxTaskStrategies: 4,
    stopOnFailure: false,
  });
  writeJson(path.join(tempRepo, ".helloloop", "project.json"), {
    requiredDocs: [],
    constraints: [],
  });
  writeText(path.join(tempRepo, ".helloagents", "verify.yaml"), "commands:\n  - node --version\n");

  const installResult = spawnSync("node", [
    npmBinEntry,
    "install",
    "--host",
    "all",
    "--codex-home",
    codexHome,
    "--claude-home",
    claudeHome,
    "--gemini-home",
    geminiHome,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(installResult.status, 0, installResult.stderr);

  const result = spawnSync("node", [
    pluginEntry,
    "doctor",
    "--host",
    "all",
    "--repo",
    tempRepo,
    "--codex-home",
    codexHome,
    "--claude-home",
    claudeHome,
    "--gemini-home",
    geminiHome,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: [fakeBin, process.env.PATH || ""].join(path.delimiter),
    },
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /OK  codex CLI/);
    assert.match(result.stdout, /OK  codex plugin config/);
    assert.match(result.stdout, /OK  claude CLI/);
    assert.match(result.stdout, /OK  gemini CLI/);
    assert.match(result.stdout, /OK  claude marketplace registry/);
    assert.match(result.stdout, /OK  claude installed plugin index/);
    assert.match(result.stdout, /OK  claude installed plugin/);
    assert.match(result.stdout, /OK  gemini installed extension/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

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

  const executable = path.join(binDir, "codex");
  writeText(executable, "#!/usr/bin/env sh\necho codex 0.117.0\n");
  fs.chmodSync(executable, 0o755);
}

function createFakeVersionCli(binDir, commandName, versionText) {
  if (process.platform === "win32") {
    writeText(path.join(binDir, `${commandName}.ps1`), `Write-Output '${versionText}'\r\n`);
    return;
  }

  const executable = path.join(binDir, commandName);
  writeText(executable, `#!/usr/bin/env sh\necho ${versionText}\n`);
  fs.chmodSync(executable, 0o755);
}

test("官方插件入口 help 不再暴露 install-hooks 或 Hook 模式", () => {
  const result = spawnSync("node", [pluginEntry, "help"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /install/);
  assert.match(result.stdout, /run-loop/);
  assert.match(result.stdout, /doctor/);
  assert.doesNotMatch(result.stdout, /install-hooks/);
  assert.doesNotMatch(result.stdout, /Hook 模式/);
});

test("npm bin 入口支持 install 命令，把插件安装到指定 Codex Home", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-cli-install-"));

  const result = spawnSync("node", [npmBinEntry, "install", "--codex-home", tempHome], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /HelloLoop 已安装到/);
    assert.match(result.stdout, /npx helloloop next/);
    assert.ok(fs.existsSync(path.join(tempHome, "plugins", "helloloop", ".codex-plugin", "plugin.json")));
    assert.ok(fs.existsSync(path.join(tempHome, ".agents", "plugins", "marketplace.json")));
    assert.ok(!fs.existsSync(path.join(tempHome, "plugins", "helloloop", "docs")));
    assert.ok(!fs.existsSync(path.join(tempHome, "plugins", "helloloop", "tests")));
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test("install --host all 会同时安装 Codex、Claude 和 Gemini 宿主资产", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-cli-install-all-"));
  const codexHome = path.join(tempRoot, "codex-home");
  const claudeHome = path.join(tempRoot, "claude-home");
  const geminiHome = path.join(tempRoot, "gemini-home");

  const result = spawnSync("node", [
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

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Codex/);
    assert.match(result.stdout, /Claude/);
    assert.match(result.stdout, /Gemini/);

    assert.ok(fs.existsSync(path.join(codexHome, "plugins", "helloloop", ".codex-plugin", "plugin.json")));
    assert.ok(fs.existsSync(path.join(codexHome, ".agents", "plugins", "marketplace.json")));

    assert.ok(fs.existsSync(path.join(
      claudeHome,
      "marketplaces",
      "helloloop-local",
      ".claude-plugin",
      "marketplace.json",
    )));
    assert.ok(fs.existsSync(path.join(
      claudeHome,
      "marketplaces",
      "helloloop-local",
      "plugins",
      "helloloop",
      ".claude-plugin",
      "plugin.json",
    )));
    assert.ok(fs.existsSync(path.join(claudeHome, "settings.json")));

    const claudeSettings = JSON.parse(fs.readFileSync(path.join(claudeHome, "settings.json"), "utf8"));
    assert.equal(claudeSettings.enabledPlugins["helloloop@helloloop-local"], true);
    assert.equal(
      claudeSettings.extraKnownMarketplaces["helloloop-local"].source,
      "directory",
    );

    assert.ok(fs.existsSync(path.join(geminiHome, "extensions", "helloloop", "gemini-extension.json")));
    assert.ok(fs.existsSync(path.join(geminiHome, "extensions", "helloloop", "commands", "helloloop.toml")));
    assert.ok(fs.existsSync(path.join(geminiHome, "extensions", "helloloop", "GEMINI.md")));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

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
    assert.match(result.stdout, /OK  claude CLI/);
    assert.match(result.stdout, /OK  gemini CLI/);
    assert.match(result.stdout, /OK  claude installed plugin/);
    assert.match(result.stdout, /OK  gemini installed extension/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

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
const packageVersion = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
).version;

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
    assert.ok(fs.existsSync(path.join(
      tempHome,
      "plugins",
      "cache",
      "local-plugins",
      "helloloop",
      "local",
      ".codex-plugin",
      "plugin.json",
    )));
    assert.ok(fs.existsSync(path.join(tempHome, ".agents", "plugins", "marketplace.json")));
    assert.match(
      fs.readFileSync(path.join(tempHome, "config.toml"), "utf8"),
      /\[plugins\."helloloop@local-plugins"\]\s+enabled = true/,
    );
    assert.ok(!fs.existsSync(path.join(tempHome, "plugins", "helloloop", "docs")));
    assert.ok(!fs.existsSync(path.join(tempHome, "plugins", "helloloop", "tests")));
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test("install 在默认 .codex 目录结构下会把本地 marketplace 和源码目录写到 home 根", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-cli-default-codex-home-"));
  const codexHome = path.join(tempRoot, ".codex");

  const result = spawnSync("node", [npmBinEntry, "install", "--codex-home", codexHome], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(tempRoot, "plugins", "helloloop", ".codex-plugin", "plugin.json")));
    assert.ok(fs.existsSync(path.join(tempRoot, ".agents", "plugins", "marketplace.json")));
    assert.ok(fs.existsSync(path.join(
      codexHome,
      "plugins",
      "cache",
      "local-plugins",
      "helloloop",
      "local",
      ".codex-plugin",
      "plugin.json",
    )));
    assert.match(
      fs.readFileSync(path.join(codexHome, "config.toml"), "utf8"),
      /\[plugins\."helloloop@local-plugins"\]\s+enabled = true/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("uninstall 在默认 .codex 目录结构下会同时清理 home 根源码目录和 Codex 缓存配置", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-cli-default-codex-uninstall-"));
  const codexHome = path.join(tempRoot, ".codex");

  const installResult = spawnSync("node", [npmBinEntry, "install", "--codex-home", codexHome], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(installResult.status, 0, installResult.stderr);

  const result = spawnSync("node", [npmBinEntry, "uninstall", "--codex-home", codexHome], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!fs.existsSync(path.join(tempRoot, "plugins", "helloloop")));
    assert.ok(!fs.existsSync(path.join(
      codexHome,
      "plugins",
      "cache",
      "local-plugins",
      "helloloop",
    )));
    assert.doesNotMatch(
      fs.readFileSync(path.join(codexHome, "config.toml"), "utf8"),
      /\[plugins\."helloloop@local-plugins"\]/,
    );
    const codexMarketplace = JSON.parse(fs.readFileSync(path.join(tempRoot, ".agents", "plugins", "marketplace.json"), "utf8"));
    assert.equal(codexMarketplace.plugins.some((plugin) => plugin?.name === "helloloop"), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
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
    assert.ok(fs.existsSync(path.join(
      codexHome,
      "plugins",
      "cache",
      "local-plugins",
      "helloloop",
      "local",
      ".codex-plugin",
      "plugin.json",
    )));
    assert.ok(fs.existsSync(path.join(codexHome, ".agents", "plugins", "marketplace.json")));
    assert.match(
      fs.readFileSync(path.join(codexHome, "config.toml"), "utf8"),
      /\[plugins\."helloloop@local-plugins"\]\s+enabled = true/,
    );

    assert.ok(fs.existsSync(path.join(
      claudeHome,
      "plugins",
      "marketplaces",
      "helloloop-local",
      ".claude-plugin",
      "marketplace.json",
    )));
    assert.ok(fs.existsSync(path.join(
      claudeHome,
      "plugins",
      "cache",
      "helloloop-local",
      "helloloop",
      packageVersion,
      ".claude-plugin",
      "plugin.json",
    )));
    assert.ok(fs.existsSync(path.join(claudeHome, "settings.json")));
    assert.ok(fs.existsSync(path.join(claudeHome, "plugins", "known_marketplaces.json")));
    assert.ok(fs.existsSync(path.join(claudeHome, "plugins", "installed_plugins.json")));

    const claudeSettings = JSON.parse(fs.readFileSync(path.join(claudeHome, "settings.json"), "utf8"));
    assert.equal(claudeSettings.enabledPlugins["helloloop@helloloop-local"], true);
    assert.equal(
      claudeSettings.extraKnownMarketplaces["helloloop-local"].source.source,
      "directory",
    );
    assert.equal(
      claudeSettings.extraKnownMarketplaces["helloloop-local"].source.path,
      path.join(claudeHome, "plugins", "marketplaces", "helloloop-local"),
    );

    assert.ok(fs.existsSync(path.join(geminiHome, "extensions", "helloloop", "gemini-extension.json")));
    assert.ok(fs.existsSync(path.join(geminiHome, "extensions", "helloloop", "commands", "helloloop.toml")));
    assert.ok(fs.existsSync(path.join(geminiHome, "extensions", "helloloop", "GEMINI.md")));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("uninstall --host all 会移除 Codex、Claude 和 Gemini 的安装痕迹与注册信息", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-cli-uninstall-all-"));
  const codexHome = path.join(tempRoot, "codex-home");
  const claudeHome = path.join(tempRoot, "claude-home");
  const geminiHome = path.join(tempRoot, "gemini-home");

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
    npmBinEntry,
    "uninstall",
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
    assert.match(result.stdout, /HelloLoop 已从以下宿主卸载/);
    assert.ok(!fs.existsSync(path.join(codexHome, "plugins", "helloloop")));
    assert.ok(!fs.existsSync(path.join(
      codexHome,
      "plugins",
      "cache",
      "local-plugins",
      "helloloop",
    )));
    assert.ok(!fs.existsSync(path.join(geminiHome, "extensions", "helloloop")));
    assert.ok(!fs.existsSync(path.join(claudeHome, "plugins", "marketplaces", "helloloop-local")));
    assert.ok(!fs.existsSync(path.join(claudeHome, "plugins", "cache", "helloloop-local")));

    const codexMarketplace = JSON.parse(fs.readFileSync(path.join(codexHome, ".agents", "plugins", "marketplace.json"), "utf8"));
    assert.equal(codexMarketplace.plugins.some((plugin) => plugin?.name === "helloloop"), false);
    assert.doesNotMatch(
      fs.readFileSync(path.join(codexHome, "config.toml"), "utf8"),
      /\[plugins\."helloloop@local-plugins"\]/,
    );

    const claudeSettings = JSON.parse(fs.readFileSync(path.join(claudeHome, "settings.json"), "utf8"));
    assert.equal(Boolean(claudeSettings.enabledPlugins?.["helloloop@helloloop-local"]), false);
    assert.equal(Boolean(claudeSettings.extraKnownMarketplaces?.["helloloop-local"]), false);

    const knownMarketplaces = JSON.parse(fs.readFileSync(path.join(claudeHome, "plugins", "known_marketplaces.json"), "utf8"));
    assert.equal(Boolean(knownMarketplaces["helloloop-local"]), false);

    const installedPlugins = JSON.parse(fs.readFileSync(path.join(claudeHome, "plugins", "installed_plugins.json"), "utf8"));
    assert.equal(Boolean(installedPlugins.plugins?.["helloloop@helloloop-local"]), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("install --host all --force 会清理旧分支残留后重装最新运行时资产", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-cli-reinstall-all-"));
  const codexHome = path.join(tempRoot, "codex-home");
  const claudeHome = path.join(tempRoot, "claude-home");
  const geminiHome = path.join(tempRoot, "gemini-home");

  const firstInstall = spawnSync("node", [
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

  assert.equal(firstInstall.status, 0, firstInstall.stderr);

  writeText(path.join(codexHome, "plugins", "helloloop", "STALE.txt"), "old branch\n");
  writeText(path.join(
    codexHome,
    "plugins",
    "cache",
    "local-plugins",
    "helloloop",
    "local",
    "STALE.txt",
  ), "old branch\n");
  writeText(path.join(claudeHome, "plugins", "marketplaces", "helloloop-local", "STALE.txt"), "old branch\n");
  writeText(path.join(geminiHome, "extensions", "helloloop", "STALE.txt"), "old branch\n");

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
    "--force",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!fs.existsSync(path.join(codexHome, "plugins", "helloloop", "STALE.txt")));
    assert.ok(!fs.existsSync(path.join(
      codexHome,
      "plugins",
      "cache",
      "local-plugins",
      "helloloop",
      "local",
      "STALE.txt",
    )));
    assert.ok(!fs.existsSync(path.join(claudeHome, "plugins", "marketplaces", "helloloop-local", "STALE.txt")));
    assert.ok(!fs.existsSync(path.join(geminiHome, "extensions", "helloloop", "STALE.txt")));
    assert.ok(fs.existsSync(path.join(codexHome, "plugins", "helloloop", ".codex-plugin", "plugin.json")));
    assert.ok(fs.existsSync(path.join(
      codexHome,
      "plugins",
      "cache",
      "local-plugins",
      "helloloop",
      "local",
      ".codex-plugin",
      "plugin.json",
    )));
    assert.match(
      fs.readFileSync(path.join(codexHome, "config.toml"), "utf8"),
      /\[plugins\."helloloop@local-plugins"\]\s+enabled = true/,
    );
    assert.ok(fs.existsSync(path.join(
      claudeHome,
      "plugins",
      "cache",
      "helloloop-local",
      "helloloop",
      packageVersion,
      ".claude-plugin",
      "plugin.json",
    )));
    assert.ok(fs.existsSync(path.join(geminiHome, "extensions", "helloloop", "gemini-extension.json")));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

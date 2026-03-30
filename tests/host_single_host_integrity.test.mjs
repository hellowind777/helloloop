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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function spawnHelloLoop(args, options = {}) {
  return spawnSync("node", [npmBinEntry, ...args], {
    cwd: options.cwd || repoRoot,
    encoding: "utf8",
    env: options.env || process.env,
    input: options.input,
  });
}

test("install --host codex --force 会覆盖旧分支残留，但保留 marketplace 中的其他插件", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-codex-force-"));
  const codexHome = path.join(tempRoot, "codex-home");
  const claudeHome = path.join(tempRoot, "claude-home");
  const geminiHome = path.join(tempRoot, "gemini-home");
  const codexPluginRoot = path.join(codexHome, "plugins", "helloloop");
  const codexInstalledPluginRoot = path.join(
    codexHome,
    "plugins",
    "cache",
    "local-plugins",
    "helloloop",
    "local",
  );
  const codexMarketplaceFile = path.join(codexHome, ".agents", "plugins", "marketplace.json");
  const codexConfigFile = path.join(codexHome, "config.toml");

  writeText(path.join(codexPluginRoot, "STALE.txt"), "old branch\n");
  writeText(path.join(codexInstalledPluginRoot, "STALE.txt"), "old branch\n");
  writeJson(codexMarketplaceFile, {
    name: "local-plugins",
    interface: {
      displayName: "Local Plugins",
    },
    plugins: [
      {
        name: "other-plugin",
        source: {
          source: "local",
          path: "./plugins/other-plugin",
        },
        category: "Utilities",
      },
      {
        name: "helloloop",
        source: {
          source: "local",
          path: "./plugins/helloloop",
        },
        category: "Coding",
      },
    ],
  });
  writeText(codexConfigFile, [
    "[plugins.\"other-plugin@local-plugins\"]",
    "enabled = true",
    "",
    "[plugins.\"helloloop@local-plugins\"]",
    "enabled = false",
    "",
  ].join("\n"));
  writeText(path.join(claudeHome, "marker.txt"), "keep\n");
  writeText(path.join(geminiHome, "extensions", "other-extension", "marker.txt"), "keep\n");

  const result = spawnHelloLoop([
    "install",
    "--host",
    "codex",
    "--codex-home",
    codexHome,
    "--claude-home",
    claudeHome,
    "--gemini-home",
    geminiHome,
    "--force",
  ]);

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!fs.existsSync(path.join(codexPluginRoot, "STALE.txt")));
    assert.ok(!fs.existsSync(path.join(codexInstalledPluginRoot, "STALE.txt")));
    assert.ok(fs.existsSync(path.join(codexPluginRoot, ".codex-plugin", "plugin.json")));
    assert.ok(fs.existsSync(path.join(codexInstalledPluginRoot, ".codex-plugin", "plugin.json")));

    const codexMarketplace = readJson(codexMarketplaceFile);
    assert.equal(codexMarketplace.plugins.filter((item) => item?.name === "helloloop").length, 1);
    assert.equal(codexMarketplace.plugins.some((item) => item?.name === "other-plugin"), true);
    const codexConfig = fs.readFileSync(codexConfigFile, "utf8");
    assert.match(codexConfig, /\[plugins\."other-plugin@local-plugins"\]\s+enabled = true/);
    assert.match(codexConfig, /\[plugins\."helloloop@local-plugins"\]\s+enabled = true/);

    assert.ok(fs.existsSync(path.join(claudeHome, "marker.txt")));
    assert.ok(fs.existsSync(path.join(geminiHome, "extensions", "other-extension", "marker.txt")));
    assert.ok(!fs.existsSync(path.join(geminiHome, "extensions", "helloloop")));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("install --host gemini --force 会覆盖旧扩展残留，但保留同目录下其他扩展", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-gemini-force-"));
  const codexHome = path.join(tempRoot, "codex-home");
  const claudeHome = path.join(tempRoot, "claude-home");
  const geminiHome = path.join(tempRoot, "gemini-home");
  const geminiExtensionRoot = path.join(geminiHome, "extensions", "helloloop");

  writeText(path.join(geminiExtensionRoot, "STALE.txt"), "old branch\n");
  writeText(path.join(geminiHome, "extensions", "other-extension", "marker.txt"), "keep\n");
  writeText(path.join(codexHome, "marker.txt"), "keep\n");
  writeText(path.join(claudeHome, "marker.txt"), "keep\n");

  const result = spawnHelloLoop([
    "install",
    "--host",
    "gemini",
    "--codex-home",
    codexHome,
    "--claude-home",
    claudeHome,
    "--gemini-home",
    geminiHome,
    "--force",
  ]);

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!fs.existsSync(path.join(geminiExtensionRoot, "STALE.txt")));
    assert.ok(fs.existsSync(path.join(geminiExtensionRoot, "gemini-extension.json")));
    assert.ok(fs.existsSync(path.join(geminiExtensionRoot, "GEMINI.md")));
    assert.ok(fs.existsSync(path.join(geminiHome, "extensions", "other-extension", "marker.txt")));

    assert.ok(fs.existsSync(path.join(codexHome, "marker.txt")));
    assert.ok(fs.existsSync(path.join(claudeHome, "marker.txt")));
    assert.ok(!fs.existsSync(path.join(codexHome, "plugins", "helloloop")));
    assert.ok(!fs.existsSync(path.join(codexHome, "plugins", "cache", "local-plugins", "helloloop")));
    assert.ok(!fs.existsSync(path.join(claudeHome, "plugins", "cache", "helloloop-local")));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("install --host codex 遇到损坏的 marketplace.json 时会先失败，不会提前清理旧安装", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-codex-invalid-marketplace-"));
  const codexHome = path.join(tempRoot, "codex-home");
  const codexPluginRoot = path.join(codexHome, "plugins", "helloloop");
  const codexMarketplaceFile = path.join(codexHome, ".agents", "plugins", "marketplace.json");

  writeText(path.join(codexPluginRoot, "STALE.txt"), "keep\n");
  writeText(codexMarketplaceFile, "{ invalid json }\n");

  const result = spawnHelloLoop([
    "install",
    "--host",
    "codex",
    "--codex-home",
    codexHome,
    "--force",
  ]);

  try {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Codex marketplace 配置 不是合法 JSON/);
    assert.ok(fs.existsSync(path.join(codexPluginRoot, "STALE.txt")));
    assert.equal(fs.readFileSync(codexMarketplaceFile, "utf8"), "{ invalid json }\n");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("install --host claude 遇到损坏的配置 JSON 时会先失败，不会提前清理旧安装", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-claude-invalid-config-"));
  const claudeHome = path.join(tempRoot, "claude-home");
  const staleMarketplaceFile = path.join(
    claudeHome,
    "plugins",
    "marketplaces",
    "helloloop-local",
    "STALE.txt",
  );
  const staleCacheFile = path.join(
    claudeHome,
    "plugins",
    "cache",
    "helloloop-local",
    "helloloop",
    "old",
    "STALE.txt",
  );
  const settingsFile = path.join(claudeHome, "settings.json");

  writeText(staleMarketplaceFile, "keep\n");
  writeText(staleCacheFile, "keep\n");
  writeText(settingsFile, "{ invalid json }\n");

  const result = spawnHelloLoop([
    "install",
    "--host",
    "claude",
    "--claude-home",
    claudeHome,
    "--force",
  ]);

  try {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Claude settings 配置 不是合法 JSON/);
    assert.ok(fs.existsSync(staleMarketplaceFile));
    assert.ok(fs.existsSync(staleCacheFile));
    assert.equal(fs.readFileSync(settingsFile, "utf8"), "{ invalid json }\n");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("uninstall --host claude 遇到损坏的配置 JSON 时会先失败，不会提前删除现有安装", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-claude-invalid-uninstall-"));
  const claudeHome = path.join(tempRoot, "claude-home");
  const marketplaceRoot = path.join(claudeHome, "plugins", "marketplaces", "helloloop-local");
  const cacheRoot = path.join(claudeHome, "plugins", "cache", "helloloop-local");
  const settingsFile = path.join(claudeHome, "settings.json");
  const installedPluginsFile = path.join(claudeHome, "plugins", "installed_plugins.json");

  writeText(path.join(marketplaceRoot, ".claude-plugin", "marketplace.json"), "{}\n");
  writeText(path.join(cacheRoot, "marker.txt"), "keep\n");
  writeJson(settingsFile, {
    enabledPlugins: {
      "helloloop@helloloop-local": true,
    },
  });
  writeText(installedPluginsFile, "{ invalid json }\n");

  const result = spawnHelloLoop([
    "uninstall",
    "--host",
    "claude",
    "--claude-home",
    claudeHome,
  ]);

  try {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Claude installed_plugins 配置 不是合法 JSON/);
    assert.ok(fs.existsSync(path.join(marketplaceRoot, ".claude-plugin", "marketplace.json")));
    assert.ok(fs.existsSync(path.join(cacheRoot, "marker.txt")));
    assert.equal(fs.readFileSync(installedPluginsFile, "utf8"), "{ invalid json }\n");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

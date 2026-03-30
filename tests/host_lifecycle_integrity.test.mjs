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

test("install/uninstall --host all 只增删 helloloop 配置，不误伤其他 Codex/Claude/Gemini 配置", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-host-lifecycle-"));
  const codexHome = path.join(tempRoot, "codex-home");
  const claudeHome = path.join(tempRoot, "claude-home");
  const geminiHome = path.join(tempRoot, "gemini-home");

  const codexMarketplaceFile = path.join(codexHome, ".agents", "plugins", "marketplace.json");
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
    ],
  });

  const claudeSettingsFile = path.join(claudeHome, "settings.json");
  const knownMarketplacesFile = path.join(claudeHome, "plugins", "known_marketplaces.json");
  const installedPluginsFile = path.join(claudeHome, "plugins", "installed_plugins.json");
  writeJson(claudeSettingsFile, {
    enabledPlugins: {
      "other-plugin@other-market": true,
    },
    extraKnownMarketplaces: {
      "other-market": {
        source: {
          source: "directory",
          path: path.join(claudeHome, "plugins", "marketplaces", "other-market"),
        },
      },
    },
    customSetting: "keep-me",
  });
  writeJson(knownMarketplacesFile, {
    "other-market": {
      source: {
        source: "directory",
        path: path.join(claudeHome, "plugins", "marketplaces", "other-market"),
      },
      installLocation: path.join(claudeHome, "plugins", "marketplaces", "other-market"),
      lastUpdated: "2026-03-29T00:00:00.000Z",
    },
  });
  writeJson(installedPluginsFile, {
    version: 2,
    plugins: {
      "other-plugin@other-market": [
        {
          scope: "user",
          installPath: path.join(claudeHome, "plugins", "cache", "other-market", "other-plugin", "1.0.0"),
          version: "1.0.0",
          installedAt: "2026-03-29T00:00:00.000Z",
          lastUpdated: "2026-03-29T00:00:00.000Z",
        },
      ],
    },
  });

  writeText(path.join(geminiHome, "extensions", "other-extension", "marker.txt"), "keep\n");

  const installResult = spawnHelloLoop([
    "install",
    "--host",
    "all",
    "--codex-home",
    codexHome,
    "--claude-home",
    claudeHome,
    "--gemini-home",
    geminiHome,
  ]);

  try {
    assert.equal(installResult.status, 0, installResult.stderr);

    const codexMarketplace = readJson(codexMarketplaceFile);
    assert.equal(codexMarketplace.plugins.some((item) => item?.name === "other-plugin"), true);
    assert.equal(codexMarketplace.plugins.some((item) => item?.name === "helloloop"), true);

    const claudeSettings = readJson(claudeSettingsFile);
    assert.equal(claudeSettings.customSetting, "keep-me");
    assert.equal(Boolean(claudeSettings.enabledPlugins["other-plugin@other-market"]), true);
    assert.equal(Boolean(claudeSettings.enabledPlugins["helloloop@helloloop-local"]), true);
    assert.ok(claudeSettings.extraKnownMarketplaces["other-market"]);
    assert.ok(claudeSettings.extraKnownMarketplaces["helloloop-local"]);

    const knownMarketplaces = readJson(knownMarketplacesFile);
    assert.ok(knownMarketplaces["other-market"]);
    assert.ok(knownMarketplaces["helloloop-local"]);

    const installedPlugins = readJson(installedPluginsFile);
    assert.ok(installedPlugins.plugins["other-plugin@other-market"]);
    assert.ok(installedPlugins.plugins["helloloop@helloloop-local"]);

    const uninstallResult = spawnHelloLoop([
      "uninstall",
      "--host",
      "all",
      "--codex-home",
      codexHome,
      "--claude-home",
      claudeHome,
      "--gemini-home",
      geminiHome,
    ]);

    assert.equal(uninstallResult.status, 0, uninstallResult.stderr);

    const codexMarketplaceAfter = readJson(codexMarketplaceFile);
    assert.equal(codexMarketplaceAfter.plugins.some((item) => item?.name === "helloloop"), false);
    assert.equal(codexMarketplaceAfter.plugins.some((item) => item?.name === "other-plugin"), true);

    const claudeSettingsAfter = readJson(claudeSettingsFile);
    assert.equal(claudeSettingsAfter.customSetting, "keep-me");
    assert.equal(Boolean(claudeSettingsAfter.enabledPlugins?.["helloloop@helloloop-local"]), false);
    assert.equal(Boolean(claudeSettingsAfter.enabledPlugins?.["other-plugin@other-market"]), true);
    assert.equal(Boolean(claudeSettingsAfter.extraKnownMarketplaces?.["helloloop-local"]), false);
    assert.ok(claudeSettingsAfter.extraKnownMarketplaces?.["other-market"]);

    const knownMarketplacesAfter = readJson(knownMarketplacesFile);
    assert.equal(Boolean(knownMarketplacesAfter["helloloop-local"]), false);
    assert.ok(knownMarketplacesAfter["other-market"]);

    const installedPluginsAfter = readJson(installedPluginsFile);
    assert.equal(Boolean(installedPluginsAfter.plugins?.["helloloop@helloloop-local"]), false);
    assert.ok(installedPluginsAfter.plugins?.["other-plugin@other-market"]);

    assert.ok(fs.existsSync(path.join(geminiHome, "extensions", "other-extension", "marker.txt")));
    assert.ok(!fs.existsSync(path.join(geminiHome, "extensions", "helloloop")));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("install --host claude --force 会清理旧版本缓存并更新配置，同时不触碰其他宿主目录", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-claude-force-install-"));
  const codexHome = path.join(tempRoot, "codex-home");
  const claudeHome = path.join(tempRoot, "claude-home");
  const geminiHome = path.join(tempRoot, "gemini-home");
  const oldVersionRoot = path.join(
    claudeHome,
    "plugins",
    "cache",
    "helloloop-local",
    "helloloop",
    "0.0.1",
  );
  const oldMarketplaceRoot = path.join(
    claudeHome,
    "plugins",
    "marketplaces",
    "helloloop-local",
  );
  const settingsFile = path.join(claudeHome, "settings.json");
  const knownMarketplacesFile = path.join(claudeHome, "plugins", "known_marketplaces.json");
  const installedPluginsFile = path.join(claudeHome, "plugins", "installed_plugins.json");

  writeText(path.join(oldVersionRoot, "STALE.txt"), "old version\n");
  writeText(path.join(oldMarketplaceRoot, "STALE.txt"), "old marketplace\n");
  writeJson(settingsFile, {
    enabledPlugins: {
      "helloloop@helloloop-local": true,
      "other-plugin@other-market": true,
    },
    extraKnownMarketplaces: {
      "helloloop-local": {
        source: {
          source: "directory",
          path: oldMarketplaceRoot,
        },
      },
      "other-market": {
        source: {
          source: "directory",
          path: path.join(claudeHome, "plugins", "marketplaces", "other-market"),
        },
      },
    },
  });
  writeJson(knownMarketplacesFile, {
    "helloloop-local": {
      source: {
        source: "directory",
        path: oldMarketplaceRoot,
      },
      installLocation: oldMarketplaceRoot,
      lastUpdated: "2026-03-28T00:00:00.000Z",
    },
    "other-market": {
      source: {
        source: "directory",
        path: path.join(claudeHome, "plugins", "marketplaces", "other-market"),
      },
      installLocation: path.join(claudeHome, "plugins", "marketplaces", "other-market"),
      lastUpdated: "2026-03-29T00:00:00.000Z",
    },
  });
  writeJson(installedPluginsFile, {
    version: 2,
    plugins: {
      "helloloop@helloloop-local": [
        {
          scope: "user",
          installPath: oldVersionRoot,
          version: "0.0.1",
          installedAt: "2026-03-28T00:00:00.000Z",
          lastUpdated: "2026-03-28T00:00:00.000Z",
        },
      ],
      "other-plugin@other-market": [
        {
          scope: "user",
          installPath: path.join(claudeHome, "plugins", "cache", "other-market", "other-plugin", "1.0.0"),
          version: "1.0.0",
          installedAt: "2026-03-29T00:00:00.000Z",
          lastUpdated: "2026-03-29T00:00:00.000Z",
        },
      ],
    },
  });

  const result = spawnHelloLoop([
    "install",
    "--host",
    "claude",
    "--claude-home",
    claudeHome,
    "--codex-home",
    codexHome,
    "--gemini-home",
    geminiHome,
    "--force",
  ]);

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!fs.existsSync(path.join(oldVersionRoot, "STALE.txt")));
    assert.ok(!fs.existsSync(path.join(oldMarketplaceRoot, "STALE.txt")));
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

    const settings = readJson(settingsFile);
    assert.equal(Boolean(settings.enabledPlugins?.["helloloop@helloloop-local"]), true);
    assert.equal(Boolean(settings.enabledPlugins?.["other-plugin@other-market"]), true);

    const knownMarketplaces = readJson(knownMarketplacesFile);
    assert.ok(knownMarketplaces["helloloop-local"]);
    assert.ok(knownMarketplaces["other-market"]);

    const installedPlugins = readJson(installedPluginsFile);
    assert.equal(installedPlugins.plugins["helloloop@helloloop-local"][0].version, packageVersion);
    assert.equal(Boolean(installedPlugins.plugins["other-plugin@other-market"]), true);

    assert.ok(!fs.existsSync(path.join(codexHome, "plugins", "helloloop")));
    assert.ok(!fs.existsSync(path.join(geminiHome, "extensions", "helloloop")));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("install/uninstall 链路只会在 HELLOLOOP_HOME 下维护 settings.json，不会生成任务状态或 runs 记录", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-global-state-clean-"));
  const codexHome = path.join(tempRoot, "codex-home");
  const claudeHome = path.join(tempRoot, "claude-home");
  const geminiHome = path.join(tempRoot, "gemini-home");
  const helloLoopHome = path.join(tempRoot, "helloloop-home");
  const env = {
    ...process.env,
    HELLOLOOP_HOME: helloLoopHome,
    HELLOLOOP_SETTINGS_FILE: path.join(helloLoopHome, "settings.json"),
  };

  try {
    const installResult = spawnHelloLoop([
      "install",
      "--host",
      "all",
      "--codex-home",
      codexHome,
      "--claude-home",
      claudeHome,
      "--gemini-home",
      geminiHome,
    ], { env });
    assert.equal(installResult.status, 0, installResult.stderr);
    assert.equal(fs.existsSync(path.join(helloLoopHome, "settings.json")), true);
    assert.equal(fs.existsSync(path.join(helloLoopHome, "runs")), false);
    assert.equal(fs.existsSync(path.join(helloLoopHome, "status.json")), false);

    const uninstallResult = spawnHelloLoop([
      "uninstall",
      "--host",
      "all",
      "--codex-home",
      codexHome,
      "--claude-home",
      claudeHome,
      "--gemini-home",
      geminiHome,
    ], { env });
    assert.equal(uninstallResult.status, 0, uninstallResult.stderr);
    assert.equal(fs.existsSync(path.join(helloLoopHome, "settings.json")), true);
    assert.equal(fs.existsSync(path.join(helloLoopHome, "runs")), false);
    assert.equal(fs.existsSync(path.join(helloLoopHome, "status.json")), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("install 会补齐缺失项、清理未知项，并保留已知项的现有内容", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-settings-sync-"));
  const codexHome = path.join(tempRoot, "codex-home");
  const helloLoopHome = path.join(tempRoot, "helloloop-home");
  const settingsFile = path.join(helloLoopHome, "settings.json");
  const env = {
    ...process.env,
    HELLOLOOP_HOME: helloLoopHome,
    HELLOLOOP_SETTINGS_FILE: settingsFile,
  };

  writeJson(settingsFile, {
    defaultEngine: "custom-engine",
    notifications: {
      email: {
        enabled: "yes",
        smtp: {
          host: "smtp.example.com",
        },
      },
    },
    deprecatedField: true,
  });

  try {
    const installResult = spawnHelloLoop([
      "install",
      "--host",
      "codex",
      "--codex-home",
      codexHome,
    ], { env });
    assert.equal(installResult.status, 0, installResult.stderr);

    const settings = readJson(settingsFile);
    assert.equal(settings.defaultEngine, "custom-engine");
    assert.equal(settings.lastSelectedEngine, "");
    assert.equal(settings.notifications.email.enabled, "yes");
    assert.deepEqual(settings.notifications.email.to, []);
    assert.equal(settings.notifications.email.from, "");
    assert.equal(settings.notifications.email.smtp.host, "smtp.example.com");
    assert.equal(settings.notifications.email.smtp.port, 465);
    assert.equal(Object.hasOwn(settings, "deprecatedField"), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("install 遇到非法 settings.json 时会备份后重建当前版本结构", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-settings-invalid-"));
  const codexHome = path.join(tempRoot, "codex-home");
  const helloLoopHome = path.join(tempRoot, "helloloop-home");
  const settingsFile = path.join(helloLoopHome, "settings.json");
  const env = {
    ...process.env,
    HELLOLOOP_HOME: helloLoopHome,
    HELLOLOOP_SETTINGS_FILE: settingsFile,
  };

  writeText(settingsFile, "{ invalid json }\n");

  try {
    const installResult = spawnHelloLoop([
      "install",
      "--host",
      "codex",
      "--codex-home",
      codexHome,
    ], { env });
    assert.equal(installResult.status, 0, installResult.stderr);
    assert.match(installResult.stdout, /检测到非法 JSON，已重建为当前版本结构/);

    const settings = readJson(settingsFile);
    assert.deepEqual(settings, {
      defaultEngine: "",
      lastSelectedEngine: "",
      notifications: {
        email: {
          enabled: false,
          to: [],
          from: "",
          smtp: {
            host: "",
            port: 465,
            secure: true,
            starttls: false,
            username: "",
            usernameEnv: "",
            password: "",
            passwordEnv: "",
            timeoutSeconds: 30,
            rejectUnauthorized: true,
          },
        },
      },
    });

    const backupFiles = fs.readdirSync(helloLoopHome)
      .filter((item) => item.startsWith("settings.json.invalid-") && item.endsWith(".bak"));
    assert.equal(backupFiles.length, 1);
    assert.equal(fs.readFileSync(path.join(helloLoopHome, backupFiles[0]), "utf8"), "{ invalid json }\n");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

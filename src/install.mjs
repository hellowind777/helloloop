import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ensureDir, fileExists, nowIso, readJson, writeJson } from "./common.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const runtimeBundleEntries = [
  ".claude-plugin",
  ".codex-plugin",
  "LICENSE",
  "README.md",
  "bin",
  "hosts",
  "package.json",
  "scripts",
  "skills",
  "src",
  "templates",
];

const codexBundleEntries = runtimeBundleEntries.filter((entry) => ![
  ".claude-plugin",
  "hosts",
].includes(entry));

const supportedHosts = ["codex", "claude", "gemini"];
const CLAUDE_MARKETPLACE_NAME = "helloloop-local";
const CLAUDE_PLUGIN_KEY = "helloloop@helloloop-local";

function resolveHomeDir(homeDir, defaultDirName) {
  return path.resolve(homeDir || path.join(os.homedir(), defaultDirName));
}

function assertPathInside(parentDir, targetDir, label) {
  const relative = path.relative(parentDir, targetDir);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} 超出允许范围：${targetDir}`);
  }
}

function removeTargetIfNeeded(targetPath, force) {
  if (!fileExists(targetPath)) {
    return;
  }
  if (!force) {
    throw new Error(`目标目录已存在：${targetPath}。若要覆盖，请追加 --force。`);
  }
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function removePathIfExists(targetPath) {
  if (!fileExists(targetPath)) {
    return false;
  }
  fs.rmSync(targetPath, { recursive: true, force: true });
  return true;
}

function copyBundleEntries(bundleRoot, targetRoot, entries) {
  for (const entry of entries) {
    const sourcePath = path.join(bundleRoot, entry);
    if (!fileExists(sourcePath)) {
      continue;
    }

    fs.cpSync(sourcePath, path.join(targetRoot, entry), {
      force: true,
      recursive: true,
    });
  }
}

function copyDirectory(sourceRoot, targetRoot) {
  fs.cpSync(sourceRoot, targetRoot, {
    force: true,
    recursive: true,
  });
}

function updateCodexMarketplace(marketplaceFile) {
  const marketplace = fileExists(marketplaceFile)
    ? readJson(marketplaceFile)
    : {
        name: "local-plugins",
        interface: {
          displayName: "Local Plugins",
        },
        plugins: [],
      };

  marketplace.interface = marketplace.interface || {
    displayName: "Local Plugins",
  };
  marketplace.plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];

  const nextEntry = {
    name: "helloloop",
    source: {
      source: "local",
      path: "./plugins/helloloop",
    },
    policy: {
      installation: "AVAILABLE",
      authentication: "ON_INSTALL",
    },
    category: "Coding",
  };

  const existingIndex = marketplace.plugins.findIndex((plugin) => plugin?.name === "helloloop");
  if (existingIndex >= 0) {
    marketplace.plugins.splice(existingIndex, 1, nextEntry);
  } else {
    marketplace.plugins.push(nextEntry);
  }

  writeJson(marketplaceFile, marketplace);
}

function removeCodexMarketplaceEntry(marketplaceFile) {
  if (!fileExists(marketplaceFile)) {
    return false;
  }

  const marketplace = readJson(marketplaceFile);
  const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  const nextPlugins = plugins.filter((plugin) => plugin?.name !== "helloloop");
  if (nextPlugins.length === plugins.length) {
    return false;
  }

  marketplace.plugins = nextPlugins;
  writeJson(marketplaceFile, marketplace);
  return true;
}

function updateClaudeSettings(settingsFile, marketplaceRoot) {
  const settings = fileExists(settingsFile)
    ? readJson(settingsFile)
    : {};

  settings.extraKnownMarketplaces = settings.extraKnownMarketplaces || {};
  settings.enabledPlugins = settings.enabledPlugins || {};

  settings.extraKnownMarketplaces[CLAUDE_MARKETPLACE_NAME] = {
    source: {
      source: "directory",
      path: marketplaceRoot,
    },
  };
  settings.enabledPlugins[CLAUDE_PLUGIN_KEY] = true;

  writeJson(settingsFile, settings);
}

function removeClaudeSettingsEntries(settingsFile) {
  if (!fileExists(settingsFile)) {
    return false;
  }

  const settings = readJson(settingsFile);
  let changed = false;

  if (settings.extraKnownMarketplaces && Object.hasOwn(settings.extraKnownMarketplaces, CLAUDE_MARKETPLACE_NAME)) {
    delete settings.extraKnownMarketplaces[CLAUDE_MARKETPLACE_NAME];
    changed = true;
  }

  if (settings.enabledPlugins && Object.hasOwn(settings.enabledPlugins, CLAUDE_PLUGIN_KEY)) {
    delete settings.enabledPlugins[CLAUDE_PLUGIN_KEY];
    changed = true;
  }

  if (changed) {
    writeJson(settingsFile, settings);
  }
  return changed;
}

function updateClaudeKnownMarketplaces(knownMarketplacesFile, marketplaceRoot, updatedAt) {
  const knownMarketplaces = fileExists(knownMarketplacesFile)
    ? readJson(knownMarketplacesFile)
    : {};

  knownMarketplaces[CLAUDE_MARKETPLACE_NAME] = {
    source: {
      source: "directory",
      path: marketplaceRoot,
    },
    installLocation: marketplaceRoot,
    lastUpdated: updatedAt,
  };

  writeJson(knownMarketplacesFile, knownMarketplaces);
}

function removeClaudeKnownMarketplace(knownMarketplacesFile) {
  if (!fileExists(knownMarketplacesFile)) {
    return false;
  }

  const knownMarketplaces = readJson(knownMarketplacesFile);
  if (!Object.hasOwn(knownMarketplaces, CLAUDE_MARKETPLACE_NAME)) {
    return false;
  }

  delete knownMarketplaces[CLAUDE_MARKETPLACE_NAME];
  writeJson(knownMarketplacesFile, knownMarketplaces);
  return true;
}

function updateClaudeInstalledPlugins(installedPluginsFile, pluginRoot, pluginVersion, updatedAt) {
  const installedPlugins = fileExists(installedPluginsFile)
    ? readJson(installedPluginsFile)
    : {
        version: 2,
        plugins: {},
      };

  installedPlugins.version = 2;
  installedPlugins.plugins = installedPlugins.plugins || {};
  installedPlugins.plugins[CLAUDE_PLUGIN_KEY] = [
    {
      scope: "user",
      installPath: pluginRoot,
      version: pluginVersion,
      installedAt: updatedAt,
      lastUpdated: updatedAt,
    },
  ];

  writeJson(installedPluginsFile, installedPlugins);
}

function removeClaudeInstalledPlugin(installedPluginsFile) {
  if (!fileExists(installedPluginsFile)) {
    return false;
  }

  const installedPlugins = readJson(installedPluginsFile);
  if (!installedPlugins.plugins || !Object.hasOwn(installedPlugins.plugins, CLAUDE_PLUGIN_KEY)) {
    return false;
  }

  delete installedPlugins.plugins[CLAUDE_PLUGIN_KEY];
  writeJson(installedPluginsFile, installedPlugins);
  return true;
}

function installCodexHost(bundleRoot, options) {
  const resolvedCodexHome = resolveHomeDir(options.codexHome, ".codex");
  const targetPluginsRoot = path.join(resolvedCodexHome, "plugins");
  const targetPluginRoot = path.join(targetPluginsRoot, "helloloop");
  const marketplaceFile = path.join(resolvedCodexHome, ".agents", "plugins", "marketplace.json");
  const manifestFile = path.join(bundleRoot, ".codex-plugin", "plugin.json");

  if (!fileExists(manifestFile)) {
    throw new Error(`未找到 Codex 插件 manifest：${manifestFile}`);
  }

  assertPathInside(resolvedCodexHome, targetPluginRoot, "Codex 目标插件目录");
  removeTargetIfNeeded(targetPluginRoot, options.force);

  ensureDir(targetPluginsRoot);
  ensureDir(targetPluginRoot);
  copyBundleEntries(bundleRoot, targetPluginRoot, codexBundleEntries);

  const gitMetadataPath = path.join(targetPluginRoot, ".git");
  if (fileExists(gitMetadataPath)) {
    fs.rmSync(gitMetadataPath, { recursive: true, force: true });
  }

  ensureDir(path.dirname(marketplaceFile));
  updateCodexMarketplace(marketplaceFile);

  return {
    host: "codex",
    displayName: "Codex",
    targetRoot: targetPluginRoot,
    marketplaceFile,
  };
}

function uninstallCodexHost(options) {
  const resolvedCodexHome = resolveHomeDir(options.codexHome, ".codex");
  const targetPluginRoot = path.join(resolvedCodexHome, "plugins", "helloloop");
  const marketplaceFile = path.join(resolvedCodexHome, ".agents", "plugins", "marketplace.json");

  const removedPlugin = removePathIfExists(targetPluginRoot);
  const removedMarketplace = removeCodexMarketplaceEntry(marketplaceFile);

  return {
    host: "codex",
    displayName: "Codex",
    targetRoot: targetPluginRoot,
    removed: removedPlugin || removedMarketplace,
    marketplaceFile,
  };
}

function installClaudeHost(bundleRoot, options) {
  const resolvedClaudeHome = resolveHomeDir(options.claudeHome, ".claude");
  const sourceMarketplaceRoot = path.join(bundleRoot, "hosts", "claude", "marketplace");
  const sourceManifest = path.join(bundleRoot, ".claude-plugin", "plugin.json");
  const pluginVersion = readJson(sourceManifest).version || readJson(path.join(bundleRoot, "package.json")).version;
  const targetPluginsRoot = path.join(resolvedClaudeHome, "plugins");
  const targetMarketplaceRoot = path.join(targetPluginsRoot, "marketplaces", CLAUDE_MARKETPLACE_NAME);
  const targetCachePluginsRoot = path.join(targetPluginsRoot, "cache", CLAUDE_MARKETPLACE_NAME, "helloloop");
  const targetInstalledPluginRoot = path.join(targetCachePluginsRoot, pluginVersion);
  const knownMarketplacesFile = path.join(targetPluginsRoot, "known_marketplaces.json");
  const installedPluginsFile = path.join(targetPluginsRoot, "installed_plugins.json");
  const settingsFile = path.join(resolvedClaudeHome, "settings.json");

  if (!fileExists(sourceManifest)) {
    throw new Error(`未找到 Claude 插件 manifest：${sourceManifest}`);
  }
  if (!fileExists(path.join(sourceMarketplaceRoot, ".claude-plugin", "marketplace.json"))) {
    throw new Error(`未找到 Claude marketplace 模板：${sourceMarketplaceRoot}`);
  }

  assertPathInside(resolvedClaudeHome, targetMarketplaceRoot, "Claude marketplace 目录");
  assertPathInside(resolvedClaudeHome, targetInstalledPluginRoot, "Claude 插件缓存目录");
  removeTargetIfNeeded(targetMarketplaceRoot, options.force);
  removeTargetIfNeeded(targetCachePluginsRoot, options.force);

  ensureDir(path.dirname(targetMarketplaceRoot));
  ensureDir(path.dirname(targetInstalledPluginRoot));
  copyDirectory(sourceMarketplaceRoot, targetMarketplaceRoot);
  copyDirectory(path.join(sourceMarketplaceRoot, "plugins", "helloloop"), targetInstalledPluginRoot);
  ensureDir(targetPluginsRoot);
  const updatedAt = nowIso();
  updateClaudeSettings(settingsFile, targetMarketplaceRoot);
  updateClaudeKnownMarketplaces(knownMarketplacesFile, targetMarketplaceRoot, updatedAt);
  updateClaudeInstalledPlugins(installedPluginsFile, targetInstalledPluginRoot, pluginVersion, updatedAt);

  return {
    host: "claude",
    displayName: "Claude",
    targetRoot: targetInstalledPluginRoot,
    marketplaceFile: path.join(targetMarketplaceRoot, ".claude-plugin", "marketplace.json"),
    settingsFile,
  };
}

function uninstallClaudeHost(options) {
  const resolvedClaudeHome = resolveHomeDir(options.claudeHome, ".claude");
  const targetPluginsRoot = path.join(resolvedClaudeHome, "plugins");
  const targetMarketplaceRoot = path.join(targetPluginsRoot, "marketplaces", CLAUDE_MARKETPLACE_NAME);
  const targetCachePluginsRoot = path.join(targetPluginsRoot, "cache", CLAUDE_MARKETPLACE_NAME);
  const knownMarketplacesFile = path.join(targetPluginsRoot, "known_marketplaces.json");
  const installedPluginsFile = path.join(targetPluginsRoot, "installed_plugins.json");
  const settingsFile = path.join(resolvedClaudeHome, "settings.json");

  const removedMarketplaceDir = removePathIfExists(targetMarketplaceRoot);
  const removedCacheDir = removePathIfExists(targetCachePluginsRoot);
  const removedKnownMarketplace = removeClaudeKnownMarketplace(knownMarketplacesFile);
  const removedInstalledPlugin = removeClaudeInstalledPlugin(installedPluginsFile);
  const removedSettingsEntries = removeClaudeSettingsEntries(settingsFile);

  return {
    host: "claude",
    displayName: "Claude",
    targetRoot: targetCachePluginsRoot,
    removed: [
      removedMarketplaceDir,
      removedCacheDir,
      removedKnownMarketplace,
      removedInstalledPlugin,
      removedSettingsEntries,
    ].some(Boolean),
    marketplaceFile: path.join(targetMarketplaceRoot, ".claude-plugin", "marketplace.json"),
    settingsFile,
  };
}

function installGeminiHost(bundleRoot, options) {
  const resolvedGeminiHome = resolveHomeDir(options.geminiHome, ".gemini");
  const sourceExtensionRoot = path.join(bundleRoot, "hosts", "gemini", "extension");
  const targetExtensionRoot = path.join(resolvedGeminiHome, "extensions", "helloloop");

  if (!fileExists(path.join(sourceExtensionRoot, "gemini-extension.json"))) {
    throw new Error(`未找到 Gemini 扩展清单：${sourceExtensionRoot}`);
  }

  assertPathInside(resolvedGeminiHome, targetExtensionRoot, "Gemini 扩展目录");
  removeTargetIfNeeded(targetExtensionRoot, options.force);

  ensureDir(path.dirname(targetExtensionRoot));
  copyDirectory(sourceExtensionRoot, targetExtensionRoot);

  return {
    host: "gemini",
    displayName: "Gemini",
    targetRoot: targetExtensionRoot,
  };
}

function uninstallGeminiHost(options) {
  const resolvedGeminiHome = resolveHomeDir(options.geminiHome, ".gemini");
  const targetExtensionRoot = path.join(resolvedGeminiHome, "extensions", "helloloop");

  return {
    host: "gemini",
    displayName: "Gemini",
    targetRoot: targetExtensionRoot,
    removed: removePathIfExists(targetExtensionRoot),
  };
}

function resolveInstallHosts(hostOption) {
  const normalized = String(hostOption || "codex").trim().toLowerCase();
  if (normalized === "all") {
    return [...supportedHosts];
  }
  if (!supportedHosts.includes(normalized)) {
    throw new Error(`不支持的宿主：${hostOption}。可选值：codex、claude、gemini、all`);
  }
  return [normalized];
}

export function installPluginBundle(options = {}) {
  const bundleRoot = path.resolve(options.bundleRoot || path.join(__dirname, ".."));
  const selectedHosts = resolveInstallHosts(options.host);
  const installers = {
    codex: () => installCodexHost(bundleRoot, options),
    claude: () => installClaudeHost(bundleRoot, options),
    gemini: () => installGeminiHost(bundleRoot, options),
  };

  const installedHosts = selectedHosts.map((host) => installers[host]());
  const codexResult = installedHosts.find((item) => item.host === "codex");

  return {
    installedHosts,
    targetPluginRoot: codexResult?.targetRoot || "",
    marketplaceFile: codexResult?.marketplaceFile || "",
  };
}

export function uninstallPluginBundle(options = {}) {
  const selectedHosts = resolveInstallHosts(options.host);
  const uninstallers = {
    codex: () => uninstallCodexHost(options),
    claude: () => uninstallClaudeHost(options),
    gemini: () => uninstallGeminiHost(options),
  };

  const uninstalledHosts = selectedHosts.map((host) => uninstallers[host]());
  return {
    uninstalledHosts,
  };
}

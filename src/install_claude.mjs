import path from "node:path";

import { ensureDir, fileExists, nowIso, readJson, writeJson } from "./common.mjs";
import {
  CLAUDE_MARKETPLACE_NAME,
  CLAUDE_PLUGIN_KEY,
  assertPathInside,
  copyDirectory,
  removePathIfExists,
  removeTargetIfNeeded,
  resolveHomeDir,
} from "./install_shared.mjs";

function updateClaudeSettings(settingsFile, marketplaceRoot) {
  const settings = fileExists(settingsFile) ? readJson(settingsFile) : {};

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
  const knownMarketplaces = fileExists(knownMarketplacesFile) ? readJson(knownMarketplacesFile) : {};
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
    : { version: 2, plugins: {} };

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

export function installClaudeHost(bundleRoot, options = {}) {
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

  ensureDir(targetPluginsRoot);
  ensureDir(path.dirname(targetMarketplaceRoot));
  ensureDir(path.dirname(targetInstalledPluginRoot));
  copyDirectory(sourceMarketplaceRoot, targetMarketplaceRoot);
  copyDirectory(path.join(sourceMarketplaceRoot, "plugins", "helloloop"), targetInstalledPluginRoot);
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

export function uninstallClaudeHost(options = {}) {
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

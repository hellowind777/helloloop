import path from "node:path";

import { ensureDir, fileExists, readJson, readTextIfExists, writeJson, writeText } from "./common.mjs";
import {
  assertPathInside,
  codexBundleEntries,
  copyBundleEntries,
  readExistingJsonOrThrow,
  removePathIfExists,
  removeTargetIfNeeded,
  resolveCodexLocalRoot,
  resolveHomeDir,
} from "./install_shared.mjs";

const CODEX_MARKETPLACE_NAME = "local-plugins";
const CODEX_PLUGIN_NAME = "helloloop";
const CODEX_PLUGIN_KEY = `${CODEX_PLUGIN_NAME}@${CODEX_MARKETPLACE_NAME}`;
const CODEX_PLUGIN_CONFIG_HEADER = `[plugins."${CODEX_PLUGIN_KEY}"]`;
const CODEX_PLUGIN_CONFIG_BLOCK = `${CODEX_PLUGIN_CONFIG_HEADER}\nenabled = true`;

function isTomlTableHeader(line) {
  const trimmed = String(line || "").trim();
  return trimmed.startsWith("[") && trimmed.endsWith("]");
}

function stripTomlSection(text, headerLine) {
  const lines = String(text || "").replaceAll("\r\n", "\n").split("\n");
  const kept = [];
  let removed = false;

  for (let index = 0; index < lines.length;) {
    if (lines[index].trim() === headerLine) {
      removed = true;
      index += 1;
      while (index < lines.length && !isTomlTableHeader(lines[index])) {
        index += 1;
      }
      continue;
    }

    kept.push(lines[index]);
    index += 1;
  }

  const nextText = kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  return {
    removed,
    text: nextText ? `${nextText}\n` : "",
  };
}

function upsertCodexPluginConfig(configFile) {
  const existingText = readTextIfExists(configFile, "");
  const stripped = stripTomlSection(existingText, CODEX_PLUGIN_CONFIG_HEADER).text.trimEnd();
  const nextText = stripped
    ? `${stripped}\n\n${CODEX_PLUGIN_CONFIG_BLOCK}\n`
    : `${CODEX_PLUGIN_CONFIG_BLOCK}\n`;
  writeText(configFile, nextText);
}

function removeCodexPluginConfig(configFile) {
  if (!fileExists(configFile)) {
    return false;
  }

  const existingText = readTextIfExists(configFile, "");
  const result = stripTomlSection(existingText, CODEX_PLUGIN_CONFIG_HEADER);
  if (result.removed) {
    writeText(configFile, result.text);
  }
  return result.removed;
}

function updateCodexMarketplace(marketplaceFile, existingMarketplace = null) {
  const marketplace = existingMarketplace
    || (fileExists(marketplaceFile)
      ? readJson(marketplaceFile)
      : {
        name: CODEX_MARKETPLACE_NAME,
        interface: {
          displayName: "Local Plugins",
        },
        plugins: [],
      });

  marketplace.interface = marketplace.interface || {
    displayName: "Local Plugins",
  };
  marketplace.plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];

  const nextEntry = {
    name: CODEX_PLUGIN_NAME,
    source: {
      source: "local",
      path: `./plugins/${CODEX_PLUGIN_NAME}`,
    },
    policy: {
      installation: "AVAILABLE",
      authentication: "ON_INSTALL",
    },
    category: "Coding",
  };

  const existingIndex = marketplace.plugins.findIndex((plugin) => plugin?.name === CODEX_PLUGIN_NAME);
  if (existingIndex >= 0) {
    marketplace.plugins.splice(existingIndex, 1, nextEntry);
  } else {
    marketplace.plugins.push(nextEntry);
  }

  writeJson(marketplaceFile, marketplace);
}

function removeCodexMarketplaceEntry(marketplaceFile, existingMarketplace = null) {
  if (!fileExists(marketplaceFile)) {
    return false;
  }

  const marketplace = existingMarketplace || readJson(marketplaceFile);
  const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  const nextPlugins = plugins.filter((plugin) => plugin?.name !== CODEX_PLUGIN_NAME);
  if (nextPlugins.length === plugins.length) {
    return false;
  }

  marketplace.plugins = nextPlugins;
  writeJson(marketplaceFile, marketplace);
  return true;
}

export function installCodexHost(bundleRoot, options = {}) {
  const resolvedCodexHome = resolveHomeDir(options.codexHome, ".codex");
  const resolvedLocalRoot = resolveCodexLocalRoot(options.codexHome);
  const targetPluginsRoot = path.join(resolvedLocalRoot, "plugins");
  const targetPluginRoot = path.join(targetPluginsRoot, CODEX_PLUGIN_NAME);
  const legacyTargetPluginRoot = path.join(resolvedCodexHome, "plugins", CODEX_PLUGIN_NAME);
  const targetPluginCacheRoot = path.join(
    resolvedCodexHome,
    "plugins",
    "cache",
    CODEX_MARKETPLACE_NAME,
    CODEX_PLUGIN_NAME,
  );
  const targetInstalledPluginRoot = path.join(targetPluginCacheRoot, "local");
  const marketplaceFile = path.join(resolvedLocalRoot, ".agents", "plugins", "marketplace.json");
  const legacyMarketplaceFile = path.join(resolvedCodexHome, ".agents", "plugins", "marketplace.json");
  const configFile = path.join(resolvedCodexHome, "config.toml");
  const manifestFile = path.join(bundleRoot, ".codex-plugin", "plugin.json");
  const existingMarketplace = readExistingJsonOrThrow(marketplaceFile, "Codex marketplace 配置");
  const existingLegacyMarketplace = legacyMarketplaceFile === marketplaceFile
    ? existingMarketplace
    : readExistingJsonOrThrow(legacyMarketplaceFile, "Codex legacy marketplace 配置");

  if (!fileExists(manifestFile)) {
    throw new Error(`未找到 Codex 插件 manifest：${manifestFile}`);
  }

  assertPathInside(resolvedLocalRoot, targetPluginRoot, "Codex 本地插件目录");
  assertPathInside(resolvedCodexHome, targetPluginCacheRoot, "Codex 插件缓存目录");
  removeTargetIfNeeded(targetPluginRoot, options.force);
  removeTargetIfNeeded(targetPluginCacheRoot, options.force);
  if (legacyTargetPluginRoot !== targetPluginRoot) {
    removePathIfExists(legacyTargetPluginRoot);
  }

  ensureDir(targetPluginsRoot);
  ensureDir(targetPluginRoot);
  ensureDir(targetInstalledPluginRoot);
  copyBundleEntries(bundleRoot, targetPluginRoot, codexBundleEntries);
  copyBundleEntries(bundleRoot, targetInstalledPluginRoot, codexBundleEntries);
  removePathIfExists(path.join(targetPluginRoot, ".git"));
  removePathIfExists(path.join(targetInstalledPluginRoot, ".git"));

  ensureDir(path.dirname(marketplaceFile));
  updateCodexMarketplace(marketplaceFile, existingMarketplace);
  if (legacyMarketplaceFile !== marketplaceFile) {
    removeCodexMarketplaceEntry(legacyMarketplaceFile, existingLegacyMarketplace);
  }
  upsertCodexPluginConfig(configFile);

  return {
    host: "codex",
    displayName: "Codex",
    targetRoot: targetPluginRoot,
    installedRoot: targetInstalledPluginRoot,
    marketplaceFile,
    configFile,
  };
}

export function uninstallCodexHost(options = {}) {
  const resolvedCodexHome = resolveHomeDir(options.codexHome, ".codex");
  const resolvedLocalRoot = resolveCodexLocalRoot(options.codexHome);
  const targetPluginRoot = path.join(resolvedLocalRoot, "plugins", CODEX_PLUGIN_NAME);
  const legacyTargetPluginRoot = path.join(resolvedCodexHome, "plugins", CODEX_PLUGIN_NAME);
  const targetPluginCacheRoot = path.join(
    resolvedCodexHome,
    "plugins",
    "cache",
    CODEX_MARKETPLACE_NAME,
    CODEX_PLUGIN_NAME,
  );
  const marketplaceFile = path.join(resolvedLocalRoot, ".agents", "plugins", "marketplace.json");
  const legacyMarketplaceFile = path.join(resolvedCodexHome, ".agents", "plugins", "marketplace.json");
  const configFile = path.join(resolvedCodexHome, "config.toml");
  const existingMarketplace = readExistingJsonOrThrow(marketplaceFile, "Codex marketplace 配置");
  const existingLegacyMarketplace = legacyMarketplaceFile === marketplaceFile
    ? existingMarketplace
    : readExistingJsonOrThrow(legacyMarketplaceFile, "Codex legacy marketplace 配置");

  const removedPlugin = removePathIfExists(targetPluginRoot);
  const removedLegacyPlugin = legacyTargetPluginRoot === targetPluginRoot
    ? false
    : removePathIfExists(legacyTargetPluginRoot);
  const removedCache = removePathIfExists(targetPluginCacheRoot);
  const removedMarketplace = removeCodexMarketplaceEntry(marketplaceFile, existingMarketplace);
  const removedLegacyMarketplace = legacyMarketplaceFile === marketplaceFile
    ? false
    : removeCodexMarketplaceEntry(legacyMarketplaceFile, existingLegacyMarketplace);
  const removedConfig = removeCodexPluginConfig(configFile);

  return {
    host: "codex",
    displayName: "Codex",
    targetRoot: targetPluginRoot,
    removed: removedPlugin || removedLegacyPlugin || removedCache || removedMarketplace || removedLegacyMarketplace || removedConfig,
    marketplaceFile,
    configFile,
  };
}

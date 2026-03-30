import path from "node:path";

import { ensureDir, fileExists, readJson, writeJson } from "./common.mjs";
import {
  assertPathInside,
  codexBundleEntries,
  copyBundleEntries,
  readExistingJsonOrThrow,
  removePathIfExists,
  removeTargetIfNeeded,
  resolveHomeDir,
} from "./install_shared.mjs";

function updateCodexMarketplace(marketplaceFile, existingMarketplace = null) {
  const marketplace = existingMarketplace
    || (fileExists(marketplaceFile)
      ? readJson(marketplaceFile)
      : {
        name: "local-plugins",
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

function removeCodexMarketplaceEntry(marketplaceFile, existingMarketplace = null) {
  if (!fileExists(marketplaceFile)) {
    return false;
  }

  const marketplace = existingMarketplace || readJson(marketplaceFile);
  const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  const nextPlugins = plugins.filter((plugin) => plugin?.name !== "helloloop");
  if (nextPlugins.length === plugins.length) {
    return false;
  }

  marketplace.plugins = nextPlugins;
  writeJson(marketplaceFile, marketplace);
  return true;
}

export function installCodexHost(bundleRoot, options = {}) {
  const resolvedCodexHome = resolveHomeDir(options.codexHome, ".codex");
  const targetPluginsRoot = path.join(resolvedCodexHome, "plugins");
  const targetPluginRoot = path.join(targetPluginsRoot, "helloloop");
  const marketplaceFile = path.join(resolvedCodexHome, ".agents", "plugins", "marketplace.json");
  const manifestFile = path.join(bundleRoot, ".codex-plugin", "plugin.json");
  const existingMarketplace = readExistingJsonOrThrow(marketplaceFile, "Codex marketplace 配置");

  if (!fileExists(manifestFile)) {
    throw new Error(`未找到 Codex 插件 manifest：${manifestFile}`);
  }

  assertPathInside(resolvedCodexHome, targetPluginRoot, "Codex 目标插件目录");
  removeTargetIfNeeded(targetPluginRoot, options.force);

  ensureDir(targetPluginsRoot);
  ensureDir(targetPluginRoot);
  copyBundleEntries(bundleRoot, targetPluginRoot, codexBundleEntries);
  removePathIfExists(path.join(targetPluginRoot, ".git"));

  ensureDir(path.dirname(marketplaceFile));
  updateCodexMarketplace(marketplaceFile, existingMarketplace);

  return {
    host: "codex",
    displayName: "Codex",
    targetRoot: targetPluginRoot,
    marketplaceFile,
  };
}

export function uninstallCodexHost(options = {}) {
  const resolvedCodexHome = resolveHomeDir(options.codexHome, ".codex");
  const targetPluginRoot = path.join(resolvedCodexHome, "plugins", "helloloop");
  const marketplaceFile = path.join(resolvedCodexHome, ".agents", "plugins", "marketplace.json");
  const existingMarketplace = readExistingJsonOrThrow(marketplaceFile, "Codex marketplace 配置");

  const removedPlugin = removePathIfExists(targetPluginRoot);
  const removedMarketplace = removeCodexMarketplaceEntry(marketplaceFile, existingMarketplace);

  return {
    host: "codex",
    displayName: "Codex",
    targetRoot: targetPluginRoot,
    removed: removedPlugin || removedMarketplace,
    marketplaceFile,
  };
}

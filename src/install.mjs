import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ensureDir, fileExists, readJson, writeJson } from "./common.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const runtimeBundleEntries = [
  ".codex-plugin",
  "README.md",
  "bin",
  "package.json",
  "scripts",
  "skills",
  "src",
  "templates",
];

function resolveCodexHome(codexHome) {
  return path.resolve(codexHome || path.join(os.homedir(), ".codex"));
}

function assertPathInside(parentDir, targetDir, label) {
  const relative = path.relative(parentDir, targetDir);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} 超出允许范围：${targetDir}`);
  }
}

function copyBundleEntries(bundleRoot, targetPluginRoot) {
  for (const entry of runtimeBundleEntries) {
    const sourcePath = path.join(bundleRoot, entry);
    if (!fileExists(sourcePath)) {
      continue;
    }

    fs.cpSync(sourcePath, path.join(targetPluginRoot, entry), {
      force: true,
      recursive: true,
    });
  }
}

function updateMarketplace(marketplaceFile) {
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

  marketplace.plugins = marketplace.plugins.filter((plugin) => plugin?.name !== "autoloop");

  const existingIndex = marketplace.plugins.findIndex((plugin) => plugin?.name === "helloloop");
  if (existingIndex >= 0) {
    marketplace.plugins.splice(existingIndex, 1, nextEntry);
  } else {
    marketplace.plugins.push(nextEntry);
  }

  writeJson(marketplaceFile, marketplace);
}

export function installPluginBundle(options = {}) {
  const bundleRoot = path.resolve(options.bundleRoot || path.join(__dirname, ".."));
  const resolvedCodexHome = resolveCodexHome(options.codexHome);
  const targetPluginsRoot = path.join(resolvedCodexHome, "plugins");
  const targetPluginRoot = path.join(targetPluginsRoot, "helloloop");
  const legacyPluginRoot = path.join(targetPluginsRoot, "autoloop");
  const marketplaceFile = path.join(resolvedCodexHome, ".agents", "plugins", "marketplace.json");
  const manifestFile = path.join(bundleRoot, ".codex-plugin", "plugin.json");

  if (!fileExists(manifestFile)) {
    throw new Error(`未找到插件 manifest：${manifestFile}`);
  }

  assertPathInside(resolvedCodexHome, targetPluginRoot, "目标插件目录");

  if (fileExists(targetPluginRoot)) {
    if (!options.force) {
      throw new Error(`目标插件目录已存在：${targetPluginRoot}。若要覆盖，请追加 --force。`);
    }
    fs.rmSync(targetPluginRoot, { recursive: true, force: true });
  }

  if (fileExists(legacyPluginRoot)) {
    fs.rmSync(legacyPluginRoot, { recursive: true, force: true });
  }

  ensureDir(targetPluginsRoot);
  ensureDir(targetPluginRoot);
  copyBundleEntries(bundleRoot, targetPluginRoot);

  const gitMetadataPath = path.join(targetPluginRoot, ".git");
  if (fileExists(gitMetadataPath)) {
    fs.rmSync(gitMetadataPath, { recursive: true, force: true });
  }

  ensureDir(path.dirname(marketplaceFile));
  updateMarketplace(marketplaceFile);

  return {
    targetPluginRoot,
    marketplaceFile,
  };
}

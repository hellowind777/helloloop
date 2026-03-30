import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureDir, fileExists, readJson, writeJson } from "./common.mjs";

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

export const codexBundleEntries = runtimeBundleEntries.filter((entry) => ![
  ".claude-plugin",
  "hosts",
].includes(entry));

export const supportedHosts = ["codex", "claude", "gemini"];
export const CLAUDE_MARKETPLACE_NAME = "helloloop-local";
export const CLAUDE_PLUGIN_KEY = "helloloop@helloloop-local";

export function resolveHomeDir(homeDir, defaultDirName) {
  return path.resolve(homeDir || path.join(os.homedir(), defaultDirName));
}

export function resolveCodexLocalRoot(codexHome) {
  const resolvedCodexHome = resolveHomeDir(codexHome, ".codex");
  if (path.basename(resolvedCodexHome).toLowerCase() === ".codex") {
    return path.dirname(resolvedCodexHome);
  }
  return resolvedCodexHome;
}

export function assertPathInside(parentDir, targetDir, label) {
  const relative = path.relative(parentDir, targetDir);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} 超出允许范围：${targetDir}`);
  }
}

function sleepSync(ms) {
  const shared = new SharedArrayBuffer(4);
  const view = new Int32Array(shared);
  Atomics.wait(view, 0, 0, Math.max(0, ms));
}

function isRetryableRemoveError(error) {
  const code = String(error?.code || "").toUpperCase();
  return ["ENOTEMPTY", "EPERM", "EBUSY"].includes(code);
}

function removeDirectoryWithRetries(targetPath) {
  const retryDelaysMs = [0, 50, 150, 300];
  let lastError = null;

  for (const delayMs of retryDelaysMs) {
    if (delayMs > 0) {
      sleepSync(delayMs);
    }
    try {
      fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableRemoveError(error)) {
        throw error;
      }
    }
  }

  const tempPath = `${targetPath}.removing-${Date.now()}`;
  fs.renameSync(targetPath, tempPath);
  try {
    fs.rmSync(tempPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (error) {
    throw lastError || error;
  }
}

function removeFsPath(targetPath) {
  const stats = fs.lstatSync(targetPath);
  if (stats.isDirectory() && !stats.isSymbolicLink()) {
    removeDirectoryWithRetries(targetPath);
    return;
  }
  fs.rmSync(targetPath, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 });
}

export function removeTargetIfNeeded(targetPath, force) {
  if (!fileExists(targetPath)) {
    return;
  }
  if (!force) {
    throw new Error(`目标目录已存在：${targetPath}。若要覆盖，请追加 --force。`);
  }
  removeFsPath(targetPath);
}

export function removePathIfExists(targetPath) {
  if (!fileExists(targetPath)) {
    return false;
  }
  removeFsPath(targetPath);
  return true;
}

export function copyBundleEntries(bundleRoot, targetRoot, entries) {
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

export function copyDirectory(sourceRoot, targetRoot) {
  fs.cpSync(sourceRoot, targetRoot, {
    force: true,
    recursive: true,
  });
}

export function loadOrInitJson(filePath, fallbackValue) {
  if (!fileExists(filePath)) {
    return fallbackValue;
  }
  return readJson(filePath);
}

export function readExistingJsonOrThrow(filePath, label) {
  if (!fileExists(filePath)) {
    return null;
  }
  try {
    return readJson(filePath);
  } catch (error) {
    throw new Error(`${label} 不是合法 JSON：${filePath}`);
  }
}

export function writeJsonFile(filePath, value) {
  ensureDir(path.dirname(filePath));
  writeJson(filePath, value);
}

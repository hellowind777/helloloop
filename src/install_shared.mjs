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

export function assertPathInside(parentDir, targetDir, label) {
  const relative = path.relative(parentDir, targetDir);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} 超出允许范围：${targetDir}`);
  }
}

export function removeTargetIfNeeded(targetPath, force) {
  if (!fileExists(targetPath)) {
    return;
  }
  if (!force) {
    throw new Error(`目标目录已存在：${targetPath}。若要覆盖，请追加 --force。`);
  }
  fs.rmSync(targetPath, { recursive: true, force: true });
}

export function removePathIfExists(targetPath) {
  if (!fileExists(targetPath)) {
    return false;
  }
  fs.rmSync(targetPath, { recursive: true, force: true });
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

export function writeJsonFile(filePath, value) {
  ensureDir(path.dirname(filePath));
  writeJson(filePath, value);
}

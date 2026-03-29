import path from "node:path";

import { ensureDir, fileExists } from "./common.mjs";
import {
  assertPathInside,
  copyDirectory,
  removePathIfExists,
  removeTargetIfNeeded,
  resolveHomeDir,
} from "./install_shared.mjs";

export function installGeminiHost(bundleRoot, options = {}) {
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

export function uninstallGeminiHost(options = {}) {
  const resolvedGeminiHome = resolveHomeDir(options.geminiHome, ".gemini");
  const targetExtensionRoot = path.join(resolvedGeminiHome, "extensions", "helloloop");

  return {
    host: "gemini",
    displayName: "Gemini",
    targetRoot: targetExtensionRoot,
    removed: removePathIfExists(targetExtensionRoot),
  };
}

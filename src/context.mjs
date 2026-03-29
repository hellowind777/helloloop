import path from "node:path";
import { fileURLToPath } from "node:url";

import { fileExists, resolveFrom } from "./common.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolRoot = path.resolve(__dirname, "..");
const defaultConfigDirName = ".helloloop";
const legacyConfigDirName = ".helloagents/helloloop";

function resolveConfigDirName(repoRoot, explicitConfigDirName) {
  if (explicitConfigDirName) {
    return explicitConfigDirName;
  }

  const defaultConfigRoot = resolveFrom(repoRoot, ...defaultConfigDirName.split("/"));
  if (fileExists(defaultConfigRoot)) {
    return defaultConfigDirName;
  }

  const legacyConfigRoot = resolveFrom(repoRoot, ...legacyConfigDirName.split("/"));
  if (fileExists(legacyConfigRoot)) {
    return legacyConfigDirName;
  }

  return defaultConfigDirName;
}

export function createContext(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const configDirName = resolveConfigDirName(repoRoot, options.configDirName);
  const configRoot = resolveFrom(repoRoot, ...configDirName.split("/"));

  return {
    repoRoot,
    toolRoot,
    bundleRoot: toolRoot,
    templatesDir: resolveFrom(toolRoot, "templates"),
    pluginManifestFile: resolveFrom(toolRoot, ".codex-plugin", "plugin.json"),
    skillFile: resolveFrom(toolRoot, "skills", "helloloop", "SKILL.md"),
    installScriptFile: resolveFrom(toolRoot, "scripts", "install-home-plugin.ps1"),
    docsRoot: resolveFrom(toolRoot, "docs"),
    configDirName,
    configRoot,
    backlogFile: resolveFrom(configRoot, "backlog.json"),
    policyFile: resolveFrom(configRoot, "policy.json"),
    projectFile: resolveFrom(configRoot, "project.json"),
    statusFile: resolveFrom(configRoot, "status.json"),
    stateFile: resolveFrom(configRoot, "STATE.md"),
    runsDir: resolveFrom(configRoot, "runs"),
    repoStateFile: resolveFrom(repoRoot, ".helloagents", "STATE.md"),
    repoVerifyFile: resolveFrom(repoRoot, ".helloagents", "verify.yaml"),
  };
}


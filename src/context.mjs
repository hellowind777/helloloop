import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveFrom } from "./common.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolRoot = path.resolve(__dirname, "..");
const defaultConfigDirName = ".helloloop";

export function createContext(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const configDirName = options.configDirName || defaultConfigDirName;
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
    supervisorRoot: resolveFrom(configRoot, "supervisor"),
    supervisorRequestFile: resolveFrom(configRoot, "supervisor", "request.json"),
    supervisorStateFile: resolveFrom(configRoot, "supervisor", "state.json"),
    supervisorResultFile: resolveFrom(configRoot, "supervisor", "result.json"),
    supervisorPauseFile: resolveFrom(configRoot, "supervisor", "pause.json"),
    supervisorStdoutFile: resolveFrom(configRoot, "supervisor", "stdout.log"),
    supervisorStderrFile: resolveFrom(configRoot, "supervisor", "stderr.log"),
    repoVerifyFile: resolveFrom(repoRoot, ".helloagents", "verify.yaml"),
  };
}

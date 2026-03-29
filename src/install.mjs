import path from "node:path";
import { fileURLToPath } from "node:url";

import { installClaudeHost, uninstallClaudeHost } from "./install_claude.mjs";
import { installCodexHost, uninstallCodexHost } from "./install_codex.mjs";
import { installGeminiHost, uninstallGeminiHost } from "./install_gemini.mjs";
import { runtimeBundleEntries, supportedHosts } from "./install_shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

export { runtimeBundleEntries };

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

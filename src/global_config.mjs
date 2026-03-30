import { fileExists } from "./common.mjs";
import { loadUserSettingsDocument, resolveUserSettingsFile } from "./engine_selection_settings.mjs";

export function resolveGlobalConfigFile(explicitFile = "") {
  return resolveUserSettingsFile(explicitFile);
}

export function loadGlobalConfig(options = {}) {
  const configFile = resolveGlobalConfigFile(options.globalConfigFile);
  const loaded = loadUserSettingsDocument({
    userSettingsFile: configFile,
  });

  return {
    ...loaded,
    _meta: {
      configFile,
      exists: fileExists(configFile),
    },
  };
}

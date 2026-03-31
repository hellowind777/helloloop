import { loadGlobalConfig } from "./global_config.mjs";
import {
  normalizeObserverRetrySettings,
  normalizeSupervisorKeepAliveSettings,
  normalizeTerminalConcurrencySettings,
} from "./runtime_settings.mjs";

export function loadRuntimeSettings(options = {}) {
  const globalConfig = loadGlobalConfig({
    globalConfigFile: options.globalConfigFile,
  });

  return {
    terminalConcurrency: normalizeTerminalConcurrencySettings(globalConfig?.runtime?.terminalConcurrency || {}),
    observerRetry: normalizeObserverRetrySettings(globalConfig?.runtime?.observerRetry || {}),
    supervisorKeepAlive: normalizeSupervisorKeepAliveSettings(globalConfig?.runtime?.supervisorKeepAlive || {}),
    _meta: globalConfig?._meta || {},
  };
}

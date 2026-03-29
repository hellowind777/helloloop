import os from "node:os";
import path from "node:path";

import { fileExists, readJson, writeJson } from "./common.mjs";
import { normalizeEngineName } from "./engine_metadata.mjs";

function defaultUserSettings() {
  return {
    defaultEngine: "",
    lastSelectedEngine: "",
  };
}

export function resolveUserSettingsFile(userSettingsFile = "") {
  return userSettingsFile
    || String(process.env.HELLOLOOP_USER_SETTINGS_FILE || "").trim()
    || path.join(os.homedir(), ".helloloop", "settings.json");
}

export function loadUserSettings(options = {}) {
  const settingsFile = resolveUserSettingsFile(options.userSettingsFile);
  if (!fileExists(settingsFile)) {
    return defaultUserSettings();
  }

  const settings = readJson(settingsFile);
  return {
    defaultEngine: normalizeEngineName(settings?.defaultEngine),
    lastSelectedEngine: normalizeEngineName(settings?.lastSelectedEngine),
  };
}

export function saveUserSettings(settings, options = {}) {
  writeJson(resolveUserSettingsFile(options.userSettingsFile), {
    defaultEngine: normalizeEngineName(settings?.defaultEngine),
    lastSelectedEngine: normalizeEngineName(settings?.lastSelectedEngine),
  });
}

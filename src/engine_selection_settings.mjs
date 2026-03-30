import os from "node:os";
import path from "node:path";

import { fileExists, readJson, writeJson } from "./common.mjs";
import { normalizeEngineName } from "./engine_metadata.mjs";

function defaultEmailNotificationSettings() {
  return {
    enabled: false,
    to: [],
    from: "",
    smtp: {
      host: "",
      port: 465,
      secure: true,
      starttls: false,
      username: "",
      usernameEnv: "",
      password: "",
      passwordEnv: "",
      timeoutSeconds: 30,
      rejectUnauthorized: true,
    },
  };
}

function defaultUserSettings() {
  return {
    defaultEngine: "",
    lastSelectedEngine: "",
    notifications: {
      email: defaultEmailNotificationSettings(),
    },
  };
}

export function resolveUserSettingsHome() {
  return String(process.env.HELLOLOOP_HOME || "").trim()
    || path.join(os.homedir(), ".helloloop");
}

export function resolveUserSettingsFile(userSettingsFile = "") {
  return userSettingsFile
    || String(process.env.HELLOLOOP_SETTINGS_FILE || "").trim()
    || path.join(resolveUserSettingsHome(), "settings.json");
}

function normalizeEmailNotificationSettings(emailSettings = {}) {
  const defaults = defaultEmailNotificationSettings();
  const smtp = emailSettings?.smtp || {};

  return {
    ...defaults,
    ...emailSettings,
    to: Array.isArray(emailSettings?.to)
      ? emailSettings.to.map((item) => String(item || "").trim()).filter(Boolean)
      : (typeof emailSettings?.to === "string" && emailSettings.to.trim() ? [emailSettings.to.trim()] : []),
    smtp: {
      ...defaults.smtp,
      ...smtp,
    },
  };
}

export function loadUserSettingsDocument(options = {}) {
  const settingsFile = resolveUserSettingsFile(options.userSettingsFile);
  const settings = fileExists(settingsFile) ? readJson(settingsFile) : {};

  return {
    ...defaultUserSettings(),
    ...settings,
    defaultEngine: normalizeEngineName(settings?.defaultEngine),
    lastSelectedEngine: normalizeEngineName(settings?.lastSelectedEngine),
    notifications: {
      ...(settings?.notifications || {}),
      email: normalizeEmailNotificationSettings(settings?.notifications?.email || {}),
    },
  };
}

export function loadUserSettings(options = {}) {
  const settings = loadUserSettingsDocument(options);
  return {
    defaultEngine: settings.defaultEngine,
    lastSelectedEngine: settings.lastSelectedEngine,
  };
}

export function saveUserSettings(settings, options = {}) {
  const currentSettings = loadUserSettingsDocument(options);
  writeJson(resolveUserSettingsFile(options.userSettingsFile), {
    ...currentSettings,
    ...settings,
    defaultEngine: normalizeEngineName(settings?.defaultEngine ?? currentSettings.defaultEngine),
    lastSelectedEngine: normalizeEngineName(settings?.lastSelectedEngine ?? currentSettings.lastSelectedEngine),
    notifications: {
      ...(currentSettings.notifications || {}),
      ...(settings?.notifications || {}),
      email: normalizeEmailNotificationSettings(
        settings?.notifications?.email ?? currentSettings.notifications?.email ?? {},
      ),
    },
  });
}

import os from "node:os";
import path from "node:path";

import { fileExists, readJson, readText, timestampForFile, writeJson, writeText } from "./common.mjs";
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

function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function syncValueBySchema(schemaValue, currentValue) {
  if (!isPlainObject(schemaValue)) {
    return currentValue === undefined ? cloneJsonValue(schemaValue) : currentValue;
  }

  const source = isPlainObject(currentValue) ? currentValue : {};
  const next = {};
  for (const [key, childSchema] of Object.entries(schemaValue)) {
    next[key] = syncValueBySchema(childSchema, Object.hasOwn(source, key) ? source[key] : undefined);
  }
  return next;
}

function mergeValueBySchema(schemaValue, baseValue, patchValue) {
  if (!isPlainObject(schemaValue)) {
    return patchValue === undefined ? baseValue : patchValue;
  }

  const baseObject = isPlainObject(baseValue) ? baseValue : {};
  const patchObject = isPlainObject(patchValue) ? patchValue : {};
  const next = {};
  for (const [key, childSchema] of Object.entries(schemaValue)) {
    const nextBaseValue = Object.hasOwn(baseObject, key) ? baseObject[key] : undefined;
    const hasPatchedKey = isPlainObject(patchValue) && Object.hasOwn(patchObject, key);
    next[key] = mergeValueBySchema(
      childSchema,
      nextBaseValue,
      hasPatchedKey ? patchObject[key] : undefined,
    );
  }
  return next;
}

export function syncUserSettingsShape(settings = {}) {
  return syncValueBySchema(defaultUserSettings(), settings);
}

function readRawUserSettingsDocument(options = {}) {
  const settingsFile = resolveUserSettingsFile(options.userSettingsFile);
  const settings = fileExists(settingsFile) ? readJson(settingsFile) : {};
  return syncUserSettingsShape(settings);
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
  const settings = readRawUserSettingsDocument(options);

  return {
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
  const currentSettings = readRawUserSettingsDocument(options);
  const mergedSettings = mergeValueBySchema(
    defaultUserSettings(),
    currentSettings,
    settings,
  );

  writeJson(resolveUserSettingsFile(options.userSettingsFile), {
    ...syncUserSettingsShape(mergedSettings),
  });
}

export function syncUserSettingsFile(options = {}) {
  const settingsFile = resolveUserSettingsFile(options.userSettingsFile);
  const defaults = defaultUserSettings();

  if (!fileExists(settingsFile)) {
    writeJson(settingsFile, defaults);
    return {
      settingsFile,
      action: "created",
      backupFile: "",
    };
  }

  let parsed;
  try {
    parsed = readJson(settingsFile);
  } catch (error) {
    const backupFile = `${settingsFile}.invalid-${timestampForFile()}.bak`;
    writeText(backupFile, readText(settingsFile));
    writeJson(settingsFile, defaults);
    return {
      settingsFile,
      action: "reset_invalid_json",
      backupFile,
      error: String(error?.message || error || ""),
    };
  }

  writeJson(settingsFile, syncUserSettingsShape(parsed));
  return {
    settingsFile,
    action: "synced",
    backupFile: "",
  };
}

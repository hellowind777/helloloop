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

function defaultTerminalConcurrencySettings() {
  return {
    enabled: true,
    visibleMax: 8,
    backgroundMax: 8,
    totalMax: 8,
  };
}

function defaultUserSettings() {
  return {
    defaultEngine: "",
    lastSelectedEngine: "",
    notifications: {
      email: defaultEmailNotificationSettings(),
    },
    runtime: {
      terminalConcurrency: defaultTerminalConcurrencySettings(),
    },
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizePositiveInteger(value, fallback, minimum = 1) {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < minimum) {
    return fallback;
  }
  return numericValue;
}

function normalizeTerminalConcurrencySettings(settings = {}) {
  const defaults = defaultTerminalConcurrencySettings();
  return {
    enabled: normalizeBoolean(settings?.enabled, defaults.enabled),
    visibleMax: normalizePositiveInteger(settings?.visibleMax, defaults.visibleMax, 0),
    backgroundMax: normalizePositiveInteger(settings?.backgroundMax, defaults.backgroundMax, 0),
    totalMax: normalizePositiveInteger(settings?.totalMax, defaults.totalMax, 0),
  };
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
    enabled: normalizeBoolean(emailSettings?.enabled, defaults.enabled),
    to: Array.isArray(emailSettings?.to)
      ? emailSettings.to.map((item) => String(item || "").trim()).filter(Boolean)
      : defaults.to,
    from: normalizeString(emailSettings?.from, defaults.from),
    smtp: {
      host: normalizeString(smtp?.host, defaults.smtp.host),
      port: normalizePositiveInteger(smtp?.port, defaults.smtp.port),
      secure: normalizeBoolean(smtp?.secure, defaults.smtp.secure),
      starttls: normalizeBoolean(smtp?.starttls, defaults.smtp.starttls),
      username: normalizeString(smtp?.username, defaults.smtp.username),
      usernameEnv: normalizeString(smtp?.usernameEnv, defaults.smtp.usernameEnv),
      password: typeof smtp?.password === "string" ? smtp.password : defaults.smtp.password,
      passwordEnv: normalizeString(smtp?.passwordEnv, defaults.smtp.passwordEnv),
      timeoutSeconds: normalizePositiveInteger(smtp?.timeoutSeconds, defaults.smtp.timeoutSeconds),
      rejectUnauthorized: normalizeBoolean(smtp?.rejectUnauthorized, defaults.smtp.rejectUnauthorized),
    },
  };
}

export function syncUserSettingsShape(settings = {}) {
  return {
    defaultEngine: normalizeEngineName(settings?.defaultEngine) || "",
    lastSelectedEngine: normalizeEngineName(settings?.lastSelectedEngine) || "",
    notifications: {
      email: normalizeEmailNotificationSettings(settings?.notifications?.email || {}),
    },
    runtime: {
      terminalConcurrency: normalizeTerminalConcurrencySettings(settings?.runtime?.terminalConcurrency || {}),
    },
  };
}

function readRawUserSettingsDocument(options = {}) {
  const settingsFile = resolveUserSettingsFile(options.userSettingsFile);
  const settings = fileExists(settingsFile) ? readJson(settingsFile) : {};
  return syncUserSettingsShape(settings);
}

export function loadUserSettingsDocument(options = {}) {
  return readRawUserSettingsDocument(options);
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

function tryParseUserSettingsText(text) {
  return JSON.parse(String(text || ""));
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

  const firstText = readText(settingsFile);
  try {
    const parsed = tryParseUserSettingsText(firstText);
    writeJson(settingsFile, syncUserSettingsShape(parsed));
    return {
      settingsFile,
      action: "synced",
      backupFile: "",
    };
  } catch (error) {
    const retryText = readText(settingsFile);
    if (retryText !== firstText) {
      try {
        const parsed = tryParseUserSettingsText(retryText);
        writeJson(settingsFile, syncUserSettingsShape(parsed));
        return {
          settingsFile,
          action: "synced",
          backupFile: "",
          recoveredAfterRetry: true,
        };
      } catch {
      }
    }

    const backupFile = `${settingsFile}.invalid-${timestampForFile()}.bak`;
    writeText(backupFile, retryText);
    writeJson(settingsFile, defaults);
    return {
      settingsFile,
      action: "reset_invalid_json",
      backupFile,
      error: String(error?.message || error || ""),
    };
  }
}

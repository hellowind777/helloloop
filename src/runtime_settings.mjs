function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeNonNegativeInteger(value, fallbackValue) {
  if (value === null || value === undefined || value === "") {
    return fallbackValue;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallbackValue;
  }
  return Math.floor(parsed);
}

function normalizePositiveInteger(value, fallbackValue, minimum = 1) {
  const parsed = normalizeNonNegativeInteger(value, fallbackValue);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    return fallbackValue;
  }
  return parsed;
}

function normalizeSecondsList(values, fallbackValues) {
  if (!Array.isArray(values) || !values.length) {
    return [...fallbackValues];
  }
  const normalized = values
    .map((item) => normalizePositiveInteger(item, 0))
    .filter((item) => item > 0);
  return normalized.length ? normalized : [...fallbackValues];
}

export function defaultTerminalConcurrencySettings() {
  return {
    enabled: true,
    visibleMax: 8,
    backgroundMax: 8,
    totalMax: 8,
  };
}

export function defaultObserverRetrySettings() {
  return {
    enabled: true,
    missingPollsBeforeRetry: 3,
    retryDelaysSeconds: [2, 5, 10, 15, 30, 60],
    maxRetryCount: 0,
  };
}

export function defaultSupervisorKeepAliveSettings() {
  return {
    enabled: true,
    restartDelaysSeconds: [2, 5, 10, 15, 30, 60],
    maxRestartCount: 0,
  };
}

export function normalizeTerminalConcurrencySettings(settings = {}) {
  const defaults = defaultTerminalConcurrencySettings();
  return {
    enabled: normalizeBoolean(settings?.enabled, defaults.enabled),
    visibleMax: normalizeNonNegativeInteger(settings?.visibleMax, defaults.visibleMax),
    backgroundMax: normalizeNonNegativeInteger(settings?.backgroundMax, defaults.backgroundMax),
    totalMax: normalizeNonNegativeInteger(settings?.totalMax, defaults.totalMax),
  };
}

export function normalizeObserverRetrySettings(settings = {}) {
  const defaults = defaultObserverRetrySettings();
  return {
    enabled: normalizeBoolean(settings?.enabled, defaults.enabled),
    missingPollsBeforeRetry: normalizePositiveInteger(
      settings?.missingPollsBeforeRetry,
      defaults.missingPollsBeforeRetry,
    ),
    retryDelaysSeconds: normalizeSecondsList(settings?.retryDelaysSeconds, defaults.retryDelaysSeconds),
    maxRetryCount: normalizeNonNegativeInteger(settings?.maxRetryCount, defaults.maxRetryCount),
  };
}

export function normalizeSupervisorKeepAliveSettings(settings = {}) {
  const defaults = defaultSupervisorKeepAliveSettings();
  return {
    enabled: normalizeBoolean(settings?.enabled, defaults.enabled),
    restartDelaysSeconds: normalizeSecondsList(settings?.restartDelaysSeconds, defaults.restartDelaysSeconds),
    maxRestartCount: normalizeNonNegativeInteger(settings?.maxRestartCount, defaults.maxRestartCount),
  };
}

export function pickRetryDelaySeconds(delays, attemptNumber) {
  const values = Array.isArray(delays) && delays.length
    ? delays.map((item) => normalizePositiveInteger(item, 0)).filter((item) => item > 0)
    : [];
  if (!values.length) {
    return 0;
  }
  const index = Math.max(0, Math.min(Number(attemptNumber || 1) - 1, values.length - 1));
  return values[index];
}

export function hasRetryBudget(maxRetryCount, nextAttemptNumber) {
  return Number(maxRetryCount || 0) <= 0 || Number(nextAttemptNumber || 0) <= Number(maxRetryCount || 0);
}

import { getEngineDisplayName } from "./engine_metadata.mjs";
import { tailText } from "./common.mjs";

const defaultRuntimeRecoveryPolicy = {
  enabled: true,
  allowEngineSwitch: false,
  heartbeatIntervalSeconds: 60,
  stallWarningSeconds: 900,
  maxIdleSeconds: 2700,
  killGraceSeconds: 10,
  maxPhaseRecoveries: 4,
  retryDelaysSeconds: [120, 300, 900, 1800],
  retryOnUnknownFailure: true,
  maxUnknownRecoveries: 1,
};

const HARD_STOP_MATCHERS = [
  {
    code: "invalid_request",
    reason: "当前错误更像请求、参数、协议或输出格式问题，继续原样自动重试大概率无效。",
    patterns: [
      " 400 ",
      "400 bad request",
      "bad request",
      "invalid request",
      "invalid argument",
      "invalid_argument",
      "failed to parse",
      "parse error",
      "malformed",
      "schema validation",
      "json schema",
      "unexpected argument",
      "unknown option",
    ],
  },
  {
    code: "auth",
    reason: "当前错误更像登录、鉴权、订阅或权限问题，需要先修复环境。",
    patterns: [
      "401",
      "403",
      "unauthorized",
      "forbidden",
      "not authenticated",
      "authentication",
      "login",
      "sign in",
      "api key",
      "token",
      "subscription",
      "insufficient permissions",
    ],
  },
  {
    code: "environment",
    reason: "当前错误更像本地 CLI 缺失、权限不足或文件系统问题，继续自动重试没有意义。",
    patterns: [
      "command not found",
      "is not recognized",
      "enoent",
      "no such file or directory",
      "permission denied",
      "access is denied",
    ],
  },
];

const RECOVERABLE_MATCHERS = [
  {
    code: "rate_limit",
    reason: "当前引擎可能遇到配额、限流或临时容量不足。",
    patterns: [
      "429",
      "rate limit",
      "too many requests",
      "quota",
      "credit",
      "usage limit",
      "capacity",
      "overloaded",
      "insufficient balance",
      "try again later",
    ],
  },
  {
    code: "server",
    reason: "当前引擎可能遇到临时服务端错误。",
    patterns: [
      "500",
      "501",
      "502",
      "503",
      "504",
      "internal server error",
      "bad gateway",
      "service unavailable",
      "gateway timeout",
      "server error",
      "upstream",
      "temporarily unavailable",
    ],
  },
  {
    code: "network",
    reason: "当前引擎可能遇到临时网络、连接或结果流中断。",
    patterns: [
      "network error",
      "fetch failed",
      "econnreset",
      "etimedout",
      "timed out",
      "timeout",
      "connection reset",
      "connection aborted",
      "connection closed",
      "stream closed",
      "socket hang up",
      "transport error",
      "broken pipe",
      "http2",
    ],
  },
];

function normalizeSeconds(value, fallback) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    return fallback;
  }
  return numberValue;
}

function normalizeSecondsList(value, fallback) {
  if (!Array.isArray(value) || !value.length) {
    return fallback;
  }
  const normalized = value
    .map((item) => normalizeSeconds(item, -1))
    .filter((item) => item >= 0);
  return normalized.length ? normalized : fallback;
}

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function hasMatcher(normalizedText, matcher) {
  return matcher.patterns.some((pattern) => normalizedText.includes(String(pattern).toLowerCase()));
}

export function resolveRuntimeRecoveryPolicy(policy = {}) {
  const configured = policy?.runtimeRecovery || {};
  return {
    enabled: configured.enabled !== false,
    allowEngineSwitch: configured.allowEngineSwitch === true,
    heartbeatIntervalSeconds: normalizeSeconds(
      configured.heartbeatIntervalSeconds,
      defaultRuntimeRecoveryPolicy.heartbeatIntervalSeconds,
    ),
    stallWarningSeconds: normalizeSeconds(
      configured.stallWarningSeconds,
      defaultRuntimeRecoveryPolicy.stallWarningSeconds,
    ),
    maxIdleSeconds: normalizeSeconds(
      configured.maxIdleSeconds,
      defaultRuntimeRecoveryPolicy.maxIdleSeconds,
    ),
    killGraceSeconds: normalizeSeconds(
      configured.killGraceSeconds,
      defaultRuntimeRecoveryPolicy.killGraceSeconds,
    ),
    maxPhaseRecoveries: Math.max(
      0,
      Math.trunc(normalizeSeconds(configured.maxPhaseRecoveries, defaultRuntimeRecoveryPolicy.maxPhaseRecoveries)),
    ),
    retryDelaysSeconds: normalizeSecondsList(
      configured.retryDelaysSeconds,
      defaultRuntimeRecoveryPolicy.retryDelaysSeconds,
    ),
    retryOnUnknownFailure: configured.retryOnUnknownFailure !== false,
    maxUnknownRecoveries: Math.max(
      0,
      Math.trunc(normalizeSeconds(configured.maxUnknownRecoveries, defaultRuntimeRecoveryPolicy.maxUnknownRecoveries)),
    ),
  };
}

export function selectRuntimeRecoveryDelayMs(recoveryPolicy, nextRecoveryIndex) {
  const delays = Array.isArray(recoveryPolicy?.retryDelaysSeconds) && recoveryPolicy.retryDelaysSeconds.length
    ? recoveryPolicy.retryDelaysSeconds
    : defaultRuntimeRecoveryPolicy.retryDelaysSeconds;
  const offset = Math.max(0, Number(nextRecoveryIndex || 1) - 1);
  const seconds = delays[Math.min(offset, delays.length - 1)] || 0;
  return Math.max(0, seconds) * 1000;
}

export function classifyRuntimeRecoveryFailure({
  result = {},
  recoveryPolicy = defaultRuntimeRecoveryPolicy,
  recoveryCount = 0,
} = {}) {
  const normalized = normalizeText([
    result.stderr,
    result.stdout,
    result.finalMessage,
    result.watchdogReason,
  ].filter(Boolean).join("\n"));

  if (result.watchdogTriggered || result.idleTimeout) {
    return {
      recoverable: true,
      code: "watchdog_idle",
      reason: "当前进程长时间没有可见进展，HelloLoop 已按看门狗策略终止并准备同引擎恢复。",
    };
  }

  for (const matcher of HARD_STOP_MATCHERS) {
    if (hasMatcher(normalized, matcher)) {
      return {
        recoverable: false,
        code: matcher.code,
        reason: matcher.reason,
      };
    }
  }

  for (const matcher of RECOVERABLE_MATCHERS) {
    if (hasMatcher(normalized, matcher)) {
      return {
        recoverable: true,
        code: matcher.code,
        reason: matcher.reason,
      };
    }
  }

  const emptyFailure = !normalized.trim() && !result.ok;
  if (emptyFailure) {
    return {
      recoverable: recoveryCount < (recoveryPolicy.maxUnknownRecoveries || 0),
      code: "empty_failure",
      reason: "当前失败没有返回可判定的错误文本，HelloLoop 将按无人值守策略先尝试一次同引擎恢复。",
    };
  }

  if (recoveryPolicy.retryOnUnknownFailure && recoveryCount < (recoveryPolicy.maxUnknownRecoveries || 0)) {
    return {
      recoverable: true,
      code: "unknown_failure",
      reason: "当前错误类型无法稳定归类，HelloLoop 将按无人值守策略先尝试一次同引擎恢复。",
    };
  }

  return {
    recoverable: false,
    code: "unknown_failure",
    reason: "当前错误无法判断为可安全自动恢复，已停止本轮自动恢复。",
  };
}

export function buildRuntimeRecoveryPrompt({
  basePrompt,
  engine,
  phaseLabel,
  failure,
  result = {},
  nextRecoveryIndex,
  maxRecoveries,
}) {
  return [
    basePrompt,
    "",
    "## HelloLoop 自动恢复上下文",
    `- 执行引擎：${getEngineDisplayName(engine)}`,
    `- 当前阶段：${phaseLabel}`,
    `- 自动恢复序号：${nextRecoveryIndex}/${maxRecoveries}`,
    `- 恢复原因：${failure?.reason || "当前引擎在上一轮执行中断，需要在同一主线下继续恢复。"}`,
    "",
    "你必须把当前仓库视为唯一事实源，直接复用已经完成的修改、进度和中间结果。",
    "不要从头重做，不要另起一套实现，不要等待用户，不要把“下一步建议”当成交付。",
    "先快速检查仓库当前状态与最近失败点，然后从中断位置继续完成本轮任务。",
    "",
    "最近失败片段：",
    `- stdout 尾部：${tailText(result.stdout, 10) || "无"}`,
    `- stderr 尾部：${tailText(result.stderr, 10) || "无"}`,
  ].join("\n");
}

export function renderRuntimeRecoverySummary(recoveryHistory = []) {
  if (!Array.isArray(recoveryHistory) || !recoveryHistory.length) {
    return "";
  }

  return [
    `HelloLoop 已按无人值守策略进行 ${recoveryHistory.length} 次同引擎自动恢复。`,
    ...recoveryHistory.map((item) => (
      `- 第 ${item.recoveryIndex} 次恢复：${item.reason}（等待 ${item.delaySeconds} 秒）`
    )),
  ].join("\n");
}

import { getEngineDisplayName } from "./engine_metadata.mjs";
import { tailText } from "./common.mjs";

const defaultRuntimeRecoveryPolicy = {
  enabled: true,
  heartbeatIntervalSeconds: 60,
  stallWarningSeconds: 900,
  maxIdleSeconds: 2700,
  killGraceSeconds: 10,
  healthProbeTimeoutSeconds: 120,
  hardRetryDelaysSeconds: [900, 900, 900, 900, 900],
  softRetryDelaysSeconds: [900, 900, 900, 900, 900, 1800, 1800, 3600, 5400, 7200, 9000, 10800],
};

const HARD_STOP_MATCHERS = [
  {
    code: "invalid_request",
    reason: "当前错误更像请求、参数、协议或输出格式问题，需要人工复核调用与提示词。",
    patterns: [
      " 400 ",
      "400 bad request",
      "bad request",
      "invalid request",
      "invalid schema",
      "invalid_json_schema",
      "invalid argument",
      "invalid_argument",
      "failed to parse",
      "parse error",
      "malformed",
      "schema validation",
      "json schema",
      "response_format",
      "unexpected argument",
      "unknown option",
    ],
  },
  {
    code: "auth",
    reason: "当前错误更像登录、鉴权、订阅或权限问题，需要等待环境恢复或人工修复。",
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
    code: "billing",
    reason: "当前错误更像额度、余额、支付或账单问题，短时间内通常不会自行消失。",
    patterns: [
      "payment required",
      "billing",
      "insufficient balance",
      "credit",
      "quota exceeded",
      "hard limit",
      "balance",
    ],
  },
  {
    code: "environment",
    reason: "当前错误更像本地 CLI 缺失、权限不足或文件系统问题，需要人工修复环境。",
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

const SOFT_STOP_MATCHERS = [
  {
    code: "rate_limit",
    reason: "当前引擎可能遇到配额、限流或临时容量不足。",
    patterns: [
      "429",
      "rate limit",
      "too many requests",
      "quota",
      "usage limit",
      "capacity",
      "overloaded",
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

function detectHttpStatusCode(normalizedText = "") {
  const matched = String(normalizedText || "").match(/\b(400|401|403|429|500|501|502|503|504)\b/u);
  return matched ? Number(matched[1]) : 0;
}

function hasMatcher(normalizedText, matcher) {
  return matcher.patterns.some((pattern) => normalizedText.includes(String(pattern).toLowerCase()));
}

function lastNonEmptyLine(text = "") {
  const lines = String(text || "").replaceAll("\r\n", "\n").split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = String(lines[index] || "").trim();
    if (line) {
      return line;
    }
  }
  return "";
}

function buildFailureInspectionText(result = {}) {
  return normalizeText([
    result.stderr,
    result.finalMessage,
    lastNonEmptyLine(result.stdout),
    tailText(result.watchdogReason, 10),
  ].filter(Boolean).join("\n"));
}

export function resolveRuntimeRecoveryPolicy(policy = {}) {
  const configured = policy?.runtimeRecovery || {};
  return {
    enabled: configured.enabled !== false,
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
    healthProbeTimeoutSeconds: normalizeSeconds(
      configured.healthProbeTimeoutSeconds,
      defaultRuntimeRecoveryPolicy.healthProbeTimeoutSeconds,
    ),
    hardRetryDelaysSeconds: normalizeSecondsList(
      configured.hardRetryDelaysSeconds,
      defaultRuntimeRecoveryPolicy.hardRetryDelaysSeconds,
    ),
    softRetryDelaysSeconds: normalizeSecondsList(
      configured.softRetryDelaysSeconds,
      defaultRuntimeRecoveryPolicy.softRetryDelaysSeconds,
    ),
  };
}

export function getRuntimeRecoverySchedule(recoveryPolicy, family = "soft") {
  return family === "hard"
    ? recoveryPolicy.hardRetryDelaysSeconds
    : recoveryPolicy.softRetryDelaysSeconds;
}

export function selectRuntimeRecoveryDelayMs(recoveryPolicy, family, nextRecoveryIndex) {
  const delays = getRuntimeRecoverySchedule(recoveryPolicy, family);
  const offset = Math.max(0, Number(nextRecoveryIndex || 1) - 1);
  const seconds = delays[offset] ?? null;
  return seconds == null ? -1 : Math.max(0, seconds) * 1000;
}

export function classifyRuntimeRecoveryFailure({ result = {} } = {}) {
  const normalized = buildFailureInspectionText(result);

  if (result.watchdogTriggered || result.idleTimeout) {
    return {
      code: "watchdog_idle",
      family: "soft",
      reason: "当前进程长时间没有可见进展，HelloLoop 将按软阻塞策略继续探测并恢复。",
      httpStatus: 0,
    };
  }

  for (const matcher of HARD_STOP_MATCHERS) {
    if (hasMatcher(normalized, matcher)) {
      return {
        code: matcher.code,
        family: "hard",
        reason: matcher.reason,
        httpStatus: detectHttpStatusCode(normalized),
      };
    }
  }

  for (const matcher of SOFT_STOP_MATCHERS) {
    if (hasMatcher(normalized, matcher)) {
      return {
        code: matcher.code,
        family: "soft",
        reason: matcher.reason,
        httpStatus: detectHttpStatusCode(normalized),
      };
    }
  }

  return {
    code: "unknown_failure",
    family: "soft",
    reason: "当前错误类型无法稳定归类，HelloLoop 将按软阻塞策略持续探测并恢复。",
    httpStatus: detectHttpStatusCode(normalized),
  };
}

export function buildEngineHealthProbePrompt(engine) {
  return [
    "HELLOLOOP_ENGINE_HEALTH_PROBE",
    `当前只做 ${getEngineDisplayName(engine)} 引擎健康探测。`,
    "禁止修改仓库、禁止执行开发任务、禁止输出解释。",
    "只需确认自己当前能正常接收请求并返回简短结果。",
    "若当前可用，请直接回复：HELLOLOOP_ENGINE_OK",
  ].join("\n");
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

export function renderRuntimeRecoverySummary(recoveryHistory = [], failure = null) {
  if (!Array.isArray(recoveryHistory) || !recoveryHistory.length) {
    return "";
  }

  return [
    `HelloLoop 已按${failure?.family === "hard" ? "硬阻塞" : "软阻塞"}策略进行 ${recoveryHistory.length} 次自动探测/恢复。`,
    ...recoveryHistory.map((item) => (
      `- 第 ${item.recoveryIndex} 次：等待 ${item.delaySeconds} 秒；探测 ${item.probeStatus || "unknown"}；任务 ${item.taskStatus || "unknown"}`
    )),
    "自动恢复额度已用尽，当前已暂停等待用户介入。",
  ].join("\n");
}

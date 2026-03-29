const SWITCHABLE_FAILURE_MATCHERS = [
  {
    code: "quota",
    reason: "当前引擎可能遇到额度、配额或限流问题。",
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
    ],
  },
  {
    code: "auth",
    reason: "当前引擎可能未登录、鉴权失效或权限不足。",
    patterns: [
      "not authenticated",
      "authentication",
      "unauthorized",
      "forbidden",
      "login",
      "api key",
      "token",
      "subscription",
      "setup-token",
      "sign in",
    ],
  },
];

export function classifySwitchableEngineFailure(detail = "") {
  const normalized = String(detail || "").toLowerCase();
  if (!normalized) {
    return null;
  }

  for (const matcher of SWITCHABLE_FAILURE_MATCHERS) {
    if (matcher.patterns.some((pattern) => normalized.includes(pattern))) {
      return {
        code: matcher.code,
        reason: matcher.reason,
      };
    }
  }

  return null;
}

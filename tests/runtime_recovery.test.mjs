import test from "node:test";
import assert from "node:assert/strict";

import { classifyRuntimeRecoveryFailure, resolveRuntimeRecoveryPolicy } from "../src/runtime_recovery.mjs";

test("运行时恢复分类会把 429 / 5xx / 网络中断识别为可自动恢复", () => {
  const policy = resolveRuntimeRecoveryPolicy();

  const rateLimit = classifyRuntimeRecoveryFailure({
    recoveryPolicy: policy,
    result: { ok: false, stderr: "429 rate limit exceeded" },
  });
  const server = classifyRuntimeRecoveryFailure({
    recoveryPolicy: policy,
    result: { ok: false, stderr: "503 service unavailable" },
  });
  const network = classifyRuntimeRecoveryFailure({
    recoveryPolicy: policy,
    result: { ok: false, stderr: "socket hang up" },
  });

  assert.equal(rateLimit.recoverable, true);
  assert.equal(server.recoverable, true);
  assert.equal(network.recoverable, true);
});

test("运行时恢复分类会把 watchdog 空转视为可自动恢复", () => {
  const policy = resolveRuntimeRecoveryPolicy();
  const failure = classifyRuntimeRecoveryFailure({
    recoveryPolicy: policy,
    result: { ok: false, watchdogTriggered: true, watchdogReason: "长时间无输出" },
  });

  assert.equal(failure.recoverable, true);
  assert.equal(failure.code, "watchdog_idle");
});

test("运行时恢复分类对未知错误只会保守自动恢复一次", () => {
  const policy = resolveRuntimeRecoveryPolicy({
    runtimeRecovery: {
      maxUnknownRecoveries: 1,
    },
  });

  const firstFailure = classifyRuntimeRecoveryFailure({
    recoveryPolicy: policy,
    recoveryCount: 0,
    result: { ok: false, stderr: "mystery transport broke" },
  });
  const secondFailure = classifyRuntimeRecoveryFailure({
    recoveryPolicy: policy,
    recoveryCount: 1,
    result: { ok: false, stderr: "mystery transport broke" },
  });

  assert.equal(firstFailure.recoverable, true);
  assert.equal(secondFailure.recoverable, false);
});

test("运行时恢复分类会把 400 / 鉴权错误识别为不可自动恢复", () => {
  const policy = resolveRuntimeRecoveryPolicy();

  const invalidRequest = classifyRuntimeRecoveryFailure({
    recoveryPolicy: policy,
    result: { ok: false, stderr: "400 bad request: invalid schema" },
  });
  const authFailure = classifyRuntimeRecoveryFailure({
    recoveryPolicy: policy,
    result: { ok: false, stderr: "not authenticated, please login" },
  });

  assert.equal(invalidRequest.recoverable, false);
  assert.equal(authFailure.recoverable, false);
});

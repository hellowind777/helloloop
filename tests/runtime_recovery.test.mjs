import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyRuntimeRecoveryFailure,
  getRuntimeRecoverySchedule,
  resolveRuntimeRecoveryPolicy,
} from "../src/runtime_recovery.mjs";

test("运行时恢复分类会把 429 / 5xx / 网络中断识别为软阻塞", () => {
  const rateLimit = classifyRuntimeRecoveryFailure({
    result: { ok: false, stderr: "429 rate limit exceeded" },
  });
  const server = classifyRuntimeRecoveryFailure({
    result: { ok: false, stderr: "503 service unavailable" },
  });
  const network = classifyRuntimeRecoveryFailure({
    result: { ok: false, stderr: "socket hang up" },
  });

  assert.equal(rateLimit.family, "soft");
  assert.equal(server.family, "soft");
  assert.equal(network.family, "soft");
});

test("运行时恢复分类会把 watchdog 空转视为软阻塞", () => {
  const failure = classifyRuntimeRecoveryFailure({
    result: { ok: false, watchdogTriggered: true, watchdogReason: "长时间无输出" },
  });

  assert.equal(failure.family, "soft");
  assert.equal(failure.code, "watchdog_idle");
});

test("运行时恢复分类会把未知错误归到软阻塞探测链路", () => {
  const failure = classifyRuntimeRecoveryFailure({
    result: { ok: false, stderr: "mystery transport broke" },
  });

  assert.equal(failure.family, "soft");
  assert.equal(failure.code, "unknown_failure");
});

test("运行时恢复分类会把 400 / 鉴权 / 余额错误识别为硬阻塞", () => {
  const invalidRequest = classifyRuntimeRecoveryFailure({
    result: { ok: false, stderr: "400 bad request: invalid schema" },
  });
  const authFailure = classifyRuntimeRecoveryFailure({
    result: { ok: false, stderr: "not authenticated, please login" },
  });
  const billingFailure = classifyRuntimeRecoveryFailure({
    result: { ok: false, stderr: "payment required: insufficient balance" },
  });

  assert.equal(invalidRequest.family, "hard");
  assert.equal(authFailure.family, "hard");
  assert.equal(billingFailure.family, "hard");
});

test("运行时恢复策略默认符合 hard/soft 双层退避模型", () => {
  const policy = resolveRuntimeRecoveryPolicy({
    runtimeRecovery: {
      hardRetryDelaysSeconds: [900, 900, 900, 900, 900],
      softRetryDelaysSeconds: [900, 900, 900, 900, 900, 1800, 1800, 3600, 5400, 7200, 9000, 10800],
    },
  });

  assert.deepEqual(getRuntimeRecoverySchedule(policy, "hard"), [900, 900, 900, 900, 900]);
  assert.deepEqual(getRuntimeRecoverySchedule(policy, "soft"), [900, 900, 900, 900, 900, 1800, 1800, 3600, 5400, 7200, 9000, 10800]);
});

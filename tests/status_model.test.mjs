import test from "node:test";
import assert from "node:assert/strict";

import { deriveSessionStatusModel } from "../src/status_model.mjs";

test("状态模型会把低价值内部命令降噪为更有意义的当前动作", () => {
  const statusModel = deriveSessionStatusModel({
    runtime: {
      status: "running",
    },
    latestStatus: {
      taskTitle: "补齐状态模型",
    },
    activity: {
      current: {
        kind: "command",
        label: "\"C:\\\\Users\\\\hellowind\\\\.helloloop\\\\runtime\\\\windows-hidden-shell\\\\pwsh.exe\" -Command 'Get-Date -AsUTC -Format \"yyyy-MM-ddTHH:mm:ss.fffZ\"'",
      },
      recentFileChanges: [
        {
          label: "2 个文件变更",
          status: "completed",
          changes: [
            { path: "src/status_model.mjs", kind: "update" },
            { path: "src/dashboard_tui.mjs", kind: "update" },
          ],
          updatedAt: "2026-04-01T02:33:30.759Z",
        },
      ],
      recentEvents: [
        {
          kind: "agent_message",
          label: "补个时间戳后直接落盘，不再做额外猜测。",
          updatedAt: "2026-04-01T02:33:20.601Z",
        },
      ],
    },
  });

  assert.equal(statusModel.currentAction, "2 个文件变更");
  assert.equal(statusModel.activity.kind, "file_change");
});

test("状态模型会把结构化 agent_message 摘要成可读动作", () => {
  const statusModel = deriveSessionStatusModel({
    runtime: {
      status: "completed",
    },
    activity: {
      recentEvents: [
        {
          kind: "agent_message",
          label: JSON.stringify({
            verdict: "complete",
            summary: "已直接核对目标代码、测试文件与默认验证入口；三条任务验收条件均有仓库内明确证据支撑。",
            nextAction: "当前任务已完成",
            acceptanceChecks: [{ status: "met" }],
          }),
          updatedAt: "2026-04-01T05:00:00.000Z",
        },
      ],
    },
  });

  assert.equal(statusModel.currentAction, "已直接核对目标代码、测试文件与默认验证入口；三条任务验收条件均有仓库内明确证据支撑。");
  assert.equal(statusModel.activity.kind, "agent_message");
});

test("状态模型会把截断的 JSON 复核结果降噪成通用摘要", () => {
  const statusModel = deriveSessionStatusModel({
    runtime: {
      status: "completed",
    },
    activity: {
      recentEvents: [
        {
          kind: "agent_message",
          label: "{\"acceptanceChecks\":[{\"evidence\":\"crates/hellomind-desktop/src/gateway_payload_normalization_tests.rs:11-54 的断言辅助同时校验 s…",
          updatedAt: "2026-04-01T05:00:00.000Z",
        },
      ],
    },
  });

  assert.equal(statusModel.currentAction, "任务复核结果已产出");
  assert.equal(statusModel.activity.kind, "agent_message");
});

test("状态模型会把 429 自动恢复显示为明确的结构化故障与等待状态", () => {
  const statusModel = deriveSessionStatusModel({
    runtime: {
      status: "retry_waiting",
      failureCode: "rate_limit",
      failureFamily: "soft",
      failureReason: "exceeded retry limit, last status: 429 Too Many Requests",
      failureHttpStatus: 429,
      nextRetryAt: "2026-04-01T02:45:00.000Z",
    },
  });

  assert.equal(statusModel.label, "等待自动重试");
  assert.equal(statusModel.scheduler.state, "runtime_retry");
  assert.equal(statusModel.failure.httpStatusCode, 429);
  assert.equal(statusModel.failure.label, "HTTP 429 / 限流或临时容量不足");
  assert.equal(statusModel.failure.retryable, true);
  assert.equal(statusModel.wait.type, "runtime_retry");
});

test("状态模型会把 400 显示为人工介入型硬阻塞", () => {
  const statusModel = deriveSessionStatusModel({
    runtime: {
      status: "paused_manual",
      failureCode: "invalid_request",
      failureFamily: "hard",
      failureReason: "400 bad request: invalid schema",
      failureHttpStatus: 400,
    },
  });

  assert.equal(statusModel.label, "等待人工介入");
  assert.equal(statusModel.scheduler.state, "manual_fix_required");
  assert.equal(statusModel.failure.label, "HTTP 400 / 请求或输出格式异常");
  assert.equal(statusModel.failure.retryable, false);
  assert.equal(statusModel.wait.type, "manual");
});

test("状态模型会把等待依赖任务拆成明确的调度与等待对象", () => {
  const statusModel = deriveSessionStatusModel({
    tasks: [
      {
        id: "dep-a",
        title: "先完成协议生成",
        status: "pending",
      },
      {
        id: "task-b",
        title: "再接入消费端",
        status: "pending",
        dependsOn: ["dep-a"],
      },
    ],
    automationExecution: {
      state: "blocked_dependencies",
      blockedTask: {
        id: "task-b",
        title: "再接入消费端",
        status: "pending",
      },
      blockedReason: "任务 再接入消费端 仍依赖未完成任务：dep-a",
      unresolved: ["dep-a"],
    },
  });

  assert.equal(statusModel.label, "等待依赖任务");
  assert.equal(statusModel.scheduler.state, "waiting_dependency");
  assert.equal(statusModel.reason, "前置任务尚未完成");
  assert.equal(statusModel.wait.type, "dependency");
  assert.match(statusModel.wait.targetLabel, /先完成协议生成/);
  assert.equal(statusModel.wait.targets.some((item) => item.role === "blocked_task"), true);
  assert.equal(statusModel.wait.targets.some((item) => item.role === "dependency"), true);
});

test("状态模型会把等待上游阶段显示为单独的阶段门禁", () => {
  const statusModel = deriveSessionStatusModel({
    tasks: [
      {
        id: "architecture-a",
        title: "先补架构方案",
        stage: "architecture",
        status: "pending",
      },
      {
        id: "implementation-a",
        title: "再落实现",
        stage: "implementation",
        status: "pending",
      },
    ],
    automationExecution: {
      state: "blocked_stage_gates",
      blockedTask: {
        id: "implementation-a",
        title: "再落实现",
        stage: "implementation",
        status: "pending",
      },
      blockedReason: "任务 再落实现 仍需等待更早阶段任务完成：architecture-a",
      unresolved: ["architecture-a"],
      unresolvedRefs: [{ id: "architecture-a", kind: "stage_gate" }],
    },
  });

  assert.equal(statusModel.label, "等待上游阶段");
  assert.equal(statusModel.scheduler.state, "waiting_stage_gate");
  assert.equal(statusModel.wait.type, "stage_gate");
  assert.match(statusModel.wait.targetLabel, /需求梳理|架构设计|先补架构方案/);
});

test("状态模型会把等待外部依赖显示为明确的结构化等待", () => {
  const statusModel = deriveSessionStatusModel({
    automationExecution: {
      state: "blocked_external",
      blockedTask: {
        id: "consumer",
        title: "接入消费端",
        status: "pending",
      },
      blockedReason: "任务 接入消费端 正等待外部依赖或产物就绪。",
      blockingSignals: [
        {
          type: "repo",
          id: "hellomind-protocols",
          label: "hellomind-protocols 生成物",
          status: "open",
        },
      ],
    },
  });

  assert.equal(statusModel.label, "等待外部依赖");
  assert.equal(statusModel.scheduler.state, "waiting_external_dependency");
  assert.equal(statusModel.wait.type, "external_dependency");
  assert.match(statusModel.wait.targetLabel, /hellomind-protocols/);
});

test("状态模型会把未收束的进行中任务显示为等待续跑而不是空闲", () => {
  const statusModel = deriveSessionStatusModel({
    automationExecution: {
      state: "blocked_in_progress",
      blockedTask: {
        id: "task-a",
        title: "继续收口设置页",
        status: "in_progress",
      },
      blockedReason: "存在未收束的进行中任务：继续收口设置页",
      unresolved: [],
    },
  });

  assert.equal(statusModel.label, "等待当前任务续跑");
  assert.equal(statusModel.scheduler.state, "waiting_current_task_resume");
  assert.equal(statusModel.wait.type, "current_task");
  assert.match(statusModel.wait.targetLabel, /继续收口设置页/);
});

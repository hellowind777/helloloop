import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { scaffoldIfMissing } from "../src/config.mjs";
import { createContext } from "../src/context.mjs";
import { runOnce } from "../src/runner.mjs";

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function testEngineResolution() {
  return {
    ok: true,
    engine: "codex",
    displayName: "Codex",
    source: "test",
    sourceLabel: "测试注入",
    basis: ["单元测试直接指定 Codex。"],
    hostContext: "terminal",
    hostDisplayName: "终端",
    probes: [],
    availableEngines: ["codex"],
  };
}

test("纯插件模式仍保留 Ralph Loop 默认参数与干跑提示", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-ralph-loop-"));
  const context = createContext({ repoRoot });

  writeText(path.join(repoRoot, ".helloagents", "verify.yaml"), "commands:\n  - node --version\n");
  scaffoldIfMissing(context);

  const policy = JSON.parse(fs.readFileSync(context.policyFile, "utf8"));
  assert.equal(policy.maxTaskAttempts, 2);
  assert.equal(policy.maxTaskStrategies, 4);
  assert.equal(policy.stopOnFailure, false);

  const result = await runOnce(context, {
    dryRun: true,
    maxAttempts: 3,
    maxStrategies: 5,
    engineResolution: testEngineResolution(),
  });

  fs.rmSync(repoRoot, { recursive: true, force: true });

  assert.equal(result.ok, true);
  assert.match(result.prompt, /当前执行模式是 Ralph Loop/);
  assert.match(result.prompt, /当前策略轮次：1\/5/);
  assert.match(result.prompt, /当前策略内重试：1\/3/);
  assert.match(result.prompt, /完成前必须运行的验证/);
});

test("默认状态目录改为 .helloloop", () => {
  const defaultRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-default-config-"));

  try {
    const defaultContext = createContext({ repoRoot: defaultRepoRoot });
    assert.equal(defaultContext.configRoot, path.join(defaultRepoRoot, ".helloloop"));
  } finally {
    fs.rmSync(defaultRepoRoot, { recursive: true, force: true });
  }
});

test("干跑提示使用当前 loop 状态", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-state-prompt-"));

  try {
    const context = createContext({ repoRoot });
    writeText(path.join(repoRoot, ".helloagents", "verify.yaml"), "commands:\n  - node --version\n");
    scaffoldIfMissing(context);
    writeText(context.stateFile, "## 当前状态\n- 当前任务：当前 loop 状态\n");

    const result = await runOnce(context, {
      dryRun: true,
      engineResolution: testEngineResolution(),
    });
    assert.match(result.prompt, /当前任务：当前 loop 状态/);
    assert.doesNotMatch(result.prompt, /仓库总体状态：/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

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
  });

  fs.rmSync(repoRoot, { recursive: true, force: true });

  assert.equal(result.ok, true);
  assert.match(result.prompt, /当前执行模式是 Ralph Loop/);
  assert.match(result.prompt, /当前策略轮次：1\/5/);
  assert.match(result.prompt, /当前策略内重试：1\/3/);
  assert.match(result.prompt, /完成前必须运行的验证/);
});

test("默认状态目录改为 .helloloop，并兼容识别旧的 .helloagents/helloloop", () => {
  const defaultRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-default-config-"));
  const legacyRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-legacy-config-"));

  try {
    const defaultContext = createContext({ repoRoot: defaultRepoRoot });
    assert.equal(defaultContext.configRoot, path.join(defaultRepoRoot, ".helloloop"));

    writeText(path.join(legacyRepoRoot, ".helloagents", "helloloop", "backlog.json"), "{\n  \"tasks\": []\n}\n");
    const legacyContext = createContext({ repoRoot: legacyRepoRoot });
    assert.equal(legacyContext.configRoot, path.join(legacyRepoRoot, ".helloagents", "helloloop"));
  } finally {
    fs.rmSync(defaultRepoRoot, { recursive: true, force: true });
    fs.rmSync(legacyRepoRoot, { recursive: true, force: true });
  }
});

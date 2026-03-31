import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCliEnv,
  createAgentCli,
  createDemoRepo,
  createUnavailableCli,
  sampleAnalysisPayload,
  spawnHelloLoop,
  writeJson,
} from "./helpers/engine_selection_fixture.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const npmBinEntry = path.join(repoRoot, "bin", "helloloop.js");

test("当前引擎在分析阶段遇到限流时会按无人值守策略同引擎自动恢复", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-engine-fallback-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = createDemoRepo(tempRoot);
  const codexStateFile = path.join(fakeBin, "codex-state.json");

  createAgentCli(fakeBin, "codex", {
    versionText: "codex 0.117.0\n",
    analyze: {
      failOnce: true,
      errorText: "429 rate limit exceeded\n",
      payload: sampleAnalysisPayload(),
    },
    probe: {
      finalMessage: "HELLOLOOP_ENGINE_OK",
    },
  });
  writeJson(path.join(tempRepo, ".helloloop", "policy.json"), {
    version: 1,
    updatedAt: "2026-03-30T00:00:00.000Z",
    maxLoopTasks: 4,
    maxTaskAttempts: 2,
    maxTaskStrategies: 4,
    maxReanalysisPasses: 3,
    stopOnFailure: false,
    stopOnHighRisk: true,
    runtimeRecovery: {
      enabled: true,
      heartbeatIntervalSeconds: 1,
      stallWarningSeconds: 30,
      maxIdleSeconds: 60,
      killGraceSeconds: 1,
      healthProbeTimeoutSeconds: 5,
      hardRetryDelaysSeconds: [0],
      softRetryDelaysSeconds: [0],
    },
  });
  createUnavailableCli(fakeBin, "claude");
  createUnavailableCli(fakeBin, "gemini");

  const result = spawnHelloLoop(npmBinEntry, ["codex"], {
    cwd: tempRepo,
    env: buildCliEnv(fakeBin),
    input: "n\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /本次引擎：Codex/);
    assert.doesNotMatch(result.stdout, /是否切换到其他可用引擎继续/);
    const state = JSON.parse(fs.readFileSync(codexStateFile, "utf8"));
    assert.equal(state.analyze, 2);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("保存最近使用引擎时不会覆盖 settings.json 中的邮件通知配置", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-engine-settings-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = createDemoRepo(tempRoot);
  const settingsFile = path.join(fakeBin, "settings.json");

  createAgentCli(fakeBin, "claude", {
    versionText: "claude 2.1.87\n",
    analyze: {
      payload: sampleAnalysisPayload(),
    },
  });
  createUnavailableCli(fakeBin, "codex");
  createUnavailableCli(fakeBin, "gemini");
  writeJson(settingsFile, {
    defaultEngine: "",
    lastSelectedEngine: "",
    notifications: {
      email: {
        enabled: true,
        to: ["notify@example.com"],
        from: "helloloop@example.com",
        smtp: {
          host: "smtp.example.com",
          port: 465,
          secure: true,
        },
      },
    },
  });

  const result = spawnHelloLoop(npmBinEntry, ["claude"], {
    cwd: tempRepo,
    env: buildCliEnv(fakeBin),
    input: "n\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    const nextSettings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    assert.equal(nextSettings.lastSelectedEngine, "claude");
    assert.equal(nextSettings.notifications.email.enabled, true);
    assert.deepEqual(nextSettings.notifications.email.to, ["notify@example.com"]);
    assert.equal(nextSettings.notifications.email.from, "helloloop@example.com");
    assert.equal(nextSettings.notifications.email.smtp.host, "smtp.example.com");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("保存最近使用引擎时只会更新已知项，不会把未知项继续写回 settings.json", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-engine-settings-prune-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = createDemoRepo(tempRoot);
  const settingsFile = path.join(fakeBin, "settings.json");

  createAgentCli(fakeBin, "claude", {
    versionText: "claude 2.1.87\n",
    analyze: {
      payload: sampleAnalysisPayload(),
    },
  });
  createUnavailableCli(fakeBin, "codex");
  createUnavailableCli(fakeBin, "gemini");
  writeJson(settingsFile, {
    defaultEngine: "not-a-real-engine",
    lastSelectedEngine: "",
    legacyField: "remove-me",
    notifications: {
      email: {
        enabled: true,
        to: ["notify@example.com"],
      },
    },
  });

  const result = spawnHelloLoop(npmBinEntry, ["claude"], {
    cwd: tempRepo,
    env: buildCliEnv(fakeBin),
    input: "n\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    const nextSettings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    assert.equal(nextSettings.defaultEngine, "");
    assert.equal(nextSettings.lastSelectedEngine, "claude");
    assert.equal(Object.hasOwn(nextSettings, "legacyField"), false);
    assert.equal(nextSettings.notifications.email.enabled, true);
    assert.deepEqual(nextSettings.notifications.email.to, ["notify@example.com"]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("在 Codex 宿主内显式要求改用 Claude 时会先确认，不会静默切换", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-cross-host-confirm-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = createDemoRepo(tempRoot);

  createAgentCli(fakeBin, "claude", {
    versionText: "claude 2.1.87\n",
    analyze: {
      payload: sampleAnalysisPayload(),
    },
  });
  createAgentCli(fakeBin, "codex", {
    versionText: "codex 0.117.0\n",
    analyze: {
      payload: sampleAnalysisPayload(),
    },
  });
  createUnavailableCli(fakeBin, "gemini");

  const result = spawnHelloLoop(npmBinEntry, ["--host-context", "codex", "claude"], {
    cwd: tempRepo,
    env: buildCliEnv(fakeBin),
    input: "y\nn\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /当前从 Codex 宿主发起，但本次将改用 Claude 执行/);
    assert.match(result.stdout, /本次引擎：Claude/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

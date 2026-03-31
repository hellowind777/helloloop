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
} from "./helpers/engine_selection_fixture.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const npmBinEntry = path.join(repoRoot, "bin", "helloloop.js");

test("命令首参数写 claude 时会直接使用 Claude 引擎", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-engine-claude-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = createDemoRepo(tempRoot);

  createAgentCli(fakeBin, "claude", {
    versionText: "claude 2.1.87\n",
    analyze: {
      payload: sampleAnalysisPayload(),
    },
  });
  createUnavailableCli(fakeBin, "codex");
  createUnavailableCli(fakeBin, "gemini");

  const result = spawnHelloLoop(npmBinEntry, ["claude"], {
    cwd: tempRepo,
    env: buildCliEnv(fakeBin),
    input: "n\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /执行引擎：/);
    assert.match(result.stdout, /本次引擎：Claude/);
    assert.match(result.stdout, /选择来源：命令首参数/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("自然语言里明确提到 gemini 时会按语义选择 Gemini 引擎", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-engine-gemini-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = createDemoRepo(tempRoot);

  createAgentCli(fakeBin, "gemini", {
    versionText: "gemini 0.36.0-preview.6\n",
    analyze: {
      payload: sampleAnalysisPayload(),
    },
  });
  createUnavailableCli(fakeBin, "codex");
  createUnavailableCli(fakeBin, "claude");

  const result = spawnHelloLoop(npmBinEntry, ["please", "use", "gemini", "to", "continue"], {
    cwd: tempRepo,
    env: buildCliEnv(fakeBin),
    input: "n\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /本次引擎：Gemini/);
    assert.match(result.stdout, /选择来源：自然语言要求/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("多个可用引擎且未明确指定时会先询问用户选择", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-engine-prompt-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = createDemoRepo(tempRoot);

  createAgentCli(fakeBin, "codex", {
    versionText: "codex 0.117.0\n",
    analyze: {
      payload: sampleAnalysisPayload(),
    },
  });
  createAgentCli(fakeBin, "claude", {
    versionText: "claude 2.1.87\n",
    analyze: {
      payload: sampleAnalysisPayload(),
    },
  });
  createUnavailableCli(fakeBin, "gemini");

  const result = spawnHelloLoop(npmBinEntry, [], {
    cwd: tempRepo,
    env: buildCliEnv(fakeBin),
    input: "2\nn\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /请选择本次要使用的执行引擎/);
    assert.match(result.stdout, /1\. Codex/);
    assert.match(result.stdout, /2\. Claude/);
    assert.match(result.stdout, /本次引擎：Claude/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("只有一个可用引擎且未明确指定时也会先询问，不会自动选择", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-engine-single-prompt-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = createDemoRepo(tempRoot);

  createAgentCli(fakeBin, "codex", {
    versionText: "codex 0.117.0\n",
    analyze: {
      payload: sampleAnalysisPayload(),
    },
  });
  createUnavailableCli(fakeBin, "claude");
  createUnavailableCli(fakeBin, "gemini");

  const result = spawnHelloLoop(npmBinEntry, [], {
    cwd: tempRepo,
    env: buildCliEnv(fakeBin, {
      HELLOLOOP_HOST_CONTEXT: "codex",
    }),
    input: "1\nn\n",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /本轮开始前必须先明确执行引擎；未明确引擎时不会自动选择/);
    assert.match(result.stdout, /当前宿主：Codex/);
    assert.match(result.stdout, /1\. Codex（推荐）/);
    assert.match(result.stdout, /本次引擎：Codex/);
    assert.match(result.stdout, /选择来源：交互选择/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("--yes 且未明确指定引擎时会直接失败，要求先显式指定引擎", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-engine-required-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = createDemoRepo(tempRoot);

  createAgentCli(fakeBin, "codex", {
    versionText: "codex 0.117.0\n",
    analyze: {
      payload: sampleAnalysisPayload(),
    },
  });
  createUnavailableCli(fakeBin, "claude");
  createUnavailableCli(fakeBin, "gemini");

  const result = spawnHelloLoop(npmBinEntry, ["-y"], {
    cwd: tempRepo,
    env: buildCliEnv(fakeBin),
  });

  try {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /本轮开始前必须先明确执行引擎；当前未检测到用户已明确指定引擎/);
    assert.match(result.stderr, /检测到唯一可用执行引擎：Codex/);
    assert.match(result.stderr, /npx helloloop codex/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const npmBinEntry = path.join(repoRoot, "bin", "helloloop.js");

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function spawnHelloLoop(args, options = {}) {
  return spawnSync("node", [npmBinEntry, ...args], {
    cwd: options.cwd || repoRoot,
    encoding: "utf8",
    env: options.env || process.env,
  });
}

function writeSettings(settingsFile, terminalConcurrency) {
  writeJson(settingsFile, {
    defaultEngine: "",
    lastSelectedEngine: "",
    notifications: {
      email: {
        enabled: false,
        to: [],
        from: "",
        smtp: {
          host: "",
          port: 465,
          secure: true,
          starttls: false,
          username: "",
          usernameEnv: "",
          password: "",
          passwordEnv: "",
          timeoutSeconds: 30,
          rejectUnauthorized: true,
        },
      },
    },
    runtime: {
      terminalConcurrency,
    },
  });
}

function writeActiveSession(homeDir, fileName, record) {
  writeJson(path.join(homeDir, "runtime", "terminal-sessions", fileName), {
    id: record.id,
    kind: record.kind,
    pid: record.pid,
    ownerPid: record.ownerPid,
    command: record.command,
    sessionId: record.sessionId || "",
    repoRoot: record.repoRoot || "",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

test("显示终端达到 visibleMax 时会阻止新的前台 HelloLoop 会话启动", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-visible-limit-"));
  const homeDir = path.join(tempRoot, "helloloop-home");
  const settingsFile = path.join(homeDir, "settings.json");
  const repoDir = path.join(tempRoot, "repo");
  const now = new Date().toISOString();

  writeSettings(settingsFile, {
    enabled: true,
    visibleMax: 1,
    backgroundMax: 8,
    totalMax: 8,
  });
  fs.mkdirSync(repoDir, { recursive: true });
  writeActiveSession(homeDir, "existing-visible.json", {
    id: "existing-visible",
    kind: "visible",
    pid: process.pid,
    ownerPid: process.pid,
    command: "run-once",
    repoRoot: repoDir,
    createdAt: now,
    updatedAt: now,
  });

  const result = spawnHelloLoop(["run-once"], {
    cwd: repoDir,
    env: {
      ...process.env,
      HELLOLOOP_HOME: homeDir,
      HELLOLOOP_SETTINGS_FILE: settingsFile,
    },
  });

  try {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /显示终端并发已达上限/);
    assert.match(result.stderr, /runtime\.terminalConcurrency/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("显示与背景会话合计达到 totalMax 时会阻止新的 HelloLoop 会话启动", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-total-limit-"));
  const homeDir = path.join(tempRoot, "helloloop-home");
  const settingsFile = path.join(homeDir, "settings.json");
  const repoDir = path.join(tempRoot, "repo");
  const now = new Date().toISOString();

  writeSettings(settingsFile, {
    enabled: true,
    visibleMax: 8,
    backgroundMax: 8,
    totalMax: 1,
  });
  fs.mkdirSync(repoDir, { recursive: true });
  writeActiveSession(homeDir, "existing-background.json", {
    id: "existing-background",
    kind: "background",
    pid: process.pid,
    ownerPid: process.pid,
    command: "run-once",
    repoRoot: repoDir,
    createdAt: now,
    updatedAt: now,
  });

  const result = spawnHelloLoop(["run-once"], {
    cwd: repoDir,
    env: {
      ...process.env,
      HELLOLOOP_HOME: homeDir,
      HELLOLOOP_SETTINGS_FILE: settingsFile,
    },
  });

  try {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /合计并发已达上限/);
    assert.match(result.stderr, /总并发 2\/1/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("背景终端达到 backgroundMax 时会阻止前台会话切换到 detached supervisor", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-background-limit-"));
  const homeDir = path.join(tempRoot, "helloloop-home");
  const settingsFile = path.join(homeDir, "settings.json");
  const repoDir = path.join(tempRoot, "repo");

  writeSettings(settingsFile, {
    enabled: true,
    visibleMax: 8,
    backgroundMax: 0,
    totalMax: 8,
  });
  writeText(path.join(repoDir, "src", "index.js"), "console.log('hello');\n");

  const result = spawnHelloLoop(["run-once"], {
    cwd: repoDir,
    env: {
      ...process.env,
      HELLOLOOP_HOME: homeDir,
      HELLOLOOP_SETTINGS_FILE: settingsFile,
    },
  });

  try {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /背景终端并发已达上限/);
    assert.match(result.stderr, /backgroundMax/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

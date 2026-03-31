import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { syncUserSettingsFile } from "../src/engine_selection_settings.mjs";

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function spawnHelloLoop(args, options = {}) {
  return spawnSync("node", [npmBinEntry, ...args], {
    cwd: options.cwd || repoRoot,
    encoding: "utf8",
    env: options.env || process.env,
    input: options.input,
  });
}

test("install/uninstall 链路只会在 HELLOLOOP_HOME 下维护 settings.json，不会生成任务状态或 runs 记录", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-global-state-clean-"));
  const codexHome = path.join(tempRoot, "codex-home");
  const claudeHome = path.join(tempRoot, "claude-home");
  const geminiHome = path.join(tempRoot, "gemini-home");
  const helloLoopHome = path.join(tempRoot, "helloloop-home");
  const env = {
    ...process.env,
    HELLOLOOP_HOME: helloLoopHome,
    HELLOLOOP_SETTINGS_FILE: path.join(helloLoopHome, "settings.json"),
  };

  try {
    const installResult = spawnHelloLoop([
      "install",
      "--host",
      "all",
      "--codex-home",
      codexHome,
      "--claude-home",
      claudeHome,
      "--gemini-home",
      geminiHome,
    ], { env });
    assert.equal(installResult.status, 0, installResult.stderr);
    assert.equal(fs.existsSync(path.join(helloLoopHome, "settings.json")), true);
    assert.equal(fs.existsSync(path.join(helloLoopHome, "runs")), false);
    assert.equal(fs.existsSync(path.join(helloLoopHome, "status.json")), false);

    const uninstallResult = spawnHelloLoop([
      "uninstall",
      "--host",
      "all",
      "--codex-home",
      codexHome,
      "--claude-home",
      claudeHome,
      "--gemini-home",
      geminiHome,
    ], { env });
    assert.equal(uninstallResult.status, 0, uninstallResult.stderr);
    assert.equal(fs.existsSync(path.join(helloLoopHome, "settings.json")), true);
    assert.equal(fs.existsSync(path.join(helloLoopHome, "runs")), false);
    assert.equal(fs.existsSync(path.join(helloLoopHome, "status.json")), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("install 会补齐缺失项、清理未知项，并把非法已知值重置为默认值", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-settings-sync-"));
  const codexHome = path.join(tempRoot, "codex-home");
  const helloLoopHome = path.join(tempRoot, "helloloop-home");
  const settingsFile = path.join(helloLoopHome, "settings.json");
  const env = {
    ...process.env,
    HELLOLOOP_HOME: helloLoopHome,
    HELLOLOOP_SETTINGS_FILE: settingsFile,
  };

  writeJson(settingsFile, {
    defaultEngine: "custom-engine",
    notifications: {
      email: {
        enabled: "yes",
        smtp: {
          host: "smtp.example.com",
        },
      },
    },
    deprecatedField: true,
  });

  try {
    const installResult = spawnHelloLoop([
      "install",
      "--host",
      "codex",
      "--codex-home",
      codexHome,
    ], { env });
    assert.equal(installResult.status, 0, installResult.stderr);

    const settings = readJson(settingsFile);
    assert.equal(settings.defaultEngine, "");
    assert.equal(settings.lastSelectedEngine, "");
    assert.equal(settings.notifications.email.enabled, false);
    assert.deepEqual(settings.notifications.email.to, []);
    assert.equal(settings.notifications.email.from, "");
    assert.equal(settings.notifications.email.smtp.host, "smtp.example.com");
    assert.equal(settings.notifications.email.smtp.port, 465);
    assert.equal(settings.runtime.terminalConcurrency.enabled, true);
    assert.equal(settings.runtime.terminalConcurrency.visibleMax, 8);
    assert.equal(settings.runtime.terminalConcurrency.backgroundMax, 8);
    assert.equal(settings.runtime.terminalConcurrency.totalMax, 8);
    assert.equal(Object.hasOwn(settings, "deprecatedField"), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("install 遇到非法 settings.json 时会备份后重建当前版本结构", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-settings-invalid-"));
  const codexHome = path.join(tempRoot, "codex-home");
  const helloLoopHome = path.join(tempRoot, "helloloop-home");
  const settingsFile = path.join(helloLoopHome, "settings.json");
  const env = {
    ...process.env,
    HELLOLOOP_HOME: helloLoopHome,
    HELLOLOOP_SETTINGS_FILE: settingsFile,
  };

  writeText(settingsFile, "{ invalid json }\n");

  try {
    const installResult = spawnHelloLoop([
      "install",
      "--host",
      "codex",
      "--codex-home",
      codexHome,
    ], { env });
    assert.equal(installResult.status, 0, installResult.stderr);
    assert.match(installResult.stdout, /检测到非法 JSON，已重建为当前版本结构/);

    const settings = readJson(settingsFile);
    assert.deepEqual(settings, {
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
        terminalConcurrency: {
          enabled: true,
          visibleMax: 8,
          backgroundMax: 8,
          totalMax: 8,
        },
      },
    });

    const backupFiles = fs.readdirSync(helloLoopHome)
      .filter((item) => item.startsWith("settings.json.invalid-") && item.endsWith(".bak"));
    assert.equal(backupFiles.length, 1);
    assert.equal(fs.readFileSync(path.join(helloLoopHome, backupFiles[0]), "utf8"), "{ invalid json }\n");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("settings.json 在首次读取瞬间异常、重读后合法时不会产生备份文件", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-settings-retry-"));
  const helloLoopHome = path.join(tempRoot, "helloloop-home");
  const settingsFile = path.join(helloLoopHome, "settings.json");
  const originalReadFileSync = fs.readFileSync;
  let firstRead = true;

  writeJson(settingsFile, {
    defaultEngine: "",
    lastSelectedEngine: "codex",
    notifications: {
      email: {
        enabled: false,
      },
    },
  });

  fs.readFileSync = ((filePath, ...args) => {
    if (String(filePath) === settingsFile && firstRead) {
      firstRead = false;
      return "{ invalid";
    }
    return originalReadFileSync.call(fs, filePath, ...args);
  });

  try {
    const result = syncUserSettingsFile({ userSettingsFile: settingsFile });
    assert.equal(result.action, "synced");
    assert.equal(result.backupFile, "");
    assert.equal(result.recoveredAfterRetry, true);
    const backupFiles = fs.readdirSync(helloLoopHome)
      .filter((item) => item.startsWith("settings.json.invalid-") && item.endsWith(".bak"));
    assert.deepEqual(backupFiles, []);
    const settings = readJson(settingsFile);
    assert.equal(settings.lastSelectedEngine, "codex");
    assert.equal(settings.runtime.terminalConcurrency.totalMax, 8);
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

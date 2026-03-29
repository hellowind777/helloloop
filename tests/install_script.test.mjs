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

test("Windows 安装脚本只安装运行时 bundle，不复制开发文档、测试和 .git 元数据", {
  skip: process.platform !== "win32",
}, () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-home-install-"));
  const scriptFile = path.join(repoRoot, "scripts", "install-home-plugin.ps1");

  const result = spawnSync("pwsh", [
    "-NoLogo",
    "-NoProfile",
    "-File",
    scriptFile,
    "-CodexHome",
    tempHome,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    const pluginRoot = path.join(tempHome, "plugins", "helloloop");
    const marketplaceFile = path.join(tempHome, ".agents", "plugins", "marketplace.json");

    assert.ok(fs.existsSync(path.join(pluginRoot, ".codex-plugin", "plugin.json")));
    assert.ok(fs.existsSync(path.join(pluginRoot, "LICENSE")));
    assert.ok(fs.existsSync(path.join(pluginRoot, "scripts", "helloloop.mjs")));
    assert.ok(fs.existsSync(marketplaceFile));
    assert.ok(!fs.existsSync(path.join(pluginRoot, "docs")));
    assert.ok(!fs.existsSync(path.join(pluginRoot, "tests")));
    assert.ok(!fs.existsSync(path.join(pluginRoot, ".git")));
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test("Windows 安装脚本覆盖已有安装时会清掉残留的 .git 元数据", {
  skip: process.platform !== "win32",
}, () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-home-reinstall-"));
  const scriptFile = path.join(repoRoot, "scripts", "install-home-plugin.ps1");
  const pluginRoot = path.join(tempHome, "plugins", "helloloop");
  const staleGitRoot = path.join(pluginRoot, ".git");

  fs.mkdirSync(staleGitRoot, { recursive: true });
  fs.writeFileSync(path.join(staleGitRoot, "config"), "[core]\nrepositoryformatversion = 0\n", "utf8");

  const result = spawnSync("pwsh", [
    "-NoLogo",
    "-NoProfile",
    "-File",
    scriptFile,
    "-CodexHome",
    tempHome,
    "-Force",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(pluginRoot, ".codex-plugin", "plugin.json")));
    assert.ok(fs.existsSync(path.join(pluginRoot, "LICENSE")));
    assert.ok(!fs.existsSync(staleGitRoot));
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test("Windows 卸载脚本会移除 Codex Home 下的已安装插件与 marketplace 注册", {
  skip: process.platform !== "win32",
}, () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-home-uninstall-"));
  const installScriptFile = path.join(repoRoot, "scripts", "install-home-plugin.ps1");
  const uninstallScriptFile = path.join(repoRoot, "scripts", "uninstall-home-plugin.ps1");

  const installResult = spawnSync("pwsh", [
    "-NoLogo",
    "-NoProfile",
    "-File",
    installScriptFile,
    "-CodexHome",
    tempHome,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(installResult.status, 0, installResult.stderr);

  const result = spawnSync("pwsh", [
    "-NoLogo",
    "-NoProfile",
    "-File",
    uninstallScriptFile,
    "-CodexHome",
    tempHome,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    const pluginRoot = path.join(tempHome, "plugins", "helloloop");
    const marketplaceFile = path.join(tempHome, ".agents", "plugins", "marketplace.json");

    assert.ok(!fs.existsSync(pluginRoot));
    const marketplace = JSON.parse(fs.readFileSync(marketplaceFile, "utf8"));
    assert.equal(marketplace.plugins.some((plugin) => plugin?.name === "helloloop"), false);
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

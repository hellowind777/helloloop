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

test("安装脚本只安装插件 bundle 文件，不复制 .git 元数据", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "autoloop-home-install-"));
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
    const pluginRoot = path.join(tempHome, "plugins", "autoloop");
    const marketplaceFile = path.join(tempHome, ".agents", "plugins", "marketplace.json");

    assert.ok(fs.existsSync(path.join(pluginRoot, ".codex-plugin", "plugin.json")));
    assert.ok(fs.existsSync(path.join(pluginRoot, "scripts", "autoloop.mjs")));
    assert.ok(fs.existsSync(path.join(pluginRoot, "docs", "README.md")));
    assert.ok(fs.existsSync(marketplaceFile));
    assert.ok(!fs.existsSync(path.join(pluginRoot, ".git")));
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

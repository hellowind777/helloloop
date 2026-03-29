import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

test("HelloLoop 官方插件 manifest 只声明当前运行时支持的插件字段", () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(repoRoot, ".codex-plugin", "plugin.json"),
    "utf8",
  ));

  assert.equal(manifest.name, "helloloop");
  assert.equal(manifest.skills, "./skills/");
  assert.ok(!Object.hasOwn(manifest, "hooks"));
  assert.ok(!Object.hasOwn(manifest, "mcpServers"));
  assert.ok(!Object.hasOwn(manifest, "apps"));
  assert.equal(manifest.interface.category, "Coding");
});

test("npm 分发白名单只包含运行时所需文件", () => {
  const packageJson = JSON.parse(fs.readFileSync(
    path.join(repoRoot, "package.json"),
    "utf8",
  ));

  assert.deepEqual(packageJson.bin, {
    helloloop: "bin/helloloop.js",
  });
  assert.deepEqual(packageJson.files, [
    ".codex-plugin",
    "README.md",
    "bin",
    "package.json",
    "scripts",
    "skills",
    "src",
    "templates",
  ]);
});

test("HelloLoop 独立 bundle 的脚本、安装入口和文档目录都已落地", () => {
  assert.ok(fs.existsSync(path.join(repoRoot, "scripts", "helloloop.mjs")));
  assert.ok(fs.existsSync(path.join(repoRoot, "scripts", "install-home-plugin.ps1")));
  assert.ok(fs.existsSync(path.join(repoRoot, "skills", "helloloop", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(repoRoot, "docs", "README.md")));
  assert.ok(fs.existsSync(path.join(repoRoot, "docs", "install.md")));
  assert.ok(fs.existsSync(path.join(repoRoot, "docs", "plugin-standard.md")));
  assert.ok(!fs.existsSync(path.join(repoRoot, "bridge")));
  assert.ok(!fs.existsSync(path.join(repoRoot, "hooks")));
});

test("README 使用短命令示例且不暴露本机绝对路径", () => {
  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");

  assert.match(readme, /npx helloloop init --repo <REPO_ROOT>/);
  assert.match(readme, /npx helloloop doctor --repo <REPO_ROOT>/);
  assert.doesNotMatch(readme, /C:\\Users\\/);
  assert.doesNotMatch(readme, /D:\\GitHub\\dev\\/);
});

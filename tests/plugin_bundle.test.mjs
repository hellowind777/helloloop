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
    "LICENSE",
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
  assert.ok(fs.existsSync(path.join(repoRoot, "LICENSE")));
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

  assert.match(readme, /npx helloloop\s*$/m);
  assert.match(readme, /npx helloloop <PATH>/);
  assert.match(readme, /npx helloloop next/);
  assert.doesNotMatch(readme, /C:\\Users\\/);
  assert.doesNotMatch(readme, /D:\\GitHub\\dev\\/);
});

test("许可证信息与运行时元数据已对齐 Apache-2.0", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, ".codex-plugin", "plugin.json"), "utf8"));
  const licenseText = fs.readFileSync(path.join(repoRoot, "LICENSE"), "utf8");

  assert.equal(packageJson.license, "Apache-2.0");
  assert.equal(manifest.license, "Apache-2.0");
  assert.match(licenseText, /Apache License/);
  assert.match(licenseText, /Version 2\.0, January 2004/);
});

test("公开文档不再包含旧命令流和无关发布说明", () => {
  const combined = [
    "README.md",
    "docs/install.md",
    "docs/README.md",
    "docs/plugin-standard.md",
  ].map((file) => fs.readFileSync(path.join(repoRoot, file), "utf8")).join("\n");

  const forbiddenSnippets = [
    ["~hello", "loop"].join(""),
    ["User", "Prompt", "Submit"].join(""),
    ["Stop ", "Hook"].join(""),
    ["发布到 ", "npm"].join(""),
    ["推荐", "发布方式"].join(""),
    ["Trusted ", "Publishing"].join(""),
    ["打包", "预检"].join(""),
  ];

  for (const snippet of forbiddenSnippets) {
    assert.equal(combined.includes(snippet), false, `unexpected snippet: ${snippet}`);
  }
});

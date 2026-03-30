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
    ".claude-plugin",
    ".codex-plugin",
    "LICENSE",
    "README.md",
    "bin",
    "hosts",
    "package.json",
    "scripts",
    "skills",
    "src",
    "templates",
  ]);
});

test("HelloLoop 独立 bundle 的脚本、安装入口和文档目录都已落地", () => {
  assert.ok(fs.existsSync(path.join(repoRoot, "LICENSE")));
  assert.ok(fs.existsSync(path.join(repoRoot, ".claude-plugin", "plugin.json")));
  assert.ok(fs.existsSync(path.join(repoRoot, "scripts", "helloloop.mjs")));
  assert.ok(fs.existsSync(path.join(repoRoot, "scripts", "install-home-plugin.ps1")));
  assert.ok(fs.existsSync(path.join(repoRoot, "scripts", "uninstall-home-plugin.ps1")));
  assert.ok(fs.existsSync(path.join(repoRoot, "skills", "helloloop", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(repoRoot, "hosts", "claude", "marketplace", ".claude-plugin", "marketplace.json")));
  assert.ok(fs.existsSync(path.join(repoRoot, "hosts", "gemini", "extension", "gemini-extension.json")));
  assert.ok(fs.existsSync(path.join(repoRoot, "hosts", "gemini", "extension", "commands", "helloloop.toml")));
  assert.ok(fs.existsSync(path.join(repoRoot, "docs", "README.md")));
  assert.ok(fs.existsSync(path.join(repoRoot, "docs", "install.md")));
  assert.ok(fs.existsSync(path.join(repoRoot, "docs", "plugin-standard.md")));
  assert.ok(!fs.existsSync(path.join(repoRoot, "bridge")));
  assert.ok(!fs.existsSync(path.join(repoRoot, "hooks")));
});

test("Claude marketplace manifest 符合当前标准字段", () => {
  const marketplace = JSON.parse(fs.readFileSync(
    path.join(repoRoot, "hosts", "claude", "marketplace", ".claude-plugin", "marketplace.json"),
    "utf8",
  ));

  assert.equal(marketplace.name, "helloloop-local");
  assert.equal(marketplace.plugins[0].name, "helloloop");
  assert.equal(marketplace.plugins[0].source, "./plugins/helloloop");
  assert.ok(!Object.hasOwn(marketplace.plugins[0], "displayName"));
  assert.match(marketplace.metadata.description, /HelloLoop/);
});

test("Claude marketplace 内嵌插件 manifest 与根 manifest 版本保持一致", () => {
  const rootManifest = JSON.parse(fs.readFileSync(
    path.join(repoRoot, ".claude-plugin", "plugin.json"),
    "utf8",
  ));
  const bundledManifest = JSON.parse(fs.readFileSync(
    path.join(repoRoot, "hosts", "claude", "marketplace", "plugins", "helloloop", ".claude-plugin", "plugin.json"),
    "utf8",
  ));

  assert.equal(bundledManifest.name, rootManifest.name);
  assert.equal(bundledManifest.version, rootManifest.version);
  assert.equal(bundledManifest.license, rootManifest.license);
  assert.equal(bundledManifest.homepage, rootManifest.homepage);
  assert.deepEqual(bundledManifest.repository, rootManifest.repository);
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
  const claudeManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, ".claude-plugin", "plugin.json"), "utf8"));
  const licenseText = fs.readFileSync(path.join(repoRoot, "LICENSE"), "utf8");

  assert.equal(packageJson.license, "Apache-2.0");
  assert.equal(manifest.license, "Apache-2.0");
  assert.equal(claudeManifest.license, "Apache-2.0");
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

test("公开文档明确未指定引擎时不会自动选择", () => {
  const combined = [
    "README.md",
    "docs/README.md",
    "docs/install.md",
    "docs/multi-cli-architecture.md",
    "docs/plugin-standard.md",
  ].map((file) => fs.readFileSync(path.join(repoRoot, file), "utf8")).join("\n");

  assert.match(combined, /未明确引擎时不会自动选择|只作为推荐依据，不会自动选中/);
});

test("公开文档与宿主提示词已同步新的发现交互，不暴露内部扫描分类", () => {
  const publicDocs = [
    "README.md",
    "docs/install.md",
    "docs/plugin-standard.md",
    "skills/helloloop/SKILL.md",
    "hosts/claude/marketplace/plugins/helloloop/commands/helloloop.md",
    "hosts/claude/marketplace/plugins/helloloop/skills/helloloop/SKILL.md",
    "hosts/gemini/extension/GEMINI.md",
    "hosts/gemini/extension/commands/helloloop.toml",
  ].map((file) => fs.readFileSync(path.join(repoRoot, file), "utf8")).join("\n");

  assert.match(publicDocs, /默认直接把当前目录当作项目目录|默认直接把当前目录作为项目目录/);
  assert.match(publicDocs, /只补充询问开发文档|只会提示补充“开发文档”/);
  assert.doesNotMatch(publicDocs, /顶层文档文件、顶层目录和疑似项目目录/);
});

test("helloloop skill 明确要求优先走主 CLI，而不是手工模拟流程", () => {
  const skill = fs.readFileSync(path.join(repoRoot, "skills", "helloloop", "SKILL.md"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(
    path.join(repoRoot, ".codex-plugin", "plugin.json"),
    "utf8",
  ));

  assert.match(skill, /优先执行 `npx helloloop` 或 `npx helloloop <PATH>`/);
  assert.match(skill, /不允许接管普通 Codex 会话/);
  assert.match(skill, /仅仅提到 `helloloop` 仓库、插件名、README、代码、测试、issue、release、npm 包名，都不算调用/);
  assert.match(skill, /不允许在对话里手工模拟/);
  assert.match(skill, /默认执行映射/);
  assert.match(manifest.interface.longDescription, /只有在用户显式调用 helloloop skill/);
  assert.match(manifest.interface.longDescription, /先分析、再展示确认单、确认后自动接续推进/);
  assert.match(manifest.interface.defaultPrompt[0], /普通 Codex 会话不要自动接管/);
  assert.match(manifest.interface.defaultPrompt[0], /仅仅提到 helloloop 仓库、插件名、README、代码、测试、issue、release、npm 包名，都不算调用/);
  assert.match(manifest.interface.defaultPrompt[0], /优先执行 npx helloloop 或 npx helloloop <PATH>/);
});

test("Claude 与 Gemini 宿主提示词已同步最新工作流约束", () => {
  const claudeCommand = fs.readFileSync(
    path.join(repoRoot, "hosts", "claude", "marketplace", "plugins", "helloloop", "commands", "helloloop.md"),
    "utf8",
  );
  const geminiCommand = fs.readFileSync(
    path.join(repoRoot, "hosts", "gemini", "extension", "commands", "helloloop.toml"),
    "utf8",
  );
  const geminiContext = fs.readFileSync(
    path.join(repoRoot, "hosts", "gemini", "extension", "GEMINI.md"),
    "utf8",
  );

  for (const content of [claudeCommand, geminiCommand, geminiContext]) {
    assert.match(content, /显式调用|不要接管普通/);
    assert.match(content, /自然语言补充要求|语义理解/);
    assert.match(content, /项目.*冲突/);
    assert.match(content, /测试.*验收/);
  }
});

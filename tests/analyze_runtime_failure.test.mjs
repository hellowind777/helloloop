import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildCliEnv,
  spawnHelloLoop,
  writeJson,
  writeText,
} from "./helpers/analyze_cli_fixture.mjs";

function createSchemaFailureCodex(binDir) {
  const stubFile = path.join(binDir, "codex-stub.cjs");
  writeText(stubFile, `
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("codex 0.117.0\\n");
  process.exit(0);
}
process.stdout.write(JSON.stringify({
  type: "error",
  message: JSON.stringify({
    error: {
      message: "Invalid schema for response_format 'codex_output_schema': In context=('properties', 'tasks', 'items'), 'required' is required to be supplied and to be an array including every key in properties. Missing 'dependsOn'.",
      type: "invalid_request_error",
      code: "invalid_json_schema",
    },
  }),
}) + "\\n");
process.exit(1);
`);
  if (process.platform === "win32") {
    writeText(path.join(binDir, "codex.ps1"), "node \"$PSScriptRoot/codex-stub.cjs\" @args\r\nexit $LASTEXITCODE\r\n");
    writeText(path.join(binDir, "claude.ps1"), "Write-Error 'claude unavailable in test' ; exit 1\r\n");
    writeText(path.join(binDir, "gemini.ps1"), "Write-Error 'gemini unavailable in test' ; exit 1\r\n");
    return;
  }

  writeText(path.join(binDir, "codex"), "#!/usr/bin/env sh\nnode \"$(dirname \"$0\")/codex-stub.cjs\" \"$@\"\n");
  fs.chmodSync(path.join(binDir, "codex"), 0o755);
  writeText(path.join(binDir, "claude"), "#!/usr/bin/env sh\necho claude unavailable in test >&2\nexit 1\n");
  fs.chmodSync(path.join(binDir, "claude"), 0o755);
  writeText(path.join(binDir, "gemini"), "#!/usr/bin/env sh\necho gemini unavailable in test >&2\nexit 1\n");
  fs.chmodSync(path.join(binDir, "gemini"), 0o755);
}

test("分析阶段若发生 schema 类硬错误，会写回失败状态而不是停留在初始化状态", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-analyze-runtime-failure-"));
  const fakeBin = path.join(tempRoot, "bin");
  const tempRepo = path.join(tempRoot, "demo-project");

  createSchemaFailureCodex(fakeBin);
  writeText(path.join(tempRepo, "docs", "plan.md"), "# 开发计划\n- 完成主业务流程\n");
  writeText(path.join(tempRepo, "src", "index.js"), "console.log('hello');\n");
  writeJson(path.join(tempRepo, ".helloloop", "policy.json"), {
    runtimeRecovery: {
      enabled: false,
    },
  });

  const result = spawnHelloLoop(["--dry-run"], {
    cwd: tempRepo,
    env: buildCliEnv(fakeBin),
    input: "1\n",
  });

  try {
    assert.equal(result.status, 1, result.stderr);
    const status = JSON.parse(fs.readFileSync(path.join(tempRepo, ".helloloop", "status.json"), "utf8"));
    const stateText = fs.readFileSync(path.join(tempRepo, ".helloloop", "STATE.md"), "utf8");
    const runDirs = fs.readdirSync(path.join(tempRepo, ".helloloop", "runs")).filter((item) => item !== ".gitkeep");

    assert.equal(status.ok, false);
    assert.equal(status.stage, "analysis_failed");
    assert.match(status.message, /Invalid schema|invalid_json_schema/);
    assert.ok(runDirs.length >= 1);
    assert.ok(runDirs.some((item) => status.runDir.endsWith(item)), status.runDir);
    assert.match(stateText, /最近结果：/);
    assert.doesNotMatch(stateText, /HelloLoop 已初始化/);
    assert.match(stateText, /重新执行 npx helloloop/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

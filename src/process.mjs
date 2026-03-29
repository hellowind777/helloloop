import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { ensureDir, nowIso, tailText, writeText } from "./common.mjs";
import { resolveCodexInvocation, resolveVerifyShellInvocation } from "./shell_invocation.mjs";

function runChild(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...(options.env || {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
      shell: Boolean(options.shell),
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    if (options.stdin) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();

    child.on("error", (error) => {
      resolve({
        ok: false,
        code: 1,
        stdout,
        stderr: String(error?.stack || error || ""),
      });
    });

    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function writeCodexRunArtifacts(runDir, prefix, result, finalMessage) {
  writeText(path.join(runDir, `${prefix}-stdout.log`), result.stdout);
  writeText(path.join(runDir, `${prefix}-stderr.log`), result.stderr);
  writeText(path.join(runDir, `${prefix}-summary.txt`), [
    `ok=${result.ok}`,
    `code=${result.code}`,
    `finished_at=${nowIso()}`,
    "",
    finalMessage,
  ].join("\n"));
}

export async function runCodexTask({
  context,
  prompt,
  runDir,
  model = "",
  executable = "",
  sandbox = "workspace-write",
  dangerouslyBypassSandbox = false,
  jsonOutput = true,
  outputSchemaFile = "",
  outputPrefix = "codex",
  ephemeral = false,
  skipGitRepoCheck = false,
  env = {},
}) {
  ensureDir(runDir);

  const lastMessageFile = path.join(runDir, `${outputPrefix}-last-message.txt`);
  const invocation = resolveCodexInvocation({ explicitExecutable: executable });
  const codexArgs = ["exec", "-C", context.repoRoot];

  if (model) {
    codexArgs.push("--model", model);
  }
  if (dangerouslyBypassSandbox) {
    codexArgs.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    codexArgs.push("--sandbox", sandbox);
  }
  if (skipGitRepoCheck) {
    codexArgs.push("--skip-git-repo-check");
  }
  if (ephemeral) {
    codexArgs.push("--ephemeral");
  }
  if (outputSchemaFile) {
    codexArgs.push("--output-schema", outputSchemaFile);
  }
  if (jsonOutput) {
    codexArgs.push("--json");
  }
  codexArgs.push("-o", lastMessageFile, "-");

  if (invocation.error) {
    const result = {
      ok: false,
      code: 1,
      stdout: "",
      stderr: invocation.error,
    };
    writeText(path.join(runDir, `${outputPrefix}-prompt.md`), prompt);
    writeCodexRunArtifacts(runDir, outputPrefix, result, "");
    return { ...result, finalMessage: "" };
  }

  const args = [...invocation.argsPrefix, ...codexArgs];

  const result = await runChild(invocation.command, args, {
    cwd: context.repoRoot,
    stdin: prompt,
    env,
    shell: invocation.shell,
  });
  const finalMessage = fs.existsSync(lastMessageFile)
    ? fs.readFileSync(lastMessageFile, "utf8").trim()
    : "";

  writeText(path.join(runDir, `${outputPrefix}-prompt.md`), prompt);
  writeCodexRunArtifacts(runDir, outputPrefix, result, finalMessage);

  return { ...result, finalMessage };
}

export async function runCodexExec({ context, prompt, runDir, policy }) {
  return runCodexTask({
    context,
    prompt,
    runDir,
    model: policy.codex.model,
    executable: policy.codex.executable,
    sandbox: policy.codex.sandbox,
    dangerouslyBypassSandbox: policy.codex.dangerouslyBypassSandbox,
    jsonOutput: policy.codex.jsonOutput,
    outputPrefix: "codex",
  });
}

export async function runShellCommand(context, commandLine, runDir, index) {
  const shellInvocation = resolveVerifyShellInvocation();
  if (shellInvocation.error) {
    const result = {
      command: commandLine,
      ok: false,
      code: 1,
      stdout: "",
      stderr: shellInvocation.error,
    };
    const prefix = String(index + 1).padStart(2, "0");
    writeText(path.join(runDir, `${prefix}-verify-command.txt`), commandLine);
    writeText(path.join(runDir, `${prefix}-verify-stdout.log`), result.stdout);
    writeText(path.join(runDir, `${prefix}-verify-stderr.log`), result.stderr);
    return result;
  }

  const result = await runChild(shellInvocation.command, [
    ...shellInvocation.argsPrefix,
    commandLine,
  ], {
    cwd: context.repoRoot,
    shell: shellInvocation.shell,
  });

  const prefix = String(index + 1).padStart(2, "0");
  writeText(path.join(runDir, `${prefix}-verify-command.txt`), commandLine);
  writeText(path.join(runDir, `${prefix}-verify-stdout.log`), result.stdout);
  writeText(path.join(runDir, `${prefix}-verify-stderr.log`), result.stderr);

  return { command: commandLine, ...result };
}

export async function runVerifyCommands(context, commands, runDir) {
  const results = [];

  for (const [index, command] of commands.entries()) {
    const result = await runShellCommand(context, command, runDir, index);
    results.push(result);
    if (!result.ok) {
      return {
        ok: false,
        results,
        failed: result,
        summary: [
          `验证失败：${result.command}`,
          "",
          "stdout 尾部：",
          tailText(result.stdout, 40),
          "",
          "stderr 尾部：",
          tailText(result.stderr, 40),
        ].join("\n").trim(),
      };
    }
  }

  return {
    ok: true,
    results,
    failed: null,
    summary: "全部验证命令通过。",
  };
}

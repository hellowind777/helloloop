import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { ensureDir, nowIso, tailText, writeText } from "./common.mjs";

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

function quoteForCmd(value) {
  const normalized = String(value ?? "");
  if (!normalized.length) {
    return "\"\"";
  }
  if (!/[\s"&<>|^]/.test(normalized)) {
    return normalized;
  }
  return `"${normalized.replace(/"/g, "\"\"")}"`;
}

function buildCmdCommandLine(executable, args) {
  return [quoteForCmd(executable), ...args.map((item) => quoteForCmd(item))].join(" ");
}

function resolveCodexExecutable(explicitExecutable = "") {
  if (explicitExecutable) {
    return explicitExecutable;
  }

  if (process.platform !== "win32") {
    return "codex";
  }

  const candidates = ["codex.cmd", "codex", "codex.ps1"];
  for (const candidate of candidates) {
    const result = spawnSync("where.exe", [candidate], {
      encoding: "utf8",
      shell: false,
    });
    if (result.status !== 0) {
      continue;
    }

    const firstLine = String(result.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (firstLine) {
      return firstLine;
    }
  }

  return "codex";
}

function resolveCodexInvocation(explicitExecutable = "") {
  const executable = resolveCodexExecutable(explicitExecutable);

  if (process.platform === "win32" && /\.ps1$/i.test(executable)) {
    return {
      command: "pwsh",
      argsPrefix: ["-NoLogo", "-NoProfile", "-File", executable],
      shell: false,
    };
  }

  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
    return {
      command: "cmd.exe",
      argsPrefix: ["/d", "/s", "/c"],
      executable,
      shell: false,
    };
  }

  return {
    command: executable,
    argsPrefix: [],
    shell: false,
  };
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
  const invocation = resolveCodexInvocation(executable);
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

  const args = invocation.executable
    ? [...invocation.argsPrefix, buildCmdCommandLine(invocation.executable, codexArgs)]
    : [...invocation.argsPrefix, ...codexArgs];

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
  const result = await runChild("pwsh", [
    "-NoLogo",
    "-NoProfile",
    "-Command",
    commandLine,
  ], {
    cwd: context.repoRoot,
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

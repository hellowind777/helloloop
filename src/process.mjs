import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { ensureDir, nowIso, tailText, writeText } from "./common.mjs";
import { getEngineDisplayName, normalizeEngineName } from "./engine_metadata.mjs";
import { resolveCliInvocation, resolveCodexInvocation, resolveVerifyShellInvocation } from "./shell_invocation.mjs";

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

function writeEngineRunArtifacts(runDir, prefix, result, finalMessage) {
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

function readSchemaText(outputSchemaFile = "") {
  return outputSchemaFile && fs.existsSync(outputSchemaFile)
    ? fs.readFileSync(outputSchemaFile, "utf8").trim()
    : "";
}

function resolveEngineInvocation(engine, explicitExecutable = "") {
  const envExecutable = String(process.env[`HELLOLOOP_${String(engine || "").toUpperCase()}_EXECUTABLE`] || "").trim();
  const executable = envExecutable || explicitExecutable;
  if (engine === "codex") {
    return resolveCodexInvocation({ explicitExecutable: executable });
  }

  const meta = {
    claude: {
      commandName: "claude",
      displayName: "Claude",
    },
    gemini: {
      commandName: "gemini",
      displayName: "Gemini",
    },
  }[engine];

  if (!meta) {
    return {
      command: "",
      argsPrefix: [],
      shell: false,
      error: `不支持的执行引擎：${engine}`,
    };
  }

  return resolveCliInvocation({
    commandName: meta.commandName,
    toolDisplayName: meta.displayName,
    explicitExecutable: executable,
  });
}

function buildCodexArgs({
  context,
  model = "",
  sandbox = "workspace-write",
  dangerouslyBypassSandbox = false,
  jsonOutput = true,
  outputSchemaFile = "",
  ephemeral = false,
  skipGitRepoCheck = false,
  lastMessageFile,
}) {
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
  return codexArgs;
}

function buildClaudeArgs({
  model = "",
  outputSchemaFile = "",
  executionMode = "analyze",
  policy = {},
}) {
  const args = [
    "-p",
    executionMode === "analyze"
      ? "请读取标准输入中的完整分析任务并直接输出最终结果。"
      : "请读取标准输入中的完整开发任务并直接完成它。",
    "--output-format",
    policy.outputFormat || "text",
    "--permission-mode",
    executionMode === "analyze"
      ? (policy.analysisPermissionMode || "plan")
      : (policy.permissionMode || "bypassPermissions"),
    "--no-session-persistence",
  ];

  if (model) {
    args.push("--model", model);
  }

  const schemaText = readSchemaText(outputSchemaFile);
  if (schemaText) {
    args.push("--json-schema", schemaText);
  }

  return args;
}

function buildGeminiArgs({
  model = "",
  executionMode = "analyze",
  policy = {},
}) {
  const args = [
    "-p",
    executionMode === "analyze"
      ? "请读取标准输入中的完整分析任务并直接输出最终结果。"
      : "请读取标准输入中的完整开发任务并直接完成它。",
    "--output-format",
    policy.outputFormat || "text",
    "--approval-mode",
    executionMode === "analyze"
      ? (policy.analysisApprovalMode || "plan")
      : (policy.approvalMode || "yolo"),
  ];

  if (model) {
    args.push("--model", model);
  }

  return args;
}

function resolveEnginePolicy(policy = {}, engine) {
  if (engine === "codex") {
    return policy.codex || {};
  }
  if (engine === "claude") {
    return policy.claude || {};
  }
  if (engine === "gemini") {
    return policy.gemini || {};
  }
  return {};
}

export async function runEngineTask({
  engine = "codex",
  context,
  prompt,
  runDir,
  policy = {},
  executionMode = "analyze",
  outputSchemaFile = "",
  outputPrefix = "",
  ephemeral = false,
  skipGitRepoCheck = false,
  env = {},
}) {
  ensureDir(runDir);

  const normalizedEngine = normalizeEngineName(engine) || "codex";
  const resolvedPolicy = resolveEnginePolicy(policy, normalizedEngine);
  const prefix = outputPrefix || normalizedEngine;
  const lastMessageFile = path.join(runDir, `${prefix}-last-message.txt`);
  const invocation = resolveEngineInvocation(normalizedEngine, resolvedPolicy.executable);

  let args = [];
  if (normalizedEngine === "codex") {
    args = buildCodexArgs({
      context,
      model: resolvedPolicy.model,
      sandbox: resolvedPolicy.sandbox,
      dangerouslyBypassSandbox: resolvedPolicy.dangerouslyBypassSandbox,
      jsonOutput: resolvedPolicy.jsonOutput !== false,
      outputSchemaFile,
      ephemeral,
      skipGitRepoCheck,
      lastMessageFile,
    });
  } else if (normalizedEngine === "claude") {
    args = buildClaudeArgs({
      model: resolvedPolicy.model,
      outputSchemaFile,
      executionMode,
      policy: resolvedPolicy,
    });
  } else if (normalizedEngine === "gemini") {
    args = buildGeminiArgs({
      model: resolvedPolicy.model,
      executionMode,
      policy: resolvedPolicy,
    });
  }

  if (invocation.error) {
    const result = {
      ok: false,
      code: 1,
      stdout: "",
      stderr: invocation.error,
    };
    writeText(path.join(runDir, `${prefix}-prompt.md`), prompt);
    writeEngineRunArtifacts(runDir, prefix, result, "");
    return { ...result, finalMessage: "" };
  }

  const finalArgs = [...invocation.argsPrefix, ...args];

  const result = await runChild(invocation.command, finalArgs, {
    cwd: context.repoRoot,
    stdin: prompt,
    env,
    shell: invocation.shell,
  });
  const finalMessage = normalizedEngine === "codex"
    ? (fs.existsSync(lastMessageFile) ? fs.readFileSync(lastMessageFile, "utf8").trim() : "")
    : String(result.stdout || "").trim();

  writeText(path.join(runDir, `${prefix}-prompt.md`), prompt);
  writeEngineRunArtifacts(runDir, prefix, result, finalMessage);

  return { ...result, finalMessage };
}

export async function runCodexTask(options) {
  return runEngineTask({
    ...options,
    engine: "codex",
  });
}

export async function runCodexExec({ context, prompt, runDir, policy }) {
  return runEngineTask({
    engine: "codex",
    context,
    prompt,
    runDir,
    policy,
    executionMode: "execute",
    outputPrefix: "codex",
  });
}

export async function runEngineExec({ engine, context, prompt, runDir, policy }) {
  return runEngineTask({
    engine,
    context,
    prompt,
    runDir,
    policy,
    executionMode: "execute",
    outputPrefix: engine,
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

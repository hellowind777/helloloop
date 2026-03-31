import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { resolveWindowsHiddenShellEnvPatch } from "./windows_hidden_shell_proxy.mjs";

function buildSyncSpawnOptions(platform = process.platform, extra = {}) {
  return {
    ...extra,
    ...(platform === "win32" ? { windowsHide: true } : {}),
  };
}

function createUnavailableInvocation(message) {
  return {
    command: "",
    argsPrefix: [],
    shell: false,
    error: message,
  };
}

function parseWindowsCommandMatches(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function hasCommand(command, platform = process.platform) {
  if (platform === "win32") {
    const result = spawnSync("where.exe", [command], {
      ...buildSyncSpawnOptions(platform, {
        encoding: "utf8",
        shell: false,
      }),
    });
    return result.status === 0;
  }

  const result = spawnSync("sh", ["-lc", `command -v ${command}`], {
    ...buildSyncSpawnOptions(platform, {
      encoding: "utf8",
      shell: false,
    }),
  });
  return result.status === 0;
}

function findWindowsCommandPaths(command, resolver) {
  const lookup = resolver || ((name) => {
    const result = spawnSync("where.exe", [name], {
      ...buildSyncSpawnOptions("win32", {
        encoding: "utf8",
        shell: false,
      }),
    });
    return result.status === 0 ? parseWindowsCommandMatches(result.stdout) : [];
  });

  return lookup(command);
}

function resolveWindowsPowerShellHost(options = {}) {
  const commandExists = options.commandExists || ((command) => hasCommand(command, "win32"));

  if (commandExists("pwsh")) {
    return {
      command: "pwsh",
      shell: false,
    };
  }

  if (commandExists("powershell")) {
    return {
      command: "powershell",
      shell: false,
    };
  }

  return null;
}

function resolveWindowsCommandShell(options = {}) {
  const commandExists = options.commandExists || ((command) => hasCommand(command, "win32"));
  const preferredHosts = [
    {
      check: "pwsh",
      invocation: {
        command: "pwsh",
        argsPrefix: ["-NoLogo", "-NoProfile", "-Command"],
        shell: false,
      },
    },
    {
      check: "bash",
      invocation: {
        command: "bash",
        argsPrefix: ["-lc"],
        shell: false,
      },
    },
    {
      check: "powershell",
      invocation: {
        command: "powershell",
        argsPrefix: ["-NoLogo", "-NoProfile", "-Command"],
        shell: false,
      },
    },
  ];

  for (const host of preferredHosts) {
    if (commandExists(host.check)) {
      return host.invocation;
    }
  }

  return null;
}

function resolvePosixCommandShell(options = {}) {
  const platform = options.platform || process.platform;
  const commandExists = options.commandExists || ((command) => hasCommand(command, platform));

  if (commandExists("bash")) {
    return {
      command: "bash",
      argsPrefix: ["-lc"],
      shell: false,
    };
  }

  return {
    command: "sh",
    argsPrefix: ["-lc"],
    shell: false,
  };
}

function isCmdLikeExecutable(executable) {
  return /\.(cmd|bat)$/i.test(String(executable || ""));
}

function trimOuterQuotes(value) {
  return String(value || "").trim().replace(/^"(.*)"$/u, "$1");
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map((item) => trimOuterQuotes(item)).filter(Boolean))];
}

function resolveWindowsNamedExecutable(toolName, options = {}) {
  const explicitExecutable = String(options.explicitExecutable || "").trim();
  const findCommandPaths = options.findCommandPaths || ((command) => findWindowsCommandPaths(command));

  if (explicitExecutable) {
    return explicitExecutable;
  }

  const searchOrder = [`${toolName}.exe`, `${toolName}.ps1`, toolName];
  for (const query of searchOrder) {
    const safeMatch = findCommandPaths(query).find((candidate) => !isCmdLikeExecutable(candidate));
    if (safeMatch) {
      return safeMatch;
    }
  }

  return "";
}

function resolveNodeHostForWrapper(wrapperPath) {
  const wrapperDir = path.dirname(wrapperPath);
  const bundledNode = path.join(wrapperDir, "node.exe");
  if (fs.existsSync(bundledNode)) {
    return bundledNode;
  }
  return process.execPath || "node";
}

function getUpdatedWindowsPath(newDirs, basePath = process.env.PATH || "") {
  const existing = String(basePath || "")
    .split(";")
    .map((item) => trimOuterQuotes(item))
    .filter(Boolean);
  return uniqueNonEmpty([...newDirs, ...existing]).join(";");
}

function resolveCodexWindowsTargetTriple() {
  if (process.arch === "arm64") {
    return {
      packageName: "@openai/codex-win32-arm64",
      targetTriple: "aarch64-pc-windows-msvc",
      managedEnvKey: "CODEX_MANAGED_BY_NPM",
    };
  }

  if (process.arch === "x64") {
    return {
      packageName: "@openai/codex-win32-x64",
      targetTriple: "x86_64-pc-windows-msvc",
      managedEnvKey: "CODEX_MANAGED_BY_NPM",
    };
  }

  return null;
}

function resolveWindowsNativeCodexInvocation(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== "win32") {
    return null;
  }

  const target = resolveCodexWindowsTargetTriple();
  if (!target) {
    return null;
  }

  const explicitExecutable = trimOuterQuotes(options.explicitExecutable || "");
  if (explicitExecutable && /\.exe$/iu.test(explicitExecutable) && fs.existsSync(explicitExecutable)) {
    return {
      command: explicitExecutable,
      argsPrefix: [],
      shell: false,
    };
  }

  const findCommandPaths = options.findCommandPaths || ((command) => findWindowsCommandPaths(command));
  const wrapperCandidates = [];

  if (explicitExecutable) {
    if (fs.existsSync(explicitExecutable)) {
      wrapperCandidates.push(explicitExecutable);
    } else {
      wrapperCandidates.push(...findCommandPaths(explicitExecutable));
    }
  } else {
    wrapperCandidates.push(...findCommandPaths("codex.ps1"));
    wrapperCandidates.push(...findCommandPaths("codex"));
  }

  for (const wrapperPath of uniqueNonEmpty(wrapperCandidates)) {
    const wrapperDir = path.dirname(wrapperPath);
    const codexPackageRoot = path.join(wrapperDir, "node_modules", "@openai", "codex");
    const vendorRoot = path.join(
      codexPackageRoot,
      "node_modules",
      target.packageName,
      "vendor",
      target.targetTriple,
    );
    const binaryPath = path.join(vendorRoot, "codex", "codex.exe");
    if (!fs.existsSync(binaryPath)) {
      continue;
    }
    const rgPathDir = path.join(vendorRoot, "path");
    const envPatch = {
      [target.managedEnvKey]: "1",
    };
    if (fs.existsSync(rgPathDir)) {
      envPatch.PATH = getUpdatedWindowsPath([rgPathDir], process.env.PATH || "");
    }
    return {
      command: binaryPath,
      argsPrefix: [],
      shell: false,
      env: envPatch,
    };
  }

  return null;
}

function attachWindowsHiddenShellProxy(invocation, options = {}) {
  if (!invocation || (options.platform || process.platform) !== "win32") {
    return invocation;
  }

  try {
    const envPatch = resolveWindowsHiddenShellEnvPatch({
      basePath: invocation.env?.PATH || process.env.PATH || "",
    });
    if (!envPatch || !Object.keys(envPatch).length) {
      return invocation;
    }
    return {
      ...invocation,
      env: {
        ...(invocation.env || {}),
        ...envPatch,
      },
    };
  } catch (error) {
    return {
      ...invocation,
      error: [
        String(invocation.error || "").trim(),
        `HelloLoop 无法准备 Windows 隐藏 shell 代理：${String(error?.message || error || "未知错误")}`,
      ].filter(Boolean).join("\n"),
    };
  }
}

function resolveWindowsNodePackageInvocation(toolName, packageScriptSegments, options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== "win32") {
    return null;
  }

  const explicitExecutable = trimOuterQuotes(options.explicitExecutable || "");
  if (explicitExecutable && /\.m?js$/iu.test(explicitExecutable) && fs.existsSync(explicitExecutable)) {
    return {
      command: process.execPath || "node",
      argsPrefix: [explicitExecutable],
      shell: false,
    };
  }

  const findCommandPaths = options.findCommandPaths || ((command) => findWindowsCommandPaths(command));
  const wrapperCandidates = [];

  if (explicitExecutable) {
    if (fs.existsSync(explicitExecutable)) {
      wrapperCandidates.push(explicitExecutable);
    } else {
      wrapperCandidates.push(...findCommandPaths(explicitExecutable));
    }
  }

  if (!wrapperCandidates.length) {
    wrapperCandidates.push(...findCommandPaths(`${toolName}.ps1`));
    wrapperCandidates.push(...findCommandPaths(`${toolName}.exe`));
    wrapperCandidates.push(...findCommandPaths(toolName));
  }

  for (const wrapperPath of uniqueNonEmpty(wrapperCandidates)) {
    if (isCmdLikeExecutable(wrapperPath) || !fs.existsSync(wrapperPath)) {
      continue;
    }
    const packageScript = path.join(path.dirname(wrapperPath), "node_modules", ...packageScriptSegments);
    if (!fs.existsSync(packageScript)) {
      continue;
    }
    return {
      command: resolveNodeHostForWrapper(wrapperPath),
      argsPrefix: [packageScript],
      shell: false,
    };
  }

  return null;
}

export function resolveVerifyShellInvocation(options = {}) {
  const platform = options.platform || process.platform;

  if (platform === "win32") {
    const host = resolveWindowsCommandShell(options);
    if (!host) {
      return createUnavailableInvocation(
        "Windows 环境需要 pwsh、bash（如 Git Bash）或 powershell 才能安全执行验证命令；HelloLoop 已禁止回退到 cmd.exe。",
      );
    }
    return host;
  }

  return resolvePosixCommandShell(options);
}

export function resolveCliInvocation(options = {}) {
  const platform = options.platform || process.platform;
  const explicitExecutable = String(options.explicitExecutable || "").trim();
  const commandName = String(options.commandName || "").trim();
  const toolDisplayName = String(options.toolDisplayName || commandName || "CLI");

  if (!commandName && !explicitExecutable) {
    return createUnavailableInvocation("未提供 CLI 名称或显式可执行路径。");
  }

  if (platform !== "win32") {
    return {
      command: explicitExecutable || commandName,
      argsPrefix: [],
      shell: false,
    };
  }

  const executable = resolveWindowsNamedExecutable(commandName, {
    explicitExecutable,
    findCommandPaths: options.findCommandPaths,
  });
  if (!executable) {
    return createUnavailableInvocation(
      `未找到可安全执行的 ${toolDisplayName} 入口。Windows 环境需要 ${commandName}.ps1、${commandName}.exe 或其他非 cmd 的可执行入口。`,
    );
  }

  if (isCmdLikeExecutable(executable)) {
    return createUnavailableInvocation(
      `HelloLoop 在 Windows 已禁止通过 cmd/bat 启动 ${toolDisplayName}：${executable}`,
    );
  }

  if (/\.ps1$/i.test(executable)) {
    const host = resolveWindowsPowerShellHost(options);
    if (!host) {
      return createUnavailableInvocation(
        `需要 pwsh 或 powershell 才能安全执行 ${executable}；HelloLoop 不会回退到 cmd.exe。`,
      );
    }

    return {
      command: host.command,
      argsPrefix: ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", executable],
      shell: host.shell,
    };
  }

  return {
    command: executable,
    argsPrefix: [],
    shell: false,
  };
}

export function resolveCodexInvocation(options = {}) {
  const nativeCodexInvocation = resolveWindowsNativeCodexInvocation(options);
  if (nativeCodexInvocation) {
    return attachWindowsHiddenShellProxy(nativeCodexInvocation, options);
  }

  const nodePackageInvocation = resolveWindowsNodePackageInvocation("codex", ["@openai", "codex", "bin", "codex.js"], options);
  if (nodePackageInvocation) {
    return attachWindowsHiddenShellProxy(nodePackageInvocation, options);
  }

  return attachWindowsHiddenShellProxy(resolveCliInvocation({
    ...options,
    commandName: "codex",
    toolDisplayName: "Codex",
  }), options);
}

export function resolveClaudeInvocation(options = {}) {
  return resolveCliInvocation({
    ...options,
    commandName: "claude",
    toolDisplayName: "Claude",
  });
}

export function resolveGeminiInvocation(options = {}) {
  return resolveCliInvocation({
    ...options,
    commandName: "gemini",
    toolDisplayName: "Gemini",
  });
}

import { spawnSync } from "node:child_process";

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
      encoding: "utf8",
      shell: false,
    });
    return result.status === 0;
  }

  const result = spawnSync("sh", ["-lc", `command -v ${command}`], {
    encoding: "utf8",
    shell: false,
  });
  return result.status === 0;
}

function findWindowsCommandPaths(command, resolver) {
  const lookup = resolver || ((name) => {
    const result = spawnSync("where.exe", [name], {
      encoding: "utf8",
      shell: false,
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

function resolveWindowsNamedExecutable(toolName, options = {}) {
  const explicitExecutable = String(options.explicitExecutable || "").trim();
  const findCommandPaths = options.findCommandPaths || ((command) => findWindowsCommandPaths(command));

  if (explicitExecutable) {
    return explicitExecutable;
  }

  const searchOrder = [`${toolName}.ps1`, `${toolName}.exe`, toolName];
  for (const query of searchOrder) {
    const safeMatch = findCommandPaths(query).find((candidate) => !isCmdLikeExecutable(candidate));
    if (safeMatch) {
      return safeMatch;
    }
  }

  return "";
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
  return resolveCliInvocation({
    ...options,
    commandName: "codex",
    toolDisplayName: "Codex",
  });
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

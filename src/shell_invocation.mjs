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

function isCmdLikeExecutable(executable) {
  return /\.(cmd|bat)$/i.test(String(executable || ""));
}

function resolveWindowsCodexExecutable(options = {}) {
  const explicitExecutable = String(options.explicitExecutable || "").trim();
  const findCommandPaths = options.findCommandPaths || ((command) => findWindowsCommandPaths(command));

  if (explicitExecutable) {
    return explicitExecutable;
  }

  const searchOrder = ["codex.ps1", "codex.exe", "codex"];
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
    const host = resolveWindowsPowerShellHost(options);
    if (!host) {
      return createUnavailableInvocation(
        "Windows 环境需要 pwsh 或 powershell 才能安全执行验证命令；HelloLoop 已禁止回退到 cmd.exe。",
      );
    }

    return {
      command: host.command,
      argsPrefix: ["-NoLogo", "-NoProfile", "-Command"],
      shell: host.shell,
    };
  }

  return {
    command: "sh",
    argsPrefix: ["-lc"],
    shell: false,
  };
}

export function resolveCodexInvocation(options = {}) {
  const platform = options.platform || process.platform;
  const explicitExecutable = String(options.explicitExecutable || "").trim();

  if (platform !== "win32") {
    return {
      command: explicitExecutable || "codex",
      argsPrefix: [],
      shell: false,
    };
  }

  const executable = resolveWindowsCodexExecutable({
    explicitExecutable,
    findCommandPaths: options.findCommandPaths,
  });
  if (!executable) {
    return createUnavailableInvocation(
      "未找到可安全执行的 codex 入口。Windows 环境需要 codex.ps1、codex.exe 或其他非 cmd 的可执行入口。",
    );
  }

  if (isCmdLikeExecutable(executable)) {
    return createUnavailableInvocation(
      `HelloLoop 在 Windows 已禁止通过 cmd/bat 启动 Codex：${executable}`,
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

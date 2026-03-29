import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveCodexInvocation,
  resolveVerifyShellInvocation,
} from "../src/shell_invocation.mjs";

test("验证命令在 Windows 优先使用 pwsh", () => {
  const result = resolveVerifyShellInvocation({
    platform: "win32",
    commandExists: (command) => command === "pwsh",
  });

  assert.deepEqual(result, {
    command: "pwsh",
    argsPrefix: ["-NoLogo", "-NoProfile", "-Command"],
    shell: false,
  });
});

test("验证命令在 Windows 无 pwsh 时回退到 powershell", () => {
  const result = resolveVerifyShellInvocation({
    platform: "win32",
    commandExists: (command) => command === "powershell",
  });

  assert.deepEqual(result, {
    command: "powershell",
    argsPrefix: ["-NoLogo", "-NoProfile", "-Command"],
    shell: false,
  });
});

test("验证命令在 Windows 无 PowerShell 时直接报错，不再回退到 cmd", () => {
  const result = resolveVerifyShellInvocation({
    platform: "win32",
    commandExists: () => false,
  });

  assert.equal(result.command, "");
  assert.equal(result.shell, false);
  assert.match(result.error, /禁止回退到 cmd\.exe/);
});

test("验证命令在 macOS 和 Linux 使用 sh", () => {
  const linuxResult = resolveVerifyShellInvocation({
    platform: "linux",
  });
  const darwinResult = resolveVerifyShellInvocation({
    platform: "darwin",
  });

  assert.deepEqual(linuxResult, {
    command: "sh",
    argsPrefix: ["-lc"],
    shell: false,
  });
  assert.deepEqual(darwinResult, {
    command: "sh",
    argsPrefix: ["-lc"],
    shell: false,
  });
});

test("Windows 显式指定 codex.ps1 时通过 PowerShell 安全执行", () => {
  const result = resolveCodexInvocation({
    platform: "win32",
    explicitExecutable: "C:\\tools\\codex.ps1",
    commandExists: (command) => command === "pwsh",
  });

  assert.deepEqual(result, {
    command: "pwsh",
    argsPrefix: ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\tools\\codex.ps1"],
    shell: false,
  });
});

test("Windows 显式指定 codex.cmd 时直接拒绝", () => {
  const result = resolveCodexInvocation({
    platform: "win32",
    explicitExecutable: "C:\\tools\\codex.cmd",
    commandExists: () => true,
  });

  assert.equal(result.command, "");
  assert.match(result.error, /禁止通过 cmd\/bat 启动 Codex/);
});

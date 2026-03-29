import test from "node:test";
import assert from "node:assert/strict";

import { resolveVerifyShellInvocation } from "../src/process.mjs";

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

test("验证命令在 Windows 无 PowerShell 时回退到 cmd", () => {
  const result = resolveVerifyShellInvocation({
    platform: "win32",
    commandExists: () => false,
  });

  assert.deepEqual(result, {
    command: "cmd.exe",
    argsPrefix: ["/d", "/s", "/c"],
    shell: false,
  });
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

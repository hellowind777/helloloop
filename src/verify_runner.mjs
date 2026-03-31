import path from "node:path";

import { tailText, writeText } from "./common.mjs";
import { resolveVerifyInvocation, runChild } from "./engine_process_support.mjs";
import { isHostLeaseAlive } from "./host_lease.mjs";
import { buildHostLeaseStoppedResult } from "./runtime_engine_support.mjs";

export async function runShellCommand(context, commandLine, runDir, index, options = {}) {
  if (!isHostLeaseAlive(options.hostLease)) {
    const stopped = buildHostLeaseStoppedResult("检测到宿主窗口已关闭，HelloLoop 已停止当前验证命令。");
    const prefix = String(index + 1).padStart(2, "0");
    writeText(path.join(runDir, `${prefix}-verify-command.txt`), commandLine);
    writeText(path.join(runDir, `${prefix}-verify-stdout.log`), stopped.stdout);
    writeText(path.join(runDir, `${prefix}-verify-stderr.log`), stopped.stderr);
    return { command: commandLine, ...stopped };
  }

  const shellInvocation = resolveVerifyInvocation();
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
    shouldKeepRunning() {
      return isHostLeaseAlive(options.hostLease);
    },
    leaseStopReason: "检测到宿主窗口已关闭，HelloLoop 已停止当前验证命令。",
  });

  const prefix = String(index + 1).padStart(2, "0");
  writeText(path.join(runDir, `${prefix}-verify-command.txt`), commandLine);
  writeText(path.join(runDir, `${prefix}-verify-stdout.log`), result.stdout);
  writeText(path.join(runDir, `${prefix}-verify-stderr.log`), result.stderr);

  return { command: commandLine, ...result };
}

export async function runVerifyCommands(context, commands, runDir, options = {}) {
  const results = [];

  for (const [index, command] of commands.entries()) {
    const result = await runShellCommand(context, command, runDir, index, options);
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

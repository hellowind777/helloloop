import { runEngineTask } from "./runtime_engine_task.mjs";
import { runShellCommand, runVerifyCommands } from "./verify_runner.mjs";

export { runEngineTask, runShellCommand, runVerifyCommands };

export async function runCodexTask(options) {
  return runEngineTask({
    ...options,
    engine: "codex",
  });
}

export async function runCodexExec({ context, prompt, runDir, policy, hostLease = null }) {
  return runEngineTask({
    engine: "codex",
    context,
    prompt,
    runDir,
    policy,
    executionMode: "execute",
    outputPrefix: "codex",
    skipGitRepoCheck: true,
    hostLease,
  });
}

export async function runEngineExec({ engine, context, prompt, runDir, policy, hostLease = null }) {
  return runEngineTask({
    engine,
    context,
    prompt,
    runDir,
    policy,
    executionMode: "execute",
    outputPrefix: engine,
    skipGitRepoCheck: engine === "codex",
    hostLease,
  });
}

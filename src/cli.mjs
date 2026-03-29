import { normalizeAnalyzeOptions } from "./analyze_user_input.mjs";
import { printHelp, parseArgs } from "./cli_args.mjs";
import { handleAnalyzeCommand } from "./cli_analyze_command.mjs";
import {
  handleDoctorCommand,
  handleInitCommand,
  handleInstallCommand,
  handleNextCommand,
  handleRunLoopCommand,
  handleRunOnceCommand,
  handleStatusCommand,
  handleUninstallCommand,
} from "./cli_command_handlers.mjs";
import { resolveContextFromOptions, resolveStandardCommandOptions } from "./cli_context.mjs";
import { runDoctor } from "./cli_support.mjs";

export async function runCli(argv) {
  const parsed = parseArgs(argv);
  const command = parsed.command;
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "analyze") {
    process.exitCode = await handleAnalyzeCommand(normalizeAnalyzeOptions(parsed.options, process.cwd()));
    return;
  }

  const options = resolveStandardCommandOptions(parsed.options);
  if (command === "install") {
    process.exitCode = handleInstallCommand(options);
    return;
  }
  if (command === "uninstall") {
    process.exitCode = handleUninstallCommand(options);
    return;
  }

  const context = resolveContextFromOptions(options);
  const handlers = {
    doctor: () => handleDoctorCommand(context, options, runDoctor),
    init: () => handleInitCommand(context),
    next: () => handleNextCommand(context, options),
    "run-loop": () => handleRunLoopCommand(context, options),
    "run-once": () => handleRunOnceCommand(context, options),
    status: () => handleStatusCommand(context, options),
  };
  if (!handlers[command]) {
    throw new Error(`未知命令：${command}`);
  }

  process.exitCode = await handlers[command]();
}

import { normalizeAnalyzeOptions } from "./analyze_user_input.mjs";
import { printHelp, parseArgs } from "./cli_args.mjs";
import { handleAnalyzeCommand } from "./cli_analyze_command.mjs";
import {
  handleDoctorCommand,
  handleDashboardCommand,
  handleInitCommand,
  handleInstallCommand,
  handleNextCommand,
  handleResumeHostCommand,
  handleRunLoopCommand,
  handleRunOnceCommand,
  handleStatusCommand,
  handleTuiCommand,
  handleUninstallCommand,
  handleWebCommand,
  handleWatchCommand,
} from "./cli_command_handlers.mjs";
import { resolveContextFromOptions, resolveStandardCommandOptions } from "./cli_context.mjs";
import { runDoctor } from "./cli_support.mjs";
import { runSupervisorGuardianFromSessionFile } from "./supervisor_guardian.mjs";
import { runDashboardWebCommand } from "./dashboard_web.mjs";
import { runSupervisedCommandFromSessionFile } from "./supervisor_runtime.mjs";
import {
  launchDetachedBackgroundCli,
  shouldUseDetachedBackgroundLaunch,
  HELLOLOOP_BACKGROUND_LAUNCH_ENV,
} from "./background_launch.mjs";
import {
  acquireVisibleTerminalSession,
  releaseCurrentTerminalSession,
  shouldTrackVisibleTerminalCommand,
} from "./terminal_session_limits.mjs";

export async function runCli(argv) {
  try {
    const parsed = parseArgs(argv);
    const command = parsed.command;
    if (command === "help" || command === "--help" || command === "-h") {
      printHelp();
      return;
    }
    if (command === "__supervise") {
      if (!parsed.options.sessionFile) {
        throw new Error("缺少 --session-file，无法启动 HelloLoop supervisor。");
      }
      await runSupervisorGuardianFromSessionFile(parsed.options.sessionFile);
      return;
    }
    if (command === "__supervise-worker") {
      if (!parsed.options.sessionFile) {
        throw new Error("缺少 --session-file，无法启动 HelloLoop supervisor worker。");
      }
      await runSupervisedCommandFromSessionFile(parsed.options.sessionFile);
      return;
    }
    if (command === "__web-server") {
      process.exitCode = await runDashboardWebCommand({
        ...parsed.options,
        foreground: true,
      });
      return;
    }

    if (shouldUseDetachedBackgroundLaunch(command, parsed.options)) {
      launchDetachedBackgroundCli(argv, parsed.options);
      return;
    }

    if (
      process.env.HELLOLOOP_SUPERVISOR_ACTIVE !== "1"
      && process.env[HELLOLOOP_BACKGROUND_LAUNCH_ENV] !== "1"
      && shouldTrackVisibleTerminalCommand(command)
    ) {
      acquireVisibleTerminalSession({
        command,
        repoRoot: process.cwd(),
      });
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

    if (command === "dashboard") {
      process.exitCode = await handleDashboardCommand(options);
      return;
    }
    if (command === "tui") {
      process.exitCode = await handleTuiCommand(options);
      return;
    }
    if (command === "web") {
      process.exitCode = await handleWebCommand(options);
      return;
    }

    const context = resolveContextFromOptions(options);
    const handlers = {
      doctor: () => handleDoctorCommand(context, options, runDoctor),
      init: () => handleInitCommand(context),
      next: () => handleNextCommand(context, options),
      "resume-host": () => handleResumeHostCommand(context, options),
      "run-loop": () => handleRunLoopCommand(context, options),
      "run-once": () => handleRunOnceCommand(context, options),
      status: () => handleStatusCommand(context, options),
      watch: () => handleWatchCommand(context, options),
    };
    if (!handlers[command]) {
      throw new Error(`未知命令：${command}`);
    }

    process.exitCode = await handlers[command]();
  } finally {
    releaseCurrentTerminalSession();
  }
}

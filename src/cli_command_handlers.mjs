import path from "node:path";

import { createContext } from "./context.mjs";
import { runDashboardCommand } from "./dashboard_command.mjs";
import { runDashboardTuiCommand } from "./dashboard_tui.mjs";
import { runDashboardWebCommand } from "./dashboard_web.mjs";
import { loadBacklog, scaffoldIfMissing } from "./config.mjs";
import { syncUserSettingsFile } from "./engine_selection_settings.mjs";
import { readHostContinuationSnapshot, runHostContinuationCommand } from "./host_continuation.mjs";
import { installPluginBundle, uninstallPluginBundle } from "./install.mjs";
import { runLoop, runOnce, renderStatusText } from "./runner.mjs";
import { collectRepoStatusSnapshot } from "./runner_status.mjs";
import { renderInstallSummary, renderUninstallSummary } from "./cli_render.mjs";
import { clearPausedMainline, pauseMainline } from "./supervisor_control.mjs";
import {
  launchAndMaybeWatchSupervisedCommand,
  shouldUseSupervisor,
} from "./supervisor_cli_support.mjs";
import { watchSupervisorSessionWithRecovery } from "./supervisor_watch.mjs";

export function handleInstallCommand(options) {
  const userSettings = syncUserSettingsFile({
    userSettingsFile: options.userSettingsFile,
  });
  const context = createContext({
    repoRoot: options.repoRoot,
    configDirName: options.configDirName,
  });
  const result = installPluginBundle({
    bundleRoot: context.bundleRoot,
    host: options.host,
    codexHome: options.codexHome,
    claudeHome: options.claudeHome,
    geminiHome: options.geminiHome,
    force: options.force,
    userSettings,
  });
  console.log(renderInstallSummary(result));
  return 0;
}

export function handleUninstallCommand(options) {
  const result = uninstallPluginBundle({
    host: options.host,
    codexHome: options.codexHome,
    claudeHome: options.claudeHome,
    geminiHome: options.geminiHome,
  });
  console.log(renderUninstallSummary(result));
  return 0;
}

export function handleInitCommand(context) {
  const created = scaffoldIfMissing(context);
  if (!created.length) {
    console.log("HelloLoop 配置已存在，无需初始化。");
    return 0;
  }

  console.log([
    "已初始化以下文件：",
    ...created.map((item) => `- ${path.relative(context.repoRoot, item).replaceAll("\\", "/")}`),
  ].join("\n"));
  return 0;
}

export async function handleDoctorCommand(context, options, runDoctor) {
  await runDoctor(context, options);
  return 0;
}

export async function handleStatusCommand(context, options) {
  const hostResume = readHostContinuationSnapshot(context, {
    refresh: true,
    sessionId: options.sessionId || "",
  });
  if (options.json) {
    console.log(JSON.stringify({
      ...collectRepoStatusSnapshot(context, options),
      hostResume,
    }, null, 2));
  } else {
    console.log(renderStatusText(context, {
      ...options,
      hostResume,
    }));
  }
  if (!options.watch) {
    return 0;
  }

  const result = await watchSupervisorSessionWithRecovery(context, {
    sessionId: options.sessionId,
    pollMs: options.watchPollMs,
    globalConfigFile: options.globalConfigFile,
  });
  if (result.empty) {
    console.log("当前没有正在运行的后台 supervisor。");
    return 1;
  }
  return result.exitCode || 0;
}

export async function handleDashboardCommand(options) {
  if (options.json === true) {
    return runDashboardCommand(options);
  }
  return runDashboardTuiCommand(options);
}

export async function handleTuiCommand(options) {
  return runDashboardTuiCommand(options);
}

export async function handleWebCommand(options) {
  return runDashboardWebCommand(options);
}

export async function handleResumeHostCommand(context, options) {
  return runHostContinuationCommand(context, options);
}

export async function handlePauseMainlineCommand(context, options) {
  const result = await pauseMainline(context, options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  console.log([
    "已暂停当前主线。",
    `- 会话：${result.sessionId}`,
    `- 动作：${result.command}`,
    `- 说明：${result.message}`,
  ].join("\n"));
  return 0;
}

export async function handleWatchCommand(context, options) {
  const result = await watchSupervisorSessionWithRecovery(context, {
    sessionId: options.sessionId,
    pollMs: options.watchPollMs,
    globalConfigFile: options.globalConfigFile,
  });
  if (result.empty) {
    console.log("当前没有正在运行的后台 supervisor。");
    return 1;
  }
  return result.exitCode || 0;
}

export async function handleNextCommand(context, options) {
  const result = await runOnce(context, { ...options, dryRun: true });
  if (!result.task) {
    console.log("当前没有可执行任务。");
    return 0;
  }

  console.log([
    "下一任务预览",
    "============",
    `任务：${result.task.title}`,
    `编号：${result.task.id}`,
    `运行目录：${result.runDir}`,
    "",
    "验证命令：",
    ...result.verifyCommands.map((item) => `- ${item}`),
    "",
    "提示词：",
    result.prompt,
  ].join("\n"));
  return 0;
}

export async function handleRunOnceCommand(context, options) {
  if (shouldUseSupervisor(options)) {
    const payload = await launchAndMaybeWatchSupervisedCommand(context, "run-once", options);
    return payload.exitCode || 0;
  }

  if (!options.dryRun) {
    clearPausedMainline(context);
  }
  const result = await runOnce(context, options);
  if (!result.ok) {
    console.error(result.summary || "执行失败。");
    return 1;
  }
  if (options.dryRun) {
    console.log(result.task
      ? `已生成干跑预览：${result.task.title}\n运行目录：${result.runDir}`
      : "当前没有可执行任务。");
    return 0;
  }

  console.log(result.task
    ? `完成任务：${result.task.title}\n运行目录：${result.runDir}`
    : "没有可执行任务。");
  return 0;
}

export async function handleRunLoopCommand(context, options) {
  if (shouldUseSupervisor(options)) {
    const payload = await launchAndMaybeWatchSupervisedCommand(context, "run-loop", options);
    return payload.exitCode || 0;
  }

  clearPausedMainline(context);
  const results = await runLoop(context, options);
  const failed = results.find((item) => !item.ok);

  for (const item of results) {
    if (!item.task) {
      console.log("没有更多可执行任务。");
      break;
    }
    console.log(`${item.ok ? "成功" : "失败"}：${item.task.title}`);
  }

  if (failed) {
    console.error(failed.summary || "连续执行中断。");
    return 1;
  }
  return 0;
}

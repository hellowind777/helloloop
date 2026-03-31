import path from "node:path";

import { createContext } from "./context.mjs";
import { loadBacklog, scaffoldIfMissing } from "./config.mjs";
import { resolveHostContext } from "./engine_selection.mjs";
import { syncUserSettingsFile } from "./engine_selection_settings.mjs";
import { installPluginBundle, uninstallPluginBundle } from "./install.mjs";
import { runLoop, runOnce, renderStatusText } from "./runner.mjs";
import { renderInstallSummary, renderUninstallSummary } from "./cli_render.mjs";
import {
  launchSupervisedCommand,
  renderSupervisorLaunchSummary,
  waitForSupervisedResult,
} from "./supervisor_runtime.mjs";

function shouldUseSupervisor(options = {}) {
  return !options.dryRun
    && process.env.HELLOLOOP_SUPERVISOR_ACTIVE !== "1"
    && (Boolean(options.supervised) || resolveHostContext(options) !== "terminal");
}

function shouldDetachSupervisor(options = {}) {
  return resolveHostContext(options) !== "terminal";
}

async function runSupervised(context, command, options = {}) {
  const session = launchSupervisedCommand(context, command, options);
  console.log(renderSupervisorLaunchSummary(session));
  if (shouldDetachSupervisor(options)) {
    console.log("- 已切换为后台执行；可稍后运行 `helloloop status` 查看进度。");
    return {
      detached: true,
      exitCode: 0,
      ok: true,
      session,
    };
  }
  return waitForSupervisedResult(context, session);
}

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

export function handleStatusCommand(context, options) {
  console.log(renderStatusText(context, options));
  return 0;
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
    const payload = await runSupervised(context, "run-once", options);
    if (payload.detached) {
      return payload.exitCode || 0;
    }
    if (!payload.result) {
      console.error(payload.error || "HelloLoop supervisor 执行失败。");
      return payload.exitCode || 1;
    }

    const result = payload.result;
    if (!result.ok) {
      console.error(result.summary || "执行失败。");
      return payload.exitCode || 1;
    }

    console.log(result.task
      ? `完成任务：${result.task.title}\n运行目录：${result.runDir}`
      : "没有可执行任务。");
    return 0;
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
    const payload = await runSupervised(context, "run-loop", options);
    if (payload.detached) {
      return payload.exitCode || 0;
    }
    if (!payload.results) {
      console.error(payload.error || "HelloLoop supervisor 执行失败。");
      return payload.exitCode || 1;
    }

    const failed = payload.results.find((item) => !item.ok);
    for (const item of payload.results) {
      if (!item.task) {
        console.log("没有更多可执行任务。");
        break;
      }
      console.log(`${item.ok ? "成功" : "失败"}：${item.task.title}`);
    }
    if (failed) {
      console.error(failed.summary || "连续执行中断。");
      return payload.exitCode || 1;
    }
    return 0;
  }

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

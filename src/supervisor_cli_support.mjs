import { launchSupervisedCommand, renderSupervisorLaunchSummary } from "./supervisor_runtime.mjs";
import { watchSupervisorSession } from "./supervisor_watch.mjs";

export function shouldUseSupervisor(options = {}) {
  return !options.dryRun
    && process.env.HELLOLOOP_SUPERVISOR_ACTIVE !== "1";
}

export function shouldAutoWatchSupervisor(options = {}) {
  if (options.detach) {
    return false;
  }
  if (options.watch === true) {
    return true;
  }
  if (options.watch === false) {
    return false;
  }
  return Boolean(process.stdout.isTTY);
}

export async function launchAndMaybeWatchSupervisedCommand(context, command, options = {}) {
  const session = launchSupervisedCommand(context, command, options);
  console.log(renderSupervisorLaunchSummary(session));

  if (!shouldAutoWatchSupervisor(options)) {
    console.log("- 已切换为后台执行；可稍后运行 `helloloop watch` 或 `helloloop status` 查看进度。");
    return {
      detached: true,
      exitCode: 0,
      ok: true,
      session,
    };
  }

  console.log("- 已进入附着观察模式；按 Ctrl+C 仅退出观察，不会停止后台任务。");
  const watchResult = await watchSupervisorSession(context, {
    sessionId: session.sessionId,
    pollMs: options.watchPollMs,
  });
  return {
    detached: false,
    exitCode: watchResult.exitCode,
    ok: watchResult.ok,
    session,
    watchResult,
  };
}

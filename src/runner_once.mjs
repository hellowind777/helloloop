import { selectNextTask, summarizeBacklog } from "./backlog.mjs";
import { loadBacklog, writeStateMarkdown, writeStatus } from "./config.mjs";
import { executeSingleTask } from "./runner_execute_task.mjs";
import { renderStatusMarkdown } from "./runner_status.mjs";

export async function runOnce(context, options = {}) {
  const result = await executeSingleTask(context, options);
  const backlog = loadBacklog(context);
  const summary = summarizeBacklog(backlog);
  const nextTask = selectNextTask(backlog, options);

  writeStatus(context, {
    ok: result.ok,
    sessionId: options.supervisorSessionId || "",
    stage: result.kind,
    taskId: result.task?.id || null,
    taskTitle: result.task?.title || "",
    runDir: result.runDir || "",
    summary,
    message: result.summary || result.finalMessage || "",
  });
  writeStateMarkdown(context, renderStatusMarkdown(context, {
    summary,
    currentTask: result.task,
    lastResult: result.ok ? "本轮成功" : (result.summary || result.kind),
    nextTask,
  }));

  return result;
}

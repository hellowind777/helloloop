import path from "node:path";

import { analyzeExecution } from "./backlog.mjs";
import { renderAnalyzeConfirmation, resolveAutoRunMaxTasks } from "./analyze_confirmation.mjs";
import {
  confirmAutoExecution,
  renderAnalyzeStopMessage,
  renderAutoRunSummary,
  runDoctor,
} from "./cli_support.mjs";
import { createContext } from "./context.mjs";
import { analyzeWorkspace } from "./analyzer.mjs";
import { loadBacklog, scaffoldIfMissing } from "./config.mjs";
import { resolveRepoRoot } from "./discovery.mjs";
import { installPluginBundle } from "./install.mjs";
import { runLoop, runOnce, renderStatusText } from "./runner.mjs";

const REPO_ROOT_PLACEHOLDER = "<REPO_ROOT>";
const DOCS_PATH_PLACEHOLDER = "<DOCS_PATH>";
const KNOWN_COMMANDS = new Set([
  "analyze",
  "install",
  "init",
  "status",
  "next",
  "run-once",
  "run-loop",
  "doctor",
  "help",
  "--help",
  "-h",
]);

function parseArgs(argv) {
  const [first = "", ...restArgs] = argv;
  const command = !first
    ? "analyze"
    : (KNOWN_COMMANDS.has(first) ? first : "analyze");
  const rest = !first
    ? []
    : (KNOWN_COMMANDS.has(first) ? restArgs : argv);
  const options = {
    requiredDocs: [],
    constraints: [],
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--allow-high-risk") options.allowHighRisk = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--task-id") { options.taskId = rest[index + 1]; index += 1; }
    else if (arg === "--max-tasks") { options.maxTasks = Number(rest[index + 1]); index += 1; }
    else if (arg === "--max-attempts") { options.maxAttempts = Number(rest[index + 1]); index += 1; }
    else if (arg === "--max-strategies") { options.maxStrategies = Number(rest[index + 1]); index += 1; }
    else if (arg === "--repo") { options.repoRoot = rest[index + 1]; index += 1; }
    else if (arg === "--docs") { options.docsPath = rest[index + 1]; index += 1; }
    else if (arg === "--host") { options.host = rest[index + 1]; index += 1; }
    else if (arg === "--codex-home") { options.codexHome = rest[index + 1]; index += 1; }
    else if (arg === "--claude-home") { options.claudeHome = rest[index + 1]; index += 1; }
    else if (arg === "--gemini-home") { options.geminiHome = rest[index + 1]; index += 1; }
    else if (arg === "--config-dir") { options.configDirName = rest[index + 1]; index += 1; }
    else if (arg === "--required-doc") { options.requiredDocs.push(rest[index + 1]); index += 1; }
    else if (arg === "--constraint") { options.constraints.push(rest[index + 1]); index += 1; }
    else if (!options.inputPath) { options.inputPath = arg; }
    else {
      throw new Error(`未知参数：${arg}`);
    }
  }

  return { command, options };
}

function helpText() {
  return [
    "用法：helloloop [command] [path] [options]",
    "",
    "命令：",
    "  analyze               自动分析并生成执行确认单；确认后继续自动接续开发（默认）",
    "  install               安装插件到 Codex Home（适合 npx / npm bin 分发）",
    "  init                  初始化 .helloloop 配置",
    "  status                查看 backlog 与下一任务",
    "  next                  生成下一任务干跑预览",
    "  run-once              执行一个任务",
    "  run-loop              连续执行多个任务",
    "  doctor                检查 Codex、当前插件 bundle 与目标仓库 .helloloop 配置是否可用",
    "",
    "选项：",
    "  --host <name>        安装宿主：codex | claude | gemini | all（默认 codex）",
    "  --codex-home <dir>    Codex Home，install 默认使用 ~/.codex",
    "  --claude-home <dir>   Claude Home，install 默认使用 ~/.claude",
    "  --gemini-home <dir>   Gemini Home，install 默认使用 ~/.gemini",
    "  --repo <dir>          高级选项：显式指定项目仓库根目录",
    "  --docs <dir|file>     高级选项：显式指定开发文档目录或文件",
    "  --config-dir <dir>    配置目录，默认 .helloloop",
    "  -y, --yes             跳过交互确认，分析后直接开始自动执行",
    "  --dry-run             只分析并输出确认单，不真正开始自动执行",
    "  --task-id <id>        指定任务 id",
    "  --max-tasks <n>       run-loop 最多执行 n 个任务",
    "  --max-attempts <n>    每种策略内最多重试 n 次",
    "  --max-strategies <n>  单任务最多切换 n 种策略继续重试",
    "  --allow-high-risk     允许执行 medium/high/critical 风险任务",
    "  --required-doc <p>    增加一个全局必读文档（AGENTS.md 会被自动忽略）",
    "  --constraint <text>   增加一个全局实现约束",
  ].join("\n");
}

function printHelp() {
  console.log(helpText());
}

function renderFollowupExamples() {
  return [
    "下一步示例：",
    `npx helloloop`,
    `npx helloloop <PATH>`,
    `npx helloloop --dry-run`,
    `npx helloloop install --host all`,
    `npx helloloop next`,
    `如需显式补充路径：npx helloloop --repo ${REPO_ROOT_PLACEHOLDER} --docs ${DOCS_PATH_PLACEHOLDER}`,
  ].join("\n");
}

function renderInstallSummary(result) {
  const lines = [
    "HelloLoop 已安装到以下宿主：",
  ];

  for (const item of result.installedHosts) {
    lines.push(`- ${item.displayName}：${item.targetRoot}`);
    if (item.marketplaceFile) {
      lines.push(`  marketplace：${item.marketplaceFile}`);
    }
    if (item.settingsFile) {
      lines.push(`  settings：${item.settingsFile}`);
    }
  }

  lines.push("");
  lines.push("使用入口：");
  lines.push("- Codex：`$helloloop` / `npx helloloop`");
  lines.push("- Claude：`/helloloop`");
  lines.push("- Gemini：`/helloloop`");
  lines.push("");
  lines.push(renderFollowupExamples());
  return lines.join("\n");
}

function resolveContextFromOptions(options) {
  const resolvedRepo = resolveRepoRoot({
    cwd: process.cwd(),
    repoRoot: options.repoRoot,
    inputPath: options.inputPath,
  });

  if (!resolvedRepo.ok) {
    throw new Error(resolvedRepo.message);
  }

  return createContext({
    repoRoot: resolvedRepo.repoRoot,
    configDirName: options.configDirName,
  });
}

export async function runCli(argv) {
  const { command, options } = parseArgs(argv);

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "install") {
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
    });
    console.log(renderInstallSummary(result));
    return;
  }

  if (command === "analyze") {
    const result = await analyzeWorkspace({
      cwd: process.cwd(),
      inputPath: options.inputPath,
      repoRoot: options.repoRoot,
      docsPath: options.docsPath,
      configDirName: options.configDirName,
    });

    if (!result.ok) {
      console.error(result.summary);
      process.exitCode = 1;
      return;
    }

    const confirmationText = renderAnalyzeConfirmation(result.context, result.analysis, result.backlog, options);
    const execution = analyzeExecution(result.backlog, options);

    console.log(confirmationText);
    console.log("");

    if (options.dryRun) {
      console.log("已按 --dry-run 跳过自动执行。");
      return;
    }

    if (execution.state !== "ready") {
      console.log(renderAnalyzeStopMessage(execution.blockedReason || "当前 backlog 已无可自动执行任务。"));
      return;
    }

    const approved = options.yes ? true : await confirmAutoExecution();
    if (!approved) {
      console.log("已取消自动执行；分析结果与 backlog 已保留在 .helloloop/。");
      return;
    }

    console.log("");
    console.log("开始自动接续执行...");
    const results = await runLoop(result.context, {
      ...options,
      maxTasks: resolveAutoRunMaxTasks(result.backlog, options),
    });
    const refreshedBacklog = loadBacklog(result.context);
    console.log(renderAutoRunSummary(result.context, refreshedBacklog, results, options));
    if (results.some((item) => !item.ok)) {
      process.exitCode = 1;
    }
    return;
  }

  const context = resolveContextFromOptions(options);

  if (command === "init") {
    const created = scaffoldIfMissing(context);
    if (!created.length) {
      console.log("HelloLoop 配置已存在，无需初始化。");
      return;
    }
    console.log([
      "已初始化以下文件：",
      ...created.map((item) => `- ${path.relative(context.repoRoot, item).replaceAll("\\", "/")}`),
    ].join("\n"));
    return;
  }

  if (command === "doctor") {
    await runDoctor(context, options);
    return;
  }

  if (command === "status") {
    console.log(renderStatusText(context, options));
    return;
  }

  if (command === "next") {
    const result = await runOnce(context, { ...options, dryRun: true });
    if (!result.task) {
      console.log("当前没有可执行任务。");
      return;
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
    return;
  }

  if (command === "run-once") {
    const result = await runOnce(context, options);
    if (!result.ok) {
      console.error(result.summary || "执行失败。");
      process.exitCode = 1;
      return;
    }
    if (options.dryRun) {
      console.log(result.task
        ? `已生成干跑预览：${result.task.title}\n运行目录：${result.runDir}`
        : "当前没有可执行任务。");
      return;
    }
    console.log(result.task
      ? `完成任务：${result.task.title}\n运行目录：${result.runDir}`
      : "没有可执行任务。");
    return;
  }

  if (command === "run-loop") {
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
      process.exitCode = 1;
    }
    return;
  }

  throw new Error(`未知命令：${command}`);
}


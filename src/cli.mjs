import path from "node:path";

import { analyzeExecution } from "./backlog.mjs";
import { renderAnalyzeConfirmation, resolveAutoRunMaxTasks } from "./analyze_confirmation.mjs";
import {
  confirmAutoExecution,
  confirmRepoConflictResolution,
  renderAnalyzeStopMessage,
  renderAutoRunSummary,
  renderRepoConflictStopMessage,
  runDoctor,
  shouldConfirmRepoRebuild,
} from "./cli_support.mjs";
import { createContext } from "./context.mjs";
import { analyzeWorkspace } from "./analyzer.mjs";
import {
  hasBlockingInputIssues,
  normalizeAnalyzeOptions,
  renderBlockingInputIssueMessage,
} from "./analyze_user_input.mjs";
import { loadBacklog, scaffoldIfMissing } from "./config.mjs";
import { resolveRepoRoot } from "./discovery.mjs";
import { createDiscoveryPromptSession, resolveDiscoveryFailureInteractively } from "./discovery_prompt.mjs";
import { installPluginBundle, uninstallPluginBundle } from "./install.mjs";
import { resetRepoForRebuild } from "./rebuild.mjs";
import { runLoop, runOnce, renderStatusText } from "./runner.mjs";

const REPO_ROOT_PLACEHOLDER = "<REPO_ROOT>";
const DOCS_PATH_PLACEHOLDER = "<DOCS_PATH>";
const KNOWN_COMMANDS = new Set([
  "analyze",
  "install",
  "uninstall",
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
    positionalArgs: [],
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--allow-high-risk") options.allowHighRisk = true;
    else if (arg === "--rebuild-existing") options.rebuildExisting = true;
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
    else { options.positionalArgs.push(arg); }
  }

  return { command, options };
}

function helpText() {
  return [
    "用法：helloloop [command] [path|需求说明...] [options]",
    "",
    "命令：",
    "  analyze               自动分析并生成执行确认单；确认后继续自动接续开发（默认）",
    "  install               安装插件到 Codex Home（适合 npx / npm bin 分发）",
    "  uninstall             从所选宿主卸载插件并清理注册信息",
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
    "  --rebuild-existing    分析判断当前项目与文档冲突时，自动清理当前项目后按文档重建",
    "  --required-doc <p>    增加一个全局必读文档（AGENTS.md 会被自动忽略）",
    "  --constraint <text>   增加一个全局实现约束",
    "",
    "补充说明：",
    "  analyze 默认支持在命令后混合传入路径和自然语言要求。",
    "  示例：npx helloloop <DOCS_PATH> <PROJECT_ROOT> 先分析偏差，不要执行",
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
    `npx helloloop uninstall --host all`,
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

function renderUninstallSummary(result) {
  const lines = [
    "HelloLoop 已从以下宿主卸载：",
  ];

  for (const item of result.uninstalledHosts) {
    lines.push(`- ${item.displayName}：${item.removed ? "已清理" : "未发现现有安装"}`);
    lines.push(`  目标目录：${item.targetRoot}`);
    if (item.marketplaceFile) {
      lines.push(`  marketplace：${item.marketplaceFile}`);
    }
    if (item.settingsFile) {
      lines.push(`  settings：${item.settingsFile}`);
    }
  }

  lines.push("");
  lines.push("如需重新安装：");
  lines.push("- `npx helloloop install --host codex`");
  lines.push("- `npx helloloop install --host all`");
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

async function analyzeWithResolvedDiscovery(options) {
  let currentOptions = { ...options };
  let lastResult = null;
  let promptSession = null;

  function getPromptSession() {
    if (currentOptions.yes) {
      return null;
    }
    if (!promptSession) {
      promptSession = createDiscoveryPromptSession();
    }
    return promptSession;
  }

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      lastResult = await analyzeWorkspace({
        cwd: process.cwd(),
        inputPath: currentOptions.inputPath,
        repoRoot: currentOptions.repoRoot,
        docsPath: currentOptions.docsPath,
        configDirName: currentOptions.configDirName,
        allowNewRepoRoot: currentOptions.allowNewRepoRoot,
        selectionSources: currentOptions.selectionSources,
        userIntent: currentOptions.userIntent,
      });

      if (lastResult.ok) {
        return {
          options: currentOptions,
          result: lastResult,
        };
      }

      const nextOptions = await resolveDiscoveryFailureInteractively(
        lastResult,
        currentOptions,
        process.cwd(),
        !currentOptions.yes,
        getPromptSession(),
      );
      if (!nextOptions) {
        break;
      }
      currentOptions = nextOptions;
    }
  } finally {
    promptSession?.close();
  }

  return {
    options: currentOptions,
    result: lastResult,
  };
}

function renderRebuildSummary(resetSummary) {
  return [
    "已按确认结果清理当前项目，并准备按开发文档重新开始。",
    `- 已清理顶层条目：${resetSummary.removedEntries.length ? resetSummary.removedEntries.join("，") : "无"}`,
    `- 已保留开发文档：${resetSummary.preservedDocs.length ? resetSummary.preservedDocs.join("，") : "无"}`,
    `- 重建记录：${resetSummary.manifestFile.replaceAll("\\", "/")}`,
  ].join("\n");
}

export async function runCli(argv) {
  const parsed = parseArgs(argv);
  const command = parsed.command;
  const options = command === "analyze"
    ? normalizeAnalyzeOptions(parsed.options, process.cwd())
    : (() => {
      const nextOptions = { ...parsed.options };
      const positionals = Array.isArray(nextOptions.positionalArgs) ? nextOptions.positionalArgs : [];
      if (positionals.length > 1) {
        throw new Error(`未知参数：${positionals.slice(1).join(" ")}`);
      }
      if (positionals.length === 1 && !nextOptions.inputPath) {
        nextOptions.inputPath = positionals[0];
      }
      return nextOptions;
    })();

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

  if (command === "uninstall") {
    const result = uninstallPluginBundle({
      host: options.host,
      codexHome: options.codexHome,
      claudeHome: options.claudeHome,
      geminiHome: options.geminiHome,
    });
    console.log(renderUninstallSummary(result));
    return;
  }

  if (command === "analyze") {
    if (hasBlockingInputIssues(options.inputIssues)) {
      console.error(renderBlockingInputIssueMessage(options.inputIssues));
      process.exitCode = 1;
      return;
    }

    let analyzed = await analyzeWithResolvedDiscovery(options);
    let result = analyzed.result;
    let activeOptions = analyzed.options;

    while (true) {
      if (!result.ok) {
        console.error(result.summary);
        process.exitCode = 1;
        return;
      }

      const confirmationText = renderAnalyzeConfirmation(
        result.context,
        result.analysis,
        result.backlog,
        activeOptions,
        result.discovery,
      );
      console.log(confirmationText);
      console.log("");

      if (!shouldConfirmRepoRebuild(result.analysis, result.discovery)) {
        break;
      }

      if (activeOptions.rebuildExisting) {
        const resetSummary = resetRepoForRebuild(result.context, result.discovery);
        console.log(renderRebuildSummary(resetSummary));
        console.log("");
        analyzed = await analyzeWithResolvedDiscovery({
          ...activeOptions,
          repoRoot: result.context.repoRoot,
          rebuildExisting: false,
        });
        result = analyzed.result;
        activeOptions = analyzed.options;
        continue;
      }

      if (activeOptions.yes) {
        console.log(renderRepoConflictStopMessage(result.analysis));
        process.exitCode = 1;
        return;
      }

      const repoConflictDecision = await confirmRepoConflictResolution(result.analysis);
      if (repoConflictDecision === "cancel") {
        console.log("已取消自动执行；分析结果与 backlog 已保留在 .helloloop/。");
        return;
      }

      if (repoConflictDecision === "continue") {
        break;
      }

      const resetSummary = resetRepoForRebuild(result.context, result.discovery);
      console.log(renderRebuildSummary(resetSummary));
      console.log("");
      analyzed = await analyzeWithResolvedDiscovery({
        ...activeOptions,
        repoRoot: result.context.repoRoot,
        rebuildExisting: false,
      });
      result = analyzed.result;
      activeOptions = analyzed.options;
    }

    const execution = analyzeExecution(result.backlog, activeOptions);

    if (activeOptions.dryRun) {
      console.log("已按 --dry-run 跳过自动执行。");
      return;
    }

    if (execution.state !== "ready") {
      console.log(renderAnalyzeStopMessage(execution.blockedReason || "当前 backlog 已无可自动执行任务。"));
      return;
    }

    const approved = activeOptions.yes ? true : await confirmAutoExecution();
    if (!approved) {
      console.log("已取消自动执行；分析结果与 backlog 已保留在 .helloloop/。");
      return;
    }

    console.log("");
    console.log("开始自动接续执行...");
    const results = await runLoop(result.context, {
      ...activeOptions,
      maxTasks: resolveAutoRunMaxTasks(result.backlog, activeOptions),
    });
    const refreshedBacklog = loadBacklog(result.context);
    console.log(renderAutoRunSummary(result.context, refreshedBacklog, results, activeOptions));
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


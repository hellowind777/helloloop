import { spawnSync } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline/promises";

import { analyzeExecution, summarizeBacklog } from "./backlog.mjs";
import { fileExists, readJson } from "./common.mjs";
import { resolveCliInvocation, resolveCodexInvocation } from "./shell_invocation.mjs";

function probeCodexVersion() {
  const invocation = resolveCodexInvocation();
  if (invocation.error) {
    return {
      ok: false,
      detail: invocation.error,
    };
  }

  const codexVersion = spawnSync(invocation.command, [...invocation.argsPrefix, "--version"], {
    encoding: "utf8",
    shell: invocation.shell,
  });
  const ok = codexVersion.status === 0;
  return {
    ok,
    detail: ok
      ? String(codexVersion.stdout || "").trim()
      : String(codexVersion.stderr || codexVersion.error || "无法执行 codex --version").trim(),
  };
}

function shouldCheckProjectRuntime(context, options = {}) {
  if (options.repoRoot || options.inputPath) {
    return true;
  }

  if (context.repoRoot !== context.toolRoot) {
    return true;
  }

  return [
    context.backlogFile,
    context.policyFile,
    context.projectFile,
  ].some((filePath) => fileExists(filePath));
}

export function collectDoctorChecks(context, options = {}) {
  const codexVersion = probeCodexVersion();
  const checks = [
    {
      name: "codex CLI",
      ok: codexVersion.ok,
      detail: codexVersion.detail,
    },
    {
      name: "plugin manifest",
      ok: fileExists(context.pluginManifestFile),
      detail: context.pluginManifestFile,
    },
    {
      name: "plugin skill",
      ok: fileExists(context.skillFile),
      detail: context.skillFile,
    },
    {
      name: "install script",
      ok: fileExists(context.installScriptFile),
      detail: context.installScriptFile,
    },
  ];

  if (shouldCheckProjectRuntime(context, options)) {
    checks.splice(1, 0,
      {
        name: "backlog.json",
        ok: fileExists(context.backlogFile),
        detail: context.backlogFile,
      },
      {
        name: "policy.json",
        ok: fileExists(context.policyFile),
        detail: context.policyFile,
      },
      {
        name: "verify.yaml",
        ok: fileExists(context.repoVerifyFile),
        detail: context.repoVerifyFile,
      },
      {
        name: "project.json",
        ok: fileExists(context.projectFile),
        detail: context.projectFile,
      },
    );
  }

  return checks;
}

function probeNamedCliVersion(commandName, toolDisplayName) {
  const invocation = resolveCliInvocation({
    commandName,
    toolDisplayName,
  });
  if (invocation.error) {
    return {
      ok: false,
      detail: invocation.error,
    };
  }

  const result = spawnSync(invocation.command, [...invocation.argsPrefix, "--version"], {
    encoding: "utf8",
    shell: invocation.shell,
  });
  const ok = result.status === 0;
  return {
    ok,
    detail: ok
      ? String(result.stdout || "").trim()
      : String(result.stderr || result.error || `无法执行 ${commandName} --version`).trim(),
  };
}

function normalizeDoctorHosts(hostOption) {
  const normalized = String(hostOption || "codex").trim().toLowerCase();
  if (normalized === "all") {
    return ["codex", "claude", "gemini"];
  }
  return [normalized];
}

function collectCodexDoctorChecks(context, options = {}) {
  const checks = collectDoctorChecks(context, options);
  if (options.codexHome) {
    checks.push({
      name: "codex installed plugin",
      ok: fileExists(path.join(options.codexHome, "plugins", "helloloop", ".codex-plugin", "plugin.json")),
      detail: path.join(options.codexHome, "plugins", "helloloop", ".codex-plugin", "plugin.json"),
    });
    checks.push({
      name: "codex marketplace",
      ok: fileExists(path.join(options.codexHome, ".agents", "plugins", "marketplace.json")),
      detail: path.join(options.codexHome, ".agents", "plugins", "marketplace.json"),
    });
  }
  return checks;
}

function collectClaudeDoctorChecks(context, options = {}) {
  const claudeVersion = probeNamedCliVersion("claude", "Claude");
  const checks = [
    {
      name: "claude CLI",
      ok: claudeVersion.ok,
      detail: claudeVersion.detail,
    },
    {
      name: "claude plugin manifest",
      ok: fileExists(path.join(context.bundleRoot, ".claude-plugin", "plugin.json")),
      detail: path.join(context.bundleRoot, ".claude-plugin", "plugin.json"),
    },
    {
      name: "claude marketplace manifest",
      ok: fileExists(path.join(context.bundleRoot, "hosts", "claude", "marketplace", ".claude-plugin", "marketplace.json")),
      detail: path.join(context.bundleRoot, "hosts", "claude", "marketplace", ".claude-plugin", "marketplace.json"),
    },
    {
      name: "claude command",
      ok: fileExists(path.join(context.bundleRoot, "hosts", "claude", "marketplace", "plugins", "helloloop", "commands", "helloloop.md")),
      detail: path.join(context.bundleRoot, "hosts", "claude", "marketplace", "plugins", "helloloop", "commands", "helloloop.md"),
    },
  ];

  if (options.claudeHome) {
    const settingsFile = path.join(options.claudeHome, "settings.json");
    const knownMarketplacesFile = path.join(options.claudeHome, "plugins", "known_marketplaces.json");
    const installedPluginsFile = path.join(options.claudeHome, "plugins", "installed_plugins.json");
    const settings = fileExists(settingsFile) ? readJson(settingsFile) : {};
    const installedPlugins = fileExists(installedPluginsFile) ? readJson(installedPluginsFile) : {};
    const installs = Array.isArray(installedPlugins?.plugins?.["helloloop@helloloop-local"])
      ? installedPlugins.plugins["helloloop@helloloop-local"]
      : [];
    const installedPluginRoot = installs[0]?.installPath
      ? String(installs[0].installPath)
      : path.join(options.claudeHome, "plugins", "cache", "helloloop-local", "helloloop");

    checks.push({
      name: "claude installed marketplace",
      ok: fileExists(path.join(options.claudeHome, "plugins", "marketplaces", "helloloop-local", ".claude-plugin", "marketplace.json")),
      detail: path.join(options.claudeHome, "plugins", "marketplaces", "helloloop-local", ".claude-plugin", "marketplace.json"),
    });
    checks.push({
      name: "claude marketplace registry",
      ok: fileExists(knownMarketplacesFile),
      detail: knownMarketplacesFile,
    });
    checks.push({
      name: "claude installed plugin index",
      ok: fileExists(installedPluginsFile),
      detail: installedPluginsFile,
    });
    checks.push({
      name: "claude installed plugin",
      ok: fileExists(path.join(installedPluginRoot, ".claude-plugin", "plugin.json")),
      detail: path.join(installedPluginRoot, ".claude-plugin", "plugin.json"),
    });
    checks.push({
      name: "claude settings enabled",
      ok: settings?.enabledPlugins?.["helloloop@helloloop-local"] === true,
      detail: settingsFile,
    });
  }

  return checks;
}

function collectGeminiDoctorChecks(context, options = {}) {
  const geminiVersion = probeNamedCliVersion("gemini", "Gemini");
  const checks = [
    {
      name: "gemini CLI",
      ok: geminiVersion.ok,
      detail: geminiVersion.detail,
    },
    {
      name: "gemini extension manifest",
      ok: fileExists(path.join(context.bundleRoot, "hosts", "gemini", "extension", "gemini-extension.json")),
      detail: path.join(context.bundleRoot, "hosts", "gemini", "extension", "gemini-extension.json"),
    },
    {
      name: "gemini command",
      ok: fileExists(path.join(context.bundleRoot, "hosts", "gemini", "extension", "commands", "helloloop.toml")),
      detail: path.join(context.bundleRoot, "hosts", "gemini", "extension", "commands", "helloloop.toml"),
    },
    {
      name: "gemini context file",
      ok: fileExists(path.join(context.bundleRoot, "hosts", "gemini", "extension", "GEMINI.md")),
      detail: path.join(context.bundleRoot, "hosts", "gemini", "extension", "GEMINI.md"),
    },
  ];

  if (options.geminiHome) {
    checks.push({
      name: "gemini installed extension",
      ok: fileExists(path.join(options.geminiHome, "extensions", "helloloop", "gemini-extension.json")),
      detail: path.join(options.geminiHome, "extensions", "helloloop", "gemini-extension.json"),
    });
  }

  return checks;
}

export async function runDoctor(context, options = {}) {
  const hosts = normalizeDoctorHosts(options.host);
  const checks = hosts.flatMap((host) => {
    if (host === "codex") return collectCodexDoctorChecks(context, options);
    if (host === "claude") return collectClaudeDoctorChecks(context, options);
    if (host === "gemini") return collectGeminiDoctorChecks(context, options);
    return [];
  });

  for (const item of checks) {
    console.log(`${item.ok ? "OK" : "FAIL"}  ${item.name}  ${item.detail}`);
  }

  if (checks.every((item) => item.ok)) {
    console.log("\nDoctor 结论：当前 HelloLoop 所选宿主与目标仓库已具备基本运行条件。");
  }

  if (checks.some((item) => !item.ok)) {
    process.exitCode = 1;
  }
}

function isAffirmativeAnswer(answer) {
  const raw = String(answer || "").trim();
  const normalized = raw.toLowerCase();
  return [
    "y",
    "yes",
    "ok",
    "确认",
    "是",
    "继续",
    "好的",
  ].includes(normalized) || ["确认", "是", "继续", "好的"].includes(raw);
}

export async function confirmAutoExecution() {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await readline.question("是否开始自动接续执行？输入 y / yes / 确认 继续，其它任意输入取消：");
    return isAffirmativeAnswer(answer);
  } finally {
    readline.close();
  }
}

export function shouldConfirmRepoRebuild(analysis, discovery) {
  return analysis?.repoDecision?.action === "confirm_rebuild"
    && discovery?.resolution?.repo?.exists !== false;
}

export async function confirmRepoConflictResolution(analysis) {
  const decision = analysis?.repoDecision || {};
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const promptText = [
    "检测到当前项目与开发文档目标存在明显冲突：",
    `- ${decision.reason || "分析结果认为当前项目更适合先确认处理方式。"}`,
    "请选择后续动作：",
    "1. 继续在当前项目上尝试接续",
    "2. 清理当前项目内容后按文档目标重新开始（推荐）",
    "3. 取消本次执行",
    "请输入 1 / 2 / 3：",
  ].join("\n");

  try {
    const answer = String(await readline.question(promptText) || "").trim();
    if (["2", "重建", "rebuild"].includes(answer.toLowerCase ? answer.toLowerCase() : answer)) {
      return "rebuild";
    }
    if (["1", "继续", "continue"].includes(answer.toLowerCase ? answer.toLowerCase() : answer)) {
      return "continue";
    }
    return "cancel";
  } finally {
    readline.close();
  }
}

export function renderRepoConflictStopMessage(analysis) {
  return [
    "当前项目与开发文档目标存在明显冲突，已暂停自动执行。",
    analysis?.repoDecision?.reason ? `原因：${analysis.repoDecision.reason}` : "",
    "请重新运行交互式 `npx helloloop` 进行选择，或显式追加 `--rebuild-existing` 后再执行。",
  ].filter(Boolean).join("\n");
}

export function renderAnalyzeStopMessage(reason) {
  return reason || "当前没有可自动执行的任务。";
}

export function renderAutoRunSummary(context, backlog, results, options = {}) {
  const summary = summarizeBacklog(backlog);
  const execution = analyzeExecution(backlog, options);
  const mainlineClosed = results.some((item) => item.kind === "mainline-complete");
  const lines = [
    "自动执行结果",
    "============",
  ];

  if (!results.length) {
    lines.push("- 本轮未执行任何任务");
  } else {
    for (const item of results) {
      if (!item.task) {
        lines.push(`- 已停止：${item.summary || item.kind || "没有更多任务"}`);
        continue;
      }
      lines.push(`- ${item.ok ? "完成任务" : "失败任务"}：${item.task.title}`);
      if (!item.ok && item.summary) {
        lines.push(item.summary);
      }
    }
  }

  lines.push("");
  lines.push("当前统计：");
  lines.push(`- 已完成：${summary.done}`);
  lines.push(`- 待处理：${summary.pending}`);
  lines.push(`- 进行中：${summary.inProgress}`);
  lines.push(`- 阻塞：${summary.blocked}`);
  lines.push(`- 失败：${summary.failed}`);
  lines.push(`- 状态文件：${context.statusFile.replaceAll("\\", "/")}`);
  lines.push("");
  lines.push("结论：");
  if (execution.state === "done") {
    lines.push(mainlineClosed
      ? "- backlog 已全部完成，且主线终态复核通过"
      : "- backlog 已全部完成");
  } else if (execution.blockedReason) {
    lines.push(`- 当前停止原因：${execution.blockedReason}`);
  } else {
    lines.push("- 当前轮次已结束，可继续查看 status 或下一任务");
  }

  return lines.join("\n");
}

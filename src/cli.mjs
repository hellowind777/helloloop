import path from "node:path";
import { spawnSync } from "node:child_process";

import { createContext } from "./context.mjs";
import { fileExists } from "./common.mjs";
import { scaffoldIfMissing } from "./config.mjs";
import { installPluginBundle } from "./install.mjs";
import { runLoop, runOnce, renderStatusText } from "./runner.mjs";

function parseArgs(argv) {
  const [command = "status", ...rest] = argv;
  const options = {
    requiredDocs: [],
    constraints: [],
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--allow-high-risk") options.allowHighRisk = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--task-id") { options.taskId = rest[index + 1]; index += 1; }
    else if (arg === "--max-tasks") { options.maxTasks = Number(rest[index + 1]); index += 1; }
    else if (arg === "--max-attempts") { options.maxAttempts = Number(rest[index + 1]); index += 1; }
    else if (arg === "--max-strategies") { options.maxStrategies = Number(rest[index + 1]); index += 1; }
    else if (arg === "--repo") { options.repoRoot = rest[index + 1]; index += 1; }
    else if (arg === "--codex-home") { options.codexHome = rest[index + 1]; index += 1; }
    else if (arg === "--config-dir") { options.configDirName = rest[index + 1]; index += 1; }
    else if (arg === "--required-doc") { options.requiredDocs.push(rest[index + 1]); index += 1; }
    else if (arg === "--constraint") { options.constraints.push(rest[index + 1]); index += 1; }
    else {
      throw new Error(`未知参数：${arg}`);
    }
  }

  return { command, options };
}

function helpText() {
  return [
    "用法：helloloop <command> [options]",
    "",
    "命令：",
    "  install               安装插件到 Codex Home（适合 npx / npm bin 分发）",
    "  init                  初始化 .helloagents/helloloop 配置",
    "  status                查看 backlog 与下一任务",
    "  next                  生成下一任务干跑预览",
    "  run-once              执行一个任务",
    "  run-loop              连续执行多个任务",
    "  doctor                检查 Codex、当前插件 bundle 与目标仓库 .helloagents/helloloop 配置是否可用",
    "",
    "选项：",
    "  --codex-home <dir>    Codex Home，install 默认使用 ~/.codex",
    "  --repo <dir>          目标仓库根目录，默认当前目录",
    "  --config-dir <dir>    配置目录，默认 .helloagents/helloloop",
    "  --dry-run             只生成提示与预览，不真正调用 codex",
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

function probeCodexVersion() {
  const codexVersion = process.platform === "win32"
    ? spawnSync("codex --version", {
        encoding: "utf8",
        shell: true,
      })
    : spawnSync("codex", ["--version"], {
        encoding: "utf8",
        shell: false,
      });
  const ok = codexVersion.status === 0;
  return {
    ok,
    detail: ok
      ? String(codexVersion.stdout || "").trim()
      : String(codexVersion.stderr || codexVersion.error || "无法执行 codex --version").trim(),
  };
}

function collectDoctorChecks(context) {
  const codexVersion = probeCodexVersion();
  return [
    {
      name: "codex CLI",
      ok: codexVersion.ok,
      detail: codexVersion.detail,
    },
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
}

async function runDoctor(context) {
  const checks = collectDoctorChecks(context);

  for (const item of checks) {
    console.log(`${item.ok ? "OK" : "FAIL"}  ${item.name}  ${item.detail}`);
  }

  if (checks.every((item) => item.ok)) {
    console.log("\nDoctor 结论：当前 HelloLoop bundle 与目标仓库已具备基本运行条件。");
  }

  if (checks.some((item) => !item.ok)) {
    process.exitCode = 1;
  }
}

export async function runCli(argv) {
  const { command, options } = parseArgs(argv);

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const context = createContext({
    repoRoot: options.repoRoot,
    configDirName: options.configDirName,
  });

  if (command === "install") {
    const result = installPluginBundle({
      bundleRoot: context.bundleRoot,
      codexHome: options.codexHome,
      force: options.force,
    });
    console.log(`HelloLoop 已安装到：${result.targetPluginRoot}`);
    console.log(`Marketplace 已更新：${result.marketplaceFile}`);
    console.log("");
    console.log("下一步示例：");
    console.log(`node ${path.join(result.targetPluginRoot, "scripts", "helloloop.mjs")} doctor --repo D:\\GitHub\\dev\\your-repo`);
    return;
  }

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
    await runDoctor(context);
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


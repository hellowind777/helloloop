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

export function parseArgs(argv) {
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
    else if (arg === "--engine") { options.engine = rest[index + 1]; options.engineSource = "flag"; index += 1; }
    else if (arg === "--host-context") { options.hostContext = rest[index + 1]; index += 1; }
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
    "用法：helloloop [command] [engine] [path|需求说明...] [options]",
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
    "  [engine]             analyze 默认支持直接写：codex | claude | gemini",
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
    "  analyze 默认支持在命令后混合传入引擎、路径和自然语言要求。",
    "  如果同时检测到多个可用引擎且没有明确指定，会先询问你选择。",
    "  示例：npx helloloop claude <DOCS_PATH> <PROJECT_ROOT> 先分析偏差，不要执行",
  ].join("\n");
}

export function printHelp() {
  console.log(helpText());
}

export { DOCS_PATH_PLACEHOLDER, REPO_ROOT_PLACEHOLDER };

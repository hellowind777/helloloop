const REPO_ROOT_PLACEHOLDER = "<REPO_ROOT>";
const DOCS_PATH_PLACEHOLDER = "<DOCS_PATH>";
const KNOWN_ENGINES = new Set([
  "codex",
  "claude",
  "gemini",
]);
const COMMAND_ALIASES = Object.freeze({
  "__supervise": "__supervise",
  "__supervise-worker": "__supervise-worker",
  "__web-server": "__web-server",
  analyze: "analyze",
  a: "analyze",
  dashboard: "dashboard",
  dash: "dashboard",
  db: "dashboard",
  tui: "tui",
  web: "web",
  install: "install",
  i: "install",
  uninstall: "uninstall",
  un: "uninstall",
  init: "init",
  pause: "pause-mainline",
  "pause-mainline": "pause-mainline",
  pm: "pause-mainline",
  resume: "resume-host",
  rh: "resume-host",
  "resume-host": "resume-host",
  status: "status",
  st: "status",
  watch: "watch",
  w: "watch",
  next: "next",
  n: "next",
  "run-once": "run-once",
  once: "run-once",
  "run-loop": "run-loop",
  loop: "run-loop",
  doctor: "doctor",
  dr: "doctor",
  help: "help",
  "--help": "help",
  "-h": "help",
});
const KNOWN_COMMANDS = new Set(Object.keys(COMMAND_ALIASES));

function normalizeCommand(value = "") {
  return COMMAND_ALIASES[String(value || "").trim()] || "";
}

export function parseArgs(argv) {
  const [first = "", ...restArgs] = argv;
  const normalizedFirstCommand = normalizeCommand(first);
  const command = !first
    ? "analyze"
    : (normalizedFirstCommand || "analyze");
  const rest = !first
    ? []
    : (normalizedFirstCommand ? restArgs : argv);
  const options = {
    requiredDocs: [],
    constraints: [],
    positionalArgs: [],
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--allow-high-risk" || arg === "-r") options.allowHighRisk = true;
    else if (arg === "--rebuild-existing") options.rebuildExisting = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--task-id" || arg === "-t") { options.taskId = rest[index + 1]; index += 1; }
    else if (arg === "--max-tasks" || arg === "-m") { options.maxTasks = Number(rest[index + 1]); index += 1; }
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
    else if (arg === "--session-file") { options.sessionFile = rest[index + 1]; index += 1; }
    else if (arg === "--launch-id") { options.launchId = rest[index + 1]; index += 1; }
    else if (arg === "--watch" || arg === "-w") options.watch = true;
    else if (arg === "--detach" || arg === "-d") options.detach = true;
    else if (arg === "--foreground") options.foreground = true;
    else if (arg === "--stop") options.stop = true;
    else if (arg === "--json" || arg === "-j") options.json = true;
    else if (arg === "--compact" || arg === "-c") options.compact = true;
    else if (arg === "--events" || arg === "-e") options.events = true;
    else if (arg === "--session-id") { options.sessionId = rest[index + 1]; index += 1; }
    else if (arg === "--watch-poll-ms") { options.watchPollMs = Number(rest[index + 1]); index += 1; }
    else if (arg === "--poll-ms" || arg === "-p") { options.pollMs = Number(rest[index + 1]); index += 1; }
    else if (arg === "--port") { options.port = Number(rest[index + 1]); index += 1; }
    else if (arg === "--bind") { options.bind = rest[index + 1]; index += 1; }
    else if (arg === "--required-doc") { options.requiredDocs.push(rest[index + 1]); index += 1; }
    else if (arg === "--constraint") { options.constraints.push(rest[index + 1]); index += 1; }
    else { options.positionalArgs.push(arg); }
  }

  const [leadingPositional = "", ...remainingPositionals] = options.positionalArgs;
  const normalizedLeadingEngine = String(leadingPositional || "").trim().toLowerCase();
  if (!options.engine && KNOWN_ENGINES.has(normalizedLeadingEngine)) {
    options.engine = normalizedLeadingEngine;
    options.engineSource = "leading_positional";
    options.positionalArgs = remainingPositionals;
  }

  return { command, options };
}

function helpText() {
  return [
    "用法：helloloop [command] [engine] [path|需求说明...] [options]",
    "",
    "命令：",
    "  analyze | a           自动分析并生成执行确认单；确认后继续自动接续开发（默认）",
    "  dashboard | dash | db 在当前终端启动动态 TUI 看板（默认总控台）",
    "  tui                   dashboard 的显式别名，适合从主终端直接打开实时任务看板",
    "  web                   启动本地 Web 看板；默认后台启动并输出访问地址",
    "  install | i           安装插件到 Codex Home（适合 npx / npm bin 分发）",
    "  uninstall | un        从所选宿主卸载插件并清理注册信息",
    "  init                  初始化 .helloloop 配置",
    "  pause-mainline | pause | pm",
    "                        暂停当前仓库主线并停止后台 supervisor，直到显式继续",
    "  resume-host | resume | rh",
    "                        输出当前仓库的宿主续跑自然语言提示，供主 CLI / 主代理中断后继续输入",
    "  status | st           查看 backlog 与下一任务",
    "  watch | w             附着到后台 supervisor，持续查看实时进度",
    "  next | n              生成下一任务干跑预览",
    "  run-once | once       执行一个任务",
    "  run-loop | loop       连续执行多个任务",
    "  doctor | dr           检查 Codex、当前插件 bundle 与目标仓库 .helloloop 配置是否可用",
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
    "  -t, --task-id <id>    指定任务 id",
    "  -m, --max-tasks <n>   run-loop 最多执行 n 个任务",
    "  --max-attempts <n>    每种策略内最多重试 n 次",
    "  --max-strategies <n>  单任务最多切换 n 种策略继续重试",
    "  -w, --watch           启动后台 supervisor 后，当前终端继续附着观察实时输出",
    "  -d, --detach          仅启动后台 supervisor 后立即返回，不进入观察模式",
    "  --foreground          web 命令以前台模式运行本地服务",
    "  --stop                web 命令停止当前本地看板服务",
    "  -j, --json            以 JSON / NDJSON 形式输出结构化状态",
    "  --session-id <id>     status/watch 指定附着的后台会话 ID",
    "  -r, --allow-high-risk 手动 run-once/run-loop 时允许执行 medium/high/critical 风险任务",
    "  -p, --poll-ms <n>     dashboard 轮询间隔（毫秒）",
    "  --port <n>            web 命令指定监听端口，默认优先尝试 3210",
    "  --bind <addr>         web 命令指定监听地址，默认 127.0.0.1",
    "  --rebuild-existing    分析判断当前项目与文档冲突时，自动清理当前项目后按文档重建",
    "  --required-doc <p>    增加一个全局必读文档（AGENTS.md 会被自动忽略）",
    "  --constraint <text>   增加一个全局实现约束",
    "",
    "补充说明：",
    "  analyze 默认支持在命令后混合传入引擎、路径和自然语言要求。",
    "  如果同时检测到多个可用引擎且没有明确指定，会先询问你选择。",
    "  当前版本默认会把自动执行 / run-once / run-loop 切到后台 supervisor。",
    "  `helloloop dashboard` / `helloloop tui` 会打开终端实时总控台，不再把文本 dashboard 作为默认交互形态。",
    "  `helloloop dashboard --json --watch` 仍可为宿主主代理提供结构化状态流。",
    "  `helloloop web` 会启动本地 Web 看板，适合长时间像 Jira 一样查看多仓任务板。",
    "  `helloloop resume-host --json` 会输出结构化续跑提示；不带 `--json` 时直接输出自然语言续跑内容。",
    "  Windows 下 `analyze -y --detach` 会直接切到隐藏后台引导，不再保留前台空白控制台等待分析完成。",
    "  Windows 下运行 Codex 时会优先绕过 codex.ps1，直接以隐藏原生 codex.exe 启动，并把内部 pwsh/powershell 调度重定向到隐藏代理，尽量避免额外 PowerShell 窗口闪烁。",
    "  `watch` / `status --watch` / `dashboard --json --watch` 会按全局设置自动重试附着或重连；后台守护进程也会按设置保活重拉起。",
    "  交互终端默认会自动附着观察；如只想立即返回，请显式加 --detach。",
    "  任何时候都可运行 `helloloop watch` / `helloloop w` 或 `helloloop status --watch` / `helloloop st -w` 重新附着观察。",
    "  示例：npx helloloop claude <DOCS_PATH> <PROJECT_ROOT> 先分析偏差，不要执行",
  ].join("\n");
}

export function printHelp() {
  console.log(helpText());
}

export { DOCS_PATH_PLACEHOLDER, REPO_ROOT_PLACEHOLDER };

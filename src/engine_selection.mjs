import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

import { fileExists, readJson, writeJson } from "./common.mjs";
import { loadProjectConfig, saveProjectConfig } from "./config.mjs";
import {
  getEngineDisplayName,
  getEngineMetadata,
  getHostDisplayName,
  listKnownEngines,
  normalizeEngineName,
  normalizeHostContext,
} from "./engine_metadata.mjs";
import { resolveCliInvocation } from "./shell_invocation.mjs";

const ENGINE_SOURCE_LABELS = {
  flag: "命令参数",
  leading_positional: "命令首参数",
  request_text: "自然语言要求",
  host_context: "当前宿主",
  project_default: "项目默认引擎",
  project_last: "项目上次引擎",
  user_default: "用户默认引擎",
  user_last: "用户上次引擎",
  only_available: "唯一可用引擎",
  interactive_choice: "交互选择",
  interactive_fallback: "故障后交互切换",
};

function createPromptSession() {
  if (process.stdin.isTTY) {
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return {
      async question(promptText) {
        return readline.question(promptText);
      },
      close() {
        readline.close();
      },
    };
  }

  const bufferedAnswers = fs.readFileSync(0, "utf8").split(/\r?\n/);
  let answerIndex = 0;
  return {
    async question(promptText) {
      process.stdout.write(promptText);
      const answer = bufferedAnswers[answerIndex] ?? "";
      answerIndex += 1;
      return answer;
    },
    close() {},
  };
}

function defaultUserSettings() {
  return {
    defaultEngine: "",
    lastSelectedEngine: "",
  };
}

export function resolveUserSettingsFile(userSettingsFile = "") {
  return userSettingsFile
    || String(process.env.HELLOLOOP_USER_SETTINGS_FILE || "").trim()
    || path.join(os.homedir(), ".helloloop", "settings.json");
}

export function loadUserSettings(options = {}) {
  const settingsFile = resolveUserSettingsFile(options.userSettingsFile);
  if (!fileExists(settingsFile)) {
    return defaultUserSettings();
  }

  const settings = readJson(settingsFile);
  return {
    defaultEngine: normalizeEngineName(settings?.defaultEngine),
    lastSelectedEngine: normalizeEngineName(settings?.lastSelectedEngine),
  };
}

export function saveUserSettings(settings, options = {}) {
  const settingsFile = resolveUserSettingsFile(options.userSettingsFile);
  writeJson(settingsFile, {
    defaultEngine: normalizeEngineName(settings?.defaultEngine),
    lastSelectedEngine: normalizeEngineName(settings?.lastSelectedEngine),
  });
}

function resolveExecutableOverride(policy = {}, engine) {
  const envExecutable = String(process.env[`HELLOLOOP_${String(engine || "").toUpperCase()}_EXECUTABLE`] || "").trim();
  if (envExecutable) {
    return envExecutable;
  }
  if (engine === "codex") {
    return String(policy?.codex?.executable || "").trim();
  }
  if (engine === "claude") {
    return String(policy?.claude?.executable || "").trim();
  }
  if (engine === "gemini") {
    return String(policy?.gemini?.executable || "").trim();
  }
  return "";
}

function probeEngineAvailability(engine, policy = {}) {
  const meta = getEngineMetadata(engine);
  const invocation = resolveCliInvocation({
    commandName: meta.commandName,
    toolDisplayName: meta.displayName,
    explicitExecutable: resolveExecutableOverride(policy, engine),
  });

  if (invocation.error) {
    return {
      engine,
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
    engine,
    ok,
    detail: ok
      ? String(result.stdout || "").trim()
      : String(result.stderr || result.error || `无法执行 ${meta.commandName} --version`).trim(),
  };
}

export function probeExecutionEngines(policy = {}) {
  return listKnownEngines().map((engine) => probeEngineAvailability(engine, policy));
}

function uniqueEngines(items = []) {
  const result = [];
  const seen = new Set();
  for (const item of items) {
    const normalized = normalizeEngineName(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function rankEngines(engines, hostContext = "terminal") {
  const preferredOrder = uniqueEngines([
    hostContext,
    "codex",
    "claude",
    "gemini",
  ]);
  return [...engines].sort((left, right) => {
    const leftIndex = preferredOrder.indexOf(left);
    const rightIndex = preferredOrder.indexOf(right);
    const normalizedLeft = leftIndex >= 0 ? leftIndex : Number.MAX_SAFE_INTEGER;
    const normalizedRight = rightIndex >= 0 ? rightIndex : Number.MAX_SAFE_INTEGER;
    if (normalizedLeft !== normalizedRight) {
      return normalizedLeft - normalizedRight;
    }
    return left.localeCompare(right, "en");
  });
}

function renderEngineList(engines = []) {
  return rankEngines(uniqueEngines(engines)).map((engine) => getEngineDisplayName(engine)).join("、");
}

function detectEngineIntentFromRequestText(requestText = "") {
  const normalized = String(requestText || "").toLowerCase();
  if (!normalized) {
    return null;
  }

  const matches = new Set();
  const pattern = /(^|[^a-z0-9])(codex|claude|gemini)(?=[^a-z0-9]|$)/g;
  let match = pattern.exec(normalized);
  while (match) {
    matches.add(match[2]);
    match = pattern.exec(normalized);
  }

  if (!matches.size) {
    return null;
  }

  const engines = [...matches];
  if (engines.length === 1) {
    return {
      engine: engines[0],
      source: "request_text",
      basis: [`补充要求里明确提到了 ${getEngineDisplayName(engines[0])}。`],
      ambiguous: false,
    };
  }

  return {
    engine: "",
    source: "request_text",
    basis: [`补充要求里同时提到了多个引擎：${renderEngineList(engines)}。`],
    ambiguous: true,
    engines,
  };
}

function engineSourceLabel(source) {
  return ENGINE_SOURCE_LABELS[source] || "自动判断";
}

function candidate(engine, source, basis = []) {
  return {
    engine: normalizeEngineName(engine),
    source,
    basis: Array.isArray(basis) ? basis.filter(Boolean) : [],
  };
}

function isUserDirectedSource(source) {
  return ["flag", "leading_positional", "request_text"].includes(source);
}

function describeProbeFailures(probes = []) {
  return probes
    .filter((item) => !item.ok)
    .map((item) => `- ${getEngineDisplayName(item.engine)}：${item.detail || "不可用"}`);
}

function buildEngineSelectionRequiredMessage(hostContext, availableEngines) {
  return [
    `检测到多个可用执行引擎：${renderEngineList(availableEngines)}。`,
    `当前宿主：${getHostDisplayName(hostContext)}。`,
    "请显式指定要使用的引擎，例如：",
    "- `npx helloloop codex`",
    "- `npx helloloop claude <PATH>`",
    "- `npx helloloop gemini <PATH> 继续开发`",
  ].join("\n");
}

function buildNoAvailableEngineMessage(hostContext, probes = []) {
  const failureLines = describeProbeFailures(probes);
  return [
    `当前宿主：${getHostDisplayName(hostContext)}。`,
    "未发现可安全执行的开发引擎（Codex / Claude / Gemini）。",
    ...(failureLines.length ? ["", "检查结果：", ...failureLines] : []),
    "",
    "请先安装并确认至少一个 CLI 可正常执行，然后重试。",
  ].join("\n");
}

function buildUnavailableRequestedEngineMessage(engine, availableEngines, probe) {
  const lines = [
    `你指定的执行引擎当前不可用：${getEngineDisplayName(engine)}。`,
  ];

  if (probe?.detail) {
    lines.push(`原因：${probe.detail}`);
  }
  if (availableEngines.length) {
    lines.push(`当前仍可用的引擎：${renderEngineList(availableEngines)}。`);
  }
  lines.push("请改用可用引擎，或先修复该 CLI 的安装 / 登录 / 配额问题。");
  return lines.join("\n");
}

function buildCrossHostSwitchMessage(hostContext, engine) {
  return [
    `当前从 ${getHostDisplayName(hostContext)} 宿主发起，但本次将改用 ${getEngineDisplayName(engine)} 执行。`,
    "这不会静默切换；请确认是否继续。",
  ].join("\n");
}

function parseAffirmative(answer) {
  const raw = String(answer || "").trim();
  const normalized = raw.toLowerCase();
  return ["y", "yes", "ok", "确认", "是", "继续", "好的"].includes(normalized)
    || ["确认", "是", "继续", "好的"].includes(raw);
}

async function confirmCrossHostSwitch(hostContext, engine) {
  const promptSession = createPromptSession();
  try {
    const answer = await promptSession.question(`${buildCrossHostSwitchMessage(hostContext, engine)}\n请输入 y / yes / 确认 继续，其它任意输入取消：`);
    return parseAffirmative(answer);
  } finally {
    promptSession.close();
  }
}

async function promptSelectEngine(availableEngines, options = {}) {
  const promptSession = createPromptSession();
  const ranked = rankEngines(availableEngines, options.hostContext);
  const recommendation = normalizeEngineName(options.recommendedEngine);
  const choiceLines = ranked.map((engine, index) => {
    const suffix = engine === recommendation ? "（推荐）" : "";
    return `${index + 1}. ${getEngineDisplayName(engine)}${suffix}`;
  });

  try {
    const answer = await promptSession.question([
      options.message || "请选择本次要使用的执行引擎：",
      ...choiceLines,
      "",
      "请输入编号；直接回车取消。",
      "> ",
    ].join("\n"));
    const choiceIndex = Number(String(answer || "").trim());
    if (!Number.isInteger(choiceIndex) || choiceIndex < 1 || choiceIndex > ranked.length) {
      return "";
    }
    return ranked[choiceIndex - 1];
  } finally {
    promptSession.close();
  }
}

export function resolveHostContext(options = {}) {
  const envCandidate = process.env.HELLOLOOP_HOST_CONTEXT || process.env.HELLOLOOP_HOST;
  return normalizeHostContext(options.hostContext || envCandidate || "terminal");
}

function buildResolution({
  engine,
  source,
  basis,
  hostContext,
  probes,
}) {
  const availableEngines = probes.filter((item) => item.ok).map((item) => item.engine);
  return {
    ok: true,
    engine,
    displayName: getEngineDisplayName(engine),
    hostContext,
    hostDisplayName: getHostDisplayName(hostContext),
    source,
    sourceLabel: engineSourceLabel(source),
    basis: Array.isArray(basis) ? basis.filter(Boolean) : [],
    probes,
    availableEngines,
  };
}

export async function resolveEngineSelection({
  context,
  policy = {},
  options = {},
  interactive = true,
} = {}) {
  const hostContext = resolveHostContext(options);
  const probes = probeExecutionEngines(policy);
  const availableEngines = probes.filter((item) => item.ok).map((item) => item.engine);
  const projectConfig = context ? loadProjectConfig(context) : {};
  const userSettings = loadUserSettings(options);
  const requestIntent = detectEngineIntentFromRequestText(
    options.userRequestText || options.userIntent?.requestText || "",
  );
  const candidates = [];
  const requestedEngine = normalizeEngineName(options.engine);
  const requestedEngineSource = options.engineSource || "flag";

  if (requestedEngine) {
    candidates.push(candidate(requestedEngine, requestedEngineSource, [
      requestedEngineSource === "leading_positional"
        ? `命令首参数显式指定了 ${getEngineDisplayName(requestedEngine)}。`
        : `命令参数显式指定了 ${getEngineDisplayName(requestedEngine)}。`,
    ]));
  } else if (requestIntent && !requestIntent.ambiguous) {
    candidates.push(candidate(requestIntent.engine, "request_text", requestIntent.basis));
  }

  if (hostContext !== "terminal") {
    candidates.push(candidate(hostContext, "host_context", [
      `当前在 ${getHostDisplayName(hostContext)} 宿主内触发 HelloLoop。`,
    ]));
  }
  if (projectConfig.defaultEngine) {
    candidates.push(candidate(projectConfig.defaultEngine, "project_default", [
      `项目配置中记录的默认引擎是 ${getEngineDisplayName(projectConfig.defaultEngine)}。`,
    ]));
  }
  if (projectConfig.lastSelectedEngine) {
    candidates.push(candidate(projectConfig.lastSelectedEngine, "project_last", [
      `项目上次使用的引擎是 ${getEngineDisplayName(projectConfig.lastSelectedEngine)}。`,
    ]));
  }
  if (userSettings.defaultEngine) {
    candidates.push(candidate(userSettings.defaultEngine, "user_default", [
      `用户默认引擎是 ${getEngineDisplayName(userSettings.defaultEngine)}。`,
    ]));
  }
  if (userSettings.lastSelectedEngine) {
    candidates.push(candidate(userSettings.lastSelectedEngine, "user_last", [
      `用户上次使用的引擎是 ${getEngineDisplayName(userSettings.lastSelectedEngine)}。`,
    ]));
  }

  const attempted = new Set();
  for (const item of candidates) {
    if (!item.engine || attempted.has(item.engine)) {
      continue;
    }
    attempted.add(item.engine);

    if (availableEngines.includes(item.engine)) {
      if (
        hostContext !== "terminal"
        && item.engine !== hostContext
        && isUserDirectedSource(item.source)
      ) {
        if (!interactive) {
          return {
            ok: false,
            code: "cross_host_engine_confirmation_required",
            message: buildCrossHostSwitchMessage(hostContext, item.engine),
            hostContext,
            probes,
            availableEngines,
          };
        }

        const confirmed = await confirmCrossHostSwitch(hostContext, item.engine);
        if (!confirmed) {
          return {
            ok: false,
            code: "cross_host_engine_cancelled",
            message: "已取消跨宿主引擎切换，本次未开始执行。",
            hostContext,
            probes,
            availableEngines,
          };
        }
      }

      return buildResolution({
        engine: item.engine,
        source: item.source,
        basis: item.basis,
        hostContext,
        probes,
      });
    }

    if (isUserDirectedSource(item.source)) {
      const failedProbe = probes.find((probe) => probe.engine === item.engine);
      if (!interactive || !availableEngines.length) {
        return {
          ok: false,
          code: "requested_engine_unavailable",
          message: buildUnavailableRequestedEngineMessage(item.engine, availableEngines, failedProbe),
          hostContext,
          probes,
          availableEngines,
        };
      }

      const fallbackEngine = await promptSelectEngine(availableEngines, {
        hostContext,
        recommendedEngine: hostContext !== "terminal" && availableEngines.includes(hostContext)
          ? hostContext
          : (availableEngines.includes("codex") ? "codex" : availableEngines[0]),
        message: [
          buildUnavailableRequestedEngineMessage(item.engine, availableEngines, failedProbe),
          "",
          "请选择一个可继续使用的引擎：",
        ].join("\n"),
      });
      if (!fallbackEngine) {
        return {
          ok: false,
          code: "requested_engine_cancelled",
          message: "已取消执行引擎选择，本次未开始执行。",
          hostContext,
          probes,
          availableEngines,
        };
      }

      return buildResolution({
        engine: fallbackEngine,
        source: "interactive_choice",
        basis: [
          `原始指定引擎 ${getEngineDisplayName(item.engine)} 当前不可用。`,
          `用户改为选择 ${getEngineDisplayName(fallbackEngine)}。`,
        ],
        hostContext,
        probes,
      });
    }
  }

  if (!availableEngines.length) {
    return {
      ok: false,
      code: "no_available_engine",
      message: buildNoAvailableEngineMessage(hostContext, probes),
      hostContext,
      probes,
      availableEngines,
    };
  }

  if (availableEngines.length === 1) {
    const [onlyEngine] = availableEngines;
    return buildResolution({
      engine: onlyEngine,
      source: "only_available",
      basis: [`当前仅检测到 ${getEngineDisplayName(onlyEngine)} 可用。`],
      hostContext,
      probes,
    });
  }

  if (!interactive) {
    return {
      ok: false,
      code: "engine_selection_required",
      message: buildEngineSelectionRequiredMessage(hostContext, availableEngines),
      hostContext,
      probes,
      availableEngines,
    };
  }

  const selectedEngine = await promptSelectEngine(availableEngines, {
    hostContext,
    recommendedEngine: hostContext !== "terminal" && availableEngines.includes(hostContext)
      ? hostContext
      : (availableEngines.includes("codex") ? "codex" : availableEngines[0]),
  });
  if (!selectedEngine) {
    return {
      ok: false,
      code: "engine_selection_cancelled",
      message: "已取消执行引擎选择，本次未开始执行。",
      hostContext,
      probes,
      availableEngines,
    };
  }

  return buildResolution({
    engine: selectedEngine,
    source: "interactive_choice",
    basis: [`用户在交互中选择了 ${getEngineDisplayName(selectedEngine)}。`],
    hostContext,
    probes,
  });
}

const SWITCHABLE_FAILURE_MATCHERS = [
  {
    code: "quota",
    reason: "当前引擎可能遇到额度、配额或限流问题。",
    patterns: [
      "429",
      "rate limit",
      "too many requests",
      "quota",
      "credit",
      "usage limit",
      "capacity",
      "overloaded",
      "insufficient balance",
    ],
  },
  {
    code: "auth",
    reason: "当前引擎可能未登录、鉴权失效或权限不足。",
    patterns: [
      "not authenticated",
      "authentication",
      "unauthorized",
      "forbidden",
      "login",
      "api key",
      "token",
      "subscription",
      "setup-token",
      "sign in",
    ],
  },
];

export function classifySwitchableEngineFailure(detail = "") {
  const normalized = String(detail || "").toLowerCase();
  if (!normalized) {
    return null;
  }

  for (const matcher of SWITCHABLE_FAILURE_MATCHERS) {
    if (matcher.patterns.some((pattern) => normalized.includes(pattern))) {
      return {
        code: matcher.code,
        reason: matcher.reason,
      };
    }
  }

  return null;
}

export async function promptEngineFallbackAfterFailure({
  failedEngine,
  hostContext = "terminal",
  probes = [],
  failureSummary = "",
} = {}) {
  const availableEngines = probes
    .filter((item) => item.ok && item.engine !== failedEngine)
    .map((item) => item.engine);

  if (!availableEngines.length) {
    return {
      ok: false,
      engine: "",
    };
  }

  const selectedEngine = await promptSelectEngine(availableEngines, {
    hostContext,
    recommendedEngine: hostContext !== "terminal" && availableEngines.includes(hostContext)
      ? hostContext
      : (availableEngines.includes("codex") ? "codex" : availableEngines[0]),
    message: [
      `${getEngineDisplayName(failedEngine)} 本轮执行失败。`,
      failureSummary || "当前失败疑似来自配额 / 登录 / 鉴权 / 限流问题。",
      "",
      "是否切换到其他可用引擎继续？请选择一个引擎：",
    ].join("\n"),
  });

  if (!selectedEngine) {
    return {
      ok: false,
      engine: "",
    };
  }

  return {
    ok: true,
    engine: selectedEngine,
  };
}

export function rememberEngineSelection(context, engineResolution, options = {}) {
  const engine = normalizeEngineName(engineResolution?.engine);
  if (!engine) {
    return;
  }

  if (context) {
    const projectConfig = loadProjectConfig(context);
    saveProjectConfig(context, {
      ...projectConfig,
      lastSelectedEngine: engine,
    });
  }

  const userSettings = loadUserSettings(options);
  saveUserSettings({
    ...userSettings,
    lastSelectedEngine: engine,
  }, options);
}

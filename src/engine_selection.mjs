import { loadProjectConfig, saveProjectConfig } from "./config.mjs";
import {
  getEngineDisplayName,
  getHostDisplayName,
  normalizeEngineName,
  normalizeHostContext,
} from "./engine_metadata.mjs";
import { classifySwitchableEngineFailure } from "./engine_selection_failure.mjs";
import {
  buildCrossHostSwitchMessage,
  buildEngineSelectionRequiredMessage,
  buildNoAvailableEngineMessage,
  buildUnavailableRequestedEngineMessage,
  candidate,
  detectEngineIntentFromRequestText,
  engineSourceLabel,
  isUserDirectedSource,
} from "./engine_selection_messages.mjs";
import { confirmCrossHostSwitch, promptSelectEngine } from "./engine_selection_prompt.mjs";
import { probeExecutionEngines } from "./engine_selection_probe.mjs";
import { loadUserSettings, resolveUserSettingsFile, saveUserSettings } from "./engine_selection_settings.mjs";

function preferredRecommendationOrder(hostContext) {
  return [
    hostContext !== "terminal" ? hostContext : "",
    "codex",
    "claude",
    "gemini",
  ].filter(Boolean);
}

function recommendEngine({
  hostContext,
  availableEngines = [],
  projectConfig = {},
  userSettings = {},
}) {
  const recommendedCandidates = [
    projectConfig.defaultEngine,
    projectConfig.lastSelectedEngine,
    userSettings.defaultEngine,
    userSettings.lastSelectedEngine,
    ...preferredRecommendationOrder(hostContext),
  ].map((item) => normalizeEngineName(item)).filter(Boolean);

  for (const candidate of recommendedCandidates) {
    if (availableEngines.includes(candidate)) {
      return candidate;
    }
  }
  return availableEngines[0] || "";
}

function buildRecommendationBasis({
  hostContext,
  projectConfig = {},
  userSettings = {},
  recommendedEngine,
}) {
  if (!recommendedEngine) {
    return "";
  }
  if (normalizeEngineName(projectConfig.defaultEngine) === recommendedEngine) {
    return `推荐：项目默认引擎是 ${getEngineDisplayName(recommendedEngine)}。`;
  }
  if (normalizeEngineName(projectConfig.lastSelectedEngine) === recommendedEngine) {
    return `推荐：项目上次使用的引擎是 ${getEngineDisplayName(recommendedEngine)}。`;
  }
  if (normalizeEngineName(userSettings.defaultEngine) === recommendedEngine) {
    return `推荐：用户默认引擎是 ${getEngineDisplayName(recommendedEngine)}。`;
  }
  if (normalizeEngineName(userSettings.lastSelectedEngine) === recommendedEngine) {
    return `推荐：用户上次使用的引擎是 ${getEngineDisplayName(recommendedEngine)}。`;
  }
  if (hostContext !== "terminal" && normalizeEngineName(hostContext) === recommendedEngine) {
    return `推荐：当前宿主是 ${getHostDisplayName(hostContext)}。`;
  }
  return `推荐：当前可用引擎中更适合优先尝试 ${getEngineDisplayName(recommendedEngine)}。`;
}

async function promptForExplicitEngineSelection({
  availableEngines,
  hostContext,
  projectConfig,
  userSettings,
}) {
  const recommendedEngine = recommendEngine({
    hostContext,
    availableEngines,
    projectConfig,
    userSettings,
  });
  return promptSelectEngine(availableEngines, {
    hostContext,
    recommendedEngine,
    message: [
      "本轮开始前必须先明确执行引擎；未明确引擎时不会自动选择。",
      `当前宿主：${getHostDisplayName(hostContext)}。`,
      buildRecommendationBasis({
        hostContext,
        projectConfig,
        userSettings,
        recommendedEngine,
      }),
      "",
      "请选择本次要使用的执行引擎：",
    ].filter(Boolean).join("\n"),
  });
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

export { classifySwitchableEngineFailure, loadUserSettings, probeExecutionEngines, resolveUserSettingsFile, saveUserSettings };

export function resolveHostContext(options = {}) {
  const envCandidate = process.env.HELLOLOOP_HOST_CONTEXT || process.env.HELLOLOOP_HOST;
  return normalizeHostContext(options.hostContext || envCandidate || "terminal");
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

        const confirmed = await confirmCrossHostSwitch(hostContext, item.engine, buildCrossHostSwitchMessage);
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
        recommendedEngine: recommendEngine({
          hostContext,
          availableEngines,
          projectConfig,
          userSettings,
        }),
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

  if (!interactive) {
    return {
      ok: false,
      code: "engine_selection_required",
      message: [
        "本轮开始前必须先明确执行引擎；当前未检测到用户已明确指定引擎。",
        buildEngineSelectionRequiredMessage(hostContext, availableEngines),
      ].join("\n\n"),
      hostContext,
      probes,
      availableEngines,
    };
  }

  const selectedEngine = await promptForExplicitEngineSelection({
    availableEngines,
    hostContext,
    projectConfig,
    userSettings,
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

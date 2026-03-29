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

function recommendEngine(hostContext, availableEngines = []) {
  if (hostContext !== "terminal" && availableEngines.includes(hostContext)) {
    return hostContext;
  }
  if (availableEngines.includes("codex")) {
    return "codex";
  }
  return availableEngines[0] || "";
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
        recommendedEngine: recommendEngine(hostContext, availableEngines),
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
    recommendedEngine: recommendEngine(hostContext, availableEngines),
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
    recommendedEngine: recommendEngine(hostContext, availableEngines),
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

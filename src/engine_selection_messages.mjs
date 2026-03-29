import { getEngineDisplayName, getHostDisplayName, normalizeEngineName } from "./engine_metadata.mjs";
import { renderEngineList } from "./engine_selection_probe.mjs";

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

export function detectEngineIntentFromRequestText(requestText = "") {
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

export function engineSourceLabel(source) {
  return ENGINE_SOURCE_LABELS[source] || "自动判断";
}

export function candidate(engine, source, basis = []) {
  return {
    engine: normalizeEngineName(engine),
    source,
    basis: Array.isArray(basis) ? basis.filter(Boolean) : [],
  };
}

export function isUserDirectedSource(source) {
  return ["flag", "leading_positional", "request_text"].includes(source);
}

function describeProbeFailures(probes = []) {
  return probes
    .filter((item) => !item.ok)
    .map((item) => `- ${getEngineDisplayName(item.engine)}：${item.detail || "不可用"}`);
}

export function buildEngineSelectionRequiredMessage(hostContext, availableEngines) {
  return [
    `检测到多个可用执行引擎：${renderEngineList(availableEngines)}。`,
    `当前宿主：${getHostDisplayName(hostContext)}。`,
    "请显式指定要使用的引擎，例如：",
    "- `npx helloloop codex`",
    "- `npx helloloop claude <PATH>`",
    "- `npx helloloop gemini <PATH> 继续开发`",
  ].join("\n");
}

export function buildNoAvailableEngineMessage(hostContext, probes = []) {
  const failureLines = describeProbeFailures(probes);
  return [
    `当前宿主：${getHostDisplayName(hostContext)}。`,
    "未发现可安全执行的开发引擎（Codex / Claude / Gemini）。",
    ...(failureLines.length ? ["", "检查结果：", ...failureLines] : []),
    "",
    "请先安装并确认至少一个 CLI 可正常执行，然后重试。",
  ].join("\n");
}

export function buildUnavailableRequestedEngineMessage(engine, availableEngines, probe) {
  const lines = [`你指定的执行引擎当前不可用：${getEngineDisplayName(engine)}。`];

  if (probe?.detail) {
    lines.push(`原因：${probe.detail}`);
  }
  if (availableEngines.length) {
    lines.push(`当前仍可用的引擎：${renderEngineList(availableEngines)}。`);
  }
  lines.push("请改用可用引擎，或先修复该 CLI 的安装 / 登录 / 配额问题。");
  return lines.join("\n");
}

export function buildCrossHostSwitchMessage(hostContext, engine) {
  return [
    `当前从 ${getHostDisplayName(hostContext)} 宿主发起，但本次将改用 ${getEngineDisplayName(engine)} 执行。`,
    "这不会静默切换；请确认是否继续。",
  ].join("\n");
}

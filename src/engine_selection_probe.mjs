import { spawnSync } from "node:child_process";

import { getEngineDisplayName, getEngineMetadata, listKnownEngines, normalizeEngineName } from "./engine_metadata.mjs";
import { resolveCliInvocation } from "./shell_invocation.mjs";

function resolveExecutableOverride(policy = {}, engine) {
  const envExecutable = String(process.env[`HELLOLOOP_${String(engine || "").toUpperCase()}_EXECUTABLE`] || "").trim();
  if (envExecutable) {
    return envExecutable;
  }
  return String(policy?.[engine]?.executable || "").trim();
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

export function uniqueEngines(items = []) {
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

export function rankEngines(engines, hostContext = "terminal") {
  const preferredOrder = uniqueEngines([hostContext, "codex", "claude", "gemini"]);
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

export function renderEngineList(engines = []) {
  return rankEngines(engines).map((engine) => getEngineDisplayName(engine)).join("、");
}

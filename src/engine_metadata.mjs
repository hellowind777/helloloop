const ENGINE_METADATA = {
  codex: {
    name: "codex",
    displayName: "Codex",
    commandName: "codex",
    hostDisplayName: "Codex CLI",
  },
  claude: {
    name: "claude",
    displayName: "Claude",
    commandName: "claude",
    hostDisplayName: "Claude Code",
  },
  gemini: {
    name: "gemini",
    displayName: "Gemini",
    commandName: "gemini",
    hostDisplayName: "Gemini CLI",
  },
};

const HOST_METADATA = {
  terminal: {
    name: "terminal",
    displayName: "终端",
  },
  codex: {
    name: "codex",
    displayName: "Codex",
  },
  claude: {
    name: "claude",
    displayName: "Claude",
  },
  gemini: {
    name: "gemini",
    displayName: "Gemini",
  },
};

export function listKnownEngines() {
  return Object.keys(ENGINE_METADATA);
}

export function normalizeEngineName(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ENGINE_METADATA[normalized] ? normalized : "";
}

export function isKnownEngine(value) {
  return Boolean(normalizeEngineName(value));
}

export function getEngineMetadata(engine) {
  return ENGINE_METADATA[normalizeEngineName(engine)] || null;
}

export function getEngineDisplayName(engine) {
  return getEngineMetadata(engine)?.displayName || String(engine || "").trim();
}

export function normalizeHostContext(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "terminal";
  }
  if (normalized === "shell") {
    return "terminal";
  }
  return HOST_METADATA[normalized] ? normalized : "terminal";
}

export function getHostMetadata(hostContext) {
  return HOST_METADATA[normalizeHostContext(hostContext)] || HOST_METADATA.terminal;
}

export function getHostDisplayName(hostContext) {
  return getHostMetadata(hostContext).displayName;
}

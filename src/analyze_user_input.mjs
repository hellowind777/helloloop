import path from "node:path";

import { classifyExplicitPath, pathExists, resolveAbsolute } from "./discovery_paths.mjs";

const DOC_SUFFIX = new Set([
  ".md",
  ".markdown",
  ".mdx",
  ".txt",
  ".rst",
  ".adoc",
]);

const ROLE_LABELS = {
  docs: "开发文档",
  repo: "项目路径",
  input: "补充路径",
  new_repo: "项目路径",
};

const SOURCE_LABELS = {
  flag: "命令参数",
  positional: "命令附带路径",
  interactive: "交互确认",
  interactive_new_repo: "交互确认",
  workspace_single_doc: "工作区唯一文档候选",
  workspace_single_repo: "工作区唯一项目候选",
};

function isProbablyPathToken(token) {
  const value = String(token || "").trim();
  if (!value) {
    return false;
  }

  if (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value)) {
    return true;
  }

  if (/^\.\.?([\\/]|$)/.test(value) || /^[~][\\/]/.test(value)) {
    return true;
  }

  if (value.includes("/") || value.includes("\\")) {
    return true;
  }

  return DOC_SUFFIX.has(path.extname(value).toLowerCase());
}

function normalizePathKey(targetPath) {
  const resolved = path.resolve(String(targetPath || ""));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isSamePath(left, right) {
  return normalizePathKey(left) === normalizePathKey(right);
}

function createIssue(severity, message) {
  return { severity, message: String(message || "").trim() };
}

function roleLabel(role) {
  return ROLE_LABELS[role] || "路径";
}

function sourceLabel(source) {
  return SOURCE_LABELS[source] || "输入";
}

function formatPathRef(ref) {
  const label = roleLabel(ref.role);
  const statusSuffix = ref.role === "new_repo" ? "，当前不存在，将按新项目创建" : "";
  const suffix = ref.source ? `（来源：${sourceLabel(ref.source)}${statusSuffix}）` : "";
  return `${label}：${String(ref.absolutePath || "").replaceAll("\\", "/")}${suffix}`;
}

function ensureSelectionSource(selectionSources, role, source) {
  if (!selectionSources[role] && source) {
    selectionSources[role] = source;
  }
}

function pushDistinctRef(refs, role, absolutePath, source) {
  const existing = refs.find((item) => item.role === role && isSamePath(item.absolutePath, absolutePath));
  if (!existing) {
    refs.push({ role, absolutePath, source });
  }
}

function pushRoleConflict(issues, role, acceptedPath, incomingPath, acceptedSource, incomingSource) {
  if (isSamePath(acceptedPath, incomingPath)) {
    return;
  }

  issues.blocking.push(createIssue(
    "blocking",
    `同时给出了多个${roleLabel(role)}：${String(acceptedPath).replaceAll("\\", "/")}（${sourceLabel(acceptedSource)}） 与 ${String(incomingPath).replaceAll("\\", "/")}（${sourceLabel(incomingSource)}）。请只保留一个，或改用 ${role === "repo" ? "--repo" : "--docs"} 明确指定。`,
  ));
}

function assignDocsPath({
  absolutePath,
  source,
  explicitRefs,
  issues,
  selectionSources,
  currentDocsPath,
}) {
  if (!currentDocsPath) {
    pushDistinctRef(explicitRefs, "docs", absolutePath, source);
    ensureSelectionSource(selectionSources, "docs", source);
    return absolutePath;
  }

  pushRoleConflict(issues, "docs", currentDocsPath, absolutePath, selectionSources.docs || source, source);
  pushDistinctRef(explicitRefs, "docs", absolutePath, source);
  return currentDocsPath;
}

function assignRepoRoot({
  absolutePath,
  source,
  explicitRefs,
  issues,
  selectionSources,
  currentRepoRoot,
  allowNewRepoRoot = false,
}) {
  if (!currentRepoRoot) {
    pushDistinctRef(explicitRefs, allowNewRepoRoot ? "new_repo" : "repo", absolutePath, source);
    ensureSelectionSource(selectionSources, "repo", source);
    return absolutePath;
  }

  pushRoleConflict(issues, "repo", currentRepoRoot, absolutePath, selectionSources.repo || source, source);
  pushDistinctRef(explicitRefs, allowNewRepoRoot ? "new_repo" : "repo", absolutePath, source);
  return currentRepoRoot;
}

export function normalizeAnalyzeOptions(rawOptions = {}, cwd = process.cwd()) {
  const options = {
    ...rawOptions,
    requiredDocs: Array.isArray(rawOptions.requiredDocs) ? [...rawOptions.requiredDocs] : [],
    constraints: Array.isArray(rawOptions.constraints) ? [...rawOptions.constraints] : [],
  };
  const positionals = Array.isArray(rawOptions.positionalArgs) ? rawOptions.positionalArgs : [];
  const explicitRefs = [];
  const requestTokens = [];
  const issues = {
    blocking: [],
    warnings: [],
  };
  const selectionSources = {
    ...(rawOptions.selectionSources || {}),
  };

  let docsPath = options.docsPath ? resolveAbsolute(options.docsPath, cwd) : "";
  let repoRoot = options.repoRoot ? resolveAbsolute(options.repoRoot, cwd) : "";
  let inputPath = options.inputPath ? resolveAbsolute(options.inputPath, cwd) : "";
  let allowNewRepoRoot = Boolean(options.allowNewRepoRoot);

  if (docsPath) {
    ensureSelectionSource(selectionSources, "docs", rawOptions.selectionSources?.docs || "flag");
  }
  if (repoRoot) {
    ensureSelectionSource(selectionSources, "repo", rawOptions.selectionSources?.repo || "flag");
    if (allowNewRepoRoot && !pathExists(repoRoot)) {
      pushDistinctRef(explicitRefs, "new_repo", repoRoot, selectionSources.repo);
    }
  }

  for (const token of positionals) {
    if (!isProbablyPathToken(token)) {
      requestTokens.push(token);
      continue;
    }

    const absolutePath = resolveAbsolute(token, cwd);
    if (pathExists(absolutePath)) {
      const classified = classifyExplicitPath(absolutePath);
      if (classified.kind === "docs") {
        docsPath = assignDocsPath({
          absolutePath: classified.absolutePath,
          source: "positional",
          explicitRefs,
          issues,
          selectionSources,
          currentDocsPath: docsPath,
        });
        continue;
      }
      if (classified.kind === "repo") {
        repoRoot = assignRepoRoot({
          absolutePath: classified.absolutePath,
          source: "positional",
          explicitRefs,
          issues,
          selectionSources,
          currentRepoRoot: repoRoot,
        });
        continue;
      }
      if ((classified.kind === "workspace" || classified.kind === "directory") && docsPath) {
        repoRoot = assignRepoRoot({
          absolutePath: classified.absolutePath,
          source: "positional",
          explicitRefs,
          issues,
          selectionSources,
          currentRepoRoot: repoRoot,
        });
        continue;
      }
      if (!inputPath) {
        inputPath = classified.absolutePath;
        pushDistinctRef(explicitRefs, "input", classified.absolutePath, "positional");
        continue;
      }
    } else if (!repoRoot) {
      repoRoot = absolutePath;
      allowNewRepoRoot = true;
      ensureSelectionSource(selectionSources, "repo", "positional");
      pushDistinctRef(explicitRefs, "new_repo", absolutePath, "positional");
      continue;
    } else {
      pushRoleConflict(issues, "repo", repoRoot, absolutePath, selectionSources.repo || "positional", "positional");
      pushDistinctRef(explicitRefs, "new_repo", absolutePath, "positional");
      continue;
    }

    requestTokens.push(token);
  }

  if (options.dryRun && options.yes) {
    issues.warnings.push(createIssue(
      "warning",
      "同时传入了 --dry-run 和 -y；本次仍按 --dry-run 只分析，不自动执行。",
    ));
  }

  const userRequestText = requestTokens.join(" ").trim();

  options.docsPath = docsPath;
  options.repoRoot = repoRoot;
  options.inputPath = inputPath;
  options.allowNewRepoRoot = allowNewRepoRoot;
  options.selectionSources = selectionSources;
  options.userRequestText = userRequestText;
  options.inputIssues = issues;
  options.userIntent = {
    rawPositionals: positionals,
    explicitRefs,
    requestText: userRequestText,
    issues,
    selectionSources,
  };

  return options;
}

export function hasBlockingInputIssues(inputIssues = {}) {
  return Array.isArray(inputIssues.blocking) && inputIssues.blocking.length > 0;
}

export function renderInputIssueLines(inputIssues = {}) {
  return [
    ...(Array.isArray(inputIssues.blocking) ? inputIssues.blocking : []),
    ...(Array.isArray(inputIssues.warnings) ? inputIssues.warnings : []),
  ].map((item) => `- ${item.message}`);
}

export function renderBlockingInputIssueMessage(inputIssues = {}) {
  const lines = renderInputIssueLines({
    blocking: Array.isArray(inputIssues.blocking) ? inputIssues.blocking : [],
  });
  if (!lines.length) {
    return "";
  }

  return [
    "检测到命令输入存在冲突：",
    ...lines,
    "",
    "请整理后重试；建议只保留一个开发文档路径和一个项目路径，必要时改用 `--docs` / `--repo` 明确指定。",
  ].join("\n");
}

export function renderUserIntentLines(userIntent = {}) {
  const lines = [];
  const explicitRefs = Array.isArray(userIntent.explicitRefs) ? userIntent.explicitRefs : [];
  const requestText = String(userIntent.requestText || "").trim();

  if (explicitRefs.length) {
    lines.push(...explicitRefs.map((ref) => formatPathRef(ref)));
  }
  if (requestText) {
    lines.push(`附加要求：${requestText}`);
  }

  return lines;
}

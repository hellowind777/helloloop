import os from "node:os";
import path from "node:path";

import { expandDocumentEntries } from "./doc_loader.mjs";
import {
  classifyExplicitPath,
  findRepoRootFromPath,
  looksLikeProjectRoot,
  normalizeForRepo,
  pathExists,
  resolveAbsolute,
  uniquePaths,
} from "./discovery_paths.mjs";
import {
  inferDocsForRepo,
  inferRepoFromDocs,
  inspectWorkspaceDirectory,
  renderMissingDocsMessage,
  renderMissingRepoMessage,
} from "./discovery_inference.mjs";

export { findRepoRootFromPath } from "./discovery_paths.mjs";

const CONFIDENCE_LABELS = {
  high: "高",
  medium: "中",
  low: "低",
};

const REPO_SOURCE_META = {
  explicit_flag: { label: "命令参数", confidence: "high" },
  explicit_input: { label: "命令附带路径", confidence: "high" },
  new_repo_input: { label: "命令附带路径", confidence: "high" },
  interactive: { label: "交互确认", confidence: "high" },
  interactive_new_repo: { label: "交互确认", confidence: "high" },
  cwd_repo: { label: "当前目录", confidence: "medium" },
  workspace_single_repo: { label: "工作区唯一候选项目", confidence: "medium" },
  docs_ancestor: { label: "文档同树回溯", confidence: "medium" },
  doc_path_hint: { label: "文档中的路径线索", confidence: "medium" },
  doc_repo_name_hint: { label: "文档中的仓库名线索", confidence: "low" },
};

const DOCS_SOURCE_META = {
  explicit_flag: { label: "命令参数", confidence: "high" },
  explicit_input: { label: "命令附带路径", confidence: "high" },
  interactive: { label: "交互确认", confidence: "high" },
  cwd_docs: { label: "当前目录", confidence: "medium" },
  workspace_single_doc: { label: "工作区唯一文档候选", confidence: "medium" },
  existing_state: { label: "已有 .helloloop 配置", confidence: "medium" },
  repo_docs_dir: { label: "项目目录 docs 目录", confidence: "medium" },
  repo_doc_file: { label: "项目目录顶层文档", confidence: "medium" },
};

function isImplicitHomeDirectory(targetPath) {
  return Boolean(targetPath)
    && path.resolve(targetPath) === path.resolve(os.homedir());
}

function pushBasis(basis, message) {
  if (message && !basis.includes(message)) {
    basis.push(message);
  }
}

function repoSourceFromSelection(selectionSource, allowNewRepoRoot, repoRoot) {
  if (selectionSource === "flag") {
    return allowNewRepoRoot && repoRoot && !pathExists(repoRoot) ? "new_repo_input" : "explicit_flag";
  }
  if (selectionSource === "positional") {
    return allowNewRepoRoot && repoRoot && !pathExists(repoRoot) ? "new_repo_input" : "explicit_input";
  }
  if (selectionSource === "interactive_new_repo") {
    return "interactive_new_repo";
  }
  if (selectionSource === "interactive") {
    return "interactive";
  }
  if (selectionSource === "workspace_single_repo") {
    return "workspace_single_repo";
  }
  return "";
}

function docsSourceFromSelection(selectionSource) {
  if (selectionSource === "flag") {
    return "explicit_flag";
  }
  if (selectionSource === "positional") {
    return "explicit_input";
  }
  if (selectionSource === "interactive") {
    return "interactive";
  }
  if (selectionSource === "workspace_single_doc") {
    return "workspace_single_doc";
  }
  return "";
}

function createResolution(kind, payload) {
  const meta = kind === "repo" ? REPO_SOURCE_META : DOCS_SOURCE_META;
  const selected = meta[payload.source] || { label: "自动判断", confidence: "medium" };
  return {
    ...payload,
    sourceLabel: selected.label,
    confidence: selected.confidence,
    confidenceLabel: CONFIDENCE_LABELS[selected.confidence] || "中",
    basis: Array.isArray(payload.basis) ? payload.basis.filter(Boolean) : [],
  };
}

function createRepoResolution(repoRoot, source, basis) {
  return createResolution("repo", {
    source,
    path: repoRoot,
    exists: pathExists(repoRoot),
    basis,
  });
}

function createDocsResolution(docsEntries, source, basis) {
  return createResolution("docs", {
    source,
    entries: docsEntries,
    basis,
  });
}

export function discoverWorkspace(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const configDirName = options.configDirName || ".helloloop";
  const allowNewRepoRoot = Boolean(options.allowNewRepoRoot);
  const selectionSources = options.selectionSources || {};
  const explicitRepoRoot = options.repoRoot ? resolveAbsolute(options.repoRoot, cwd) : "";
  const explicitDocsPath = options.docsPath ? resolveAbsolute(options.docsPath, cwd) : "";
  const explicitInputPath = options.inputPath ? resolveAbsolute(options.inputPath, cwd) : "";
  const treatCwdAsHomeWorkspace = !explicitRepoRoot
    && !explicitDocsPath
    && !explicitInputPath
    && isImplicitHomeDirectory(cwd);

  if (explicitRepoRoot && !pathExists(explicitRepoRoot)) {
    if (!allowNewRepoRoot) {
      return { ok: false, code: "missing_repo_path", message: `项目路径不存在：${explicitRepoRoot}` };
    }
  }
  if (explicitDocsPath && !pathExists(explicitDocsPath)) {
    return { ok: false, code: "missing_docs_path", message: `开发文档路径不存在：${explicitDocsPath}` };
  }

  let repoRoot = explicitRepoRoot;
  let docsEntries = explicitDocsPath ? [explicitDocsPath] : [];
  let docCandidates = [];
  let repoCandidates = [];
  let workspaceRoot = "";
  let docsDerivedFromWorkspace = false;
  let repoSource = repoSourceFromSelection(selectionSources.repo, allowNewRepoRoot, explicitRepoRoot);
  let docsSource = docsSourceFromSelection(selectionSources.docs);
  const repoBasis = [];
  const docsBasis = [];

  if (explicitRepoRoot && !repoSource) {
    repoSource = allowNewRepoRoot && !pathExists(explicitRepoRoot) ? "new_repo_input" : "explicit_input";
  }
  if (explicitDocsPath && !docsSource) {
    docsSource = "explicit_input";
  }

  if (repoSource === "explicit_flag") {
    pushBasis(repoBasis, "目标项目来自命令参数 `--repo`。");
  } else if (repoSource === "explicit_input") {
    pushBasis(repoBasis, "目标项目来自命令中显式提供的路径。");
  } else if (repoSource === "new_repo_input") {
    pushBasis(repoBasis, "目标项目来自显式提供的项目路径；该目录当前不存在，将按新项目创建。");
  } else if (repoSource === "interactive_new_repo") {
    pushBasis(repoBasis, "目标项目由用户在确认流程中指定；该目录当前不存在，将按新项目创建。");
  } else if (repoSource === "interactive") {
    pushBasis(repoBasis, "目标项目由用户在确认流程中手动指定。");
  }

  if (docsSource === "explicit_flag") {
    pushBasis(docsBasis, "开发文档来自命令参数 `--docs`。");
  } else if (docsSource === "explicit_input") {
    pushBasis(docsBasis, "开发文档来自命令中显式提供的路径。");
  } else if (docsSource === "interactive") {
    pushBasis(docsBasis, "开发文档由用户在确认流程中手动指定。");
  }

  if (!repoRoot && !docsEntries.length) {
    const classified = classifyExplicitPath(explicitInputPath);
    if (classified.kind === "missing") {
      return { ok: false, code: "missing_input_path", message: `路径不存在：${classified.absolutePath}` };
    }
    if (classified.kind === "docs") {
      docsEntries = [classified.absolutePath];
      docsSource = "explicit_input";
      pushBasis(docsBasis, "开发文档来自命令中传入的单一路径。");
    }
    if (classified.kind === "repo") {
      repoRoot = classified.absolutePath;
      repoSource = "explicit_input";
      pushBasis(repoBasis, "目标项目来自命令中传入的单一路径。");
    }
    if (classified.kind === "directory") {
      repoRoot = classified.absolutePath;
      repoSource = "explicit_input";
      pushBasis(repoBasis, "目标项目来自命令中传入的目录路径。");
    }
    if (classified.kind === "workspace") {
      workspaceRoot = classified.absolutePath;
    }
  }

  if (!repoRoot && !docsEntries.length) {
    const cwdRepoRoot = treatCwdAsHomeWorkspace ? "" : findRepoRootFromPath(cwd);
    if (cwdRepoRoot) {
      repoRoot = cwdRepoRoot;
      repoSource = "cwd_repo";
      pushBasis(repoBasis, "当前终端目录已经位于一个项目仓库内。");
    } else {
      const cwdClassified = treatCwdAsHomeWorkspace
        ? { kind: "workspace", absolutePath: cwd }
        : classifyExplicitPath(cwd);
      if (cwdClassified.kind === "docs") {
        docsEntries = [cwdClassified.absolutePath];
        docsSource = "cwd_docs";
        pushBasis(docsBasis, "当前终端目录本身就是开发文档目录或文件。");
      } else if (cwdClassified.kind === "repo") {
        repoRoot = cwdClassified.absolutePath;
        repoSource = "cwd_repo";
        pushBasis(repoBasis, "当前终端目录本身就是项目仓库。");
      } else if (cwdClassified.kind === "workspace") {
        workspaceRoot = cwdClassified.absolutePath;
      } else if (cwdClassified.kind === "directory") {
        repoRoot = cwdClassified.absolutePath;
        repoSource = "cwd_repo";
        pushBasis(repoBasis, "当前终端目录默认作为项目目录。");
      } else if (looksLikeProjectRoot(cwd)) {
        repoRoot = cwd;
        repoSource = "cwd_repo";
        pushBasis(repoBasis, "当前终端目录具备项目仓库特征。");
      }
    }
  }

  if (!repoRoot && docsEntries.length && !treatCwdAsHomeWorkspace) {
    const cwdClassified = classifyExplicitPath(cwd);
    if (cwdClassified.kind === "repo") {
      repoRoot = cwdClassified.absolutePath;
      repoSource = "cwd_repo";
      pushBasis(repoBasis, "当前终端目录本身就是项目仓库。");
    } else if (cwdClassified.kind === "directory") {
      repoRoot = cwdClassified.absolutePath;
      repoSource = "cwd_repo";
      pushBasis(repoBasis, "当前终端目录默认作为项目目录。");
    } else if (cwdClassified.kind === "workspace") {
      workspaceRoot = workspaceRoot || cwdClassified.absolutePath;
    } else if (looksLikeProjectRoot(cwd)) {
      repoRoot = cwd;
      repoSource = "cwd_repo";
      pushBasis(repoBasis, "当前终端目录具备项目仓库特征。");
    }
  }

  if (!repoRoot && !docsEntries.length && workspaceRoot) {
    const workspace = inspectWorkspaceDirectory(workspaceRoot);
    docCandidates = workspace.docCandidates;
    repoCandidates = workspace.repoCandidates;

    if (workspace.docsEntries.length === 1) {
      docsEntries = workspace.docsEntries;
      docsDerivedFromWorkspace = true;
      docsSource = "workspace_single_doc";
      pushBasis(docsBasis, "工作区扫描后只发现一个顶层开发文档入口。");
    }

    if (workspace.repoCandidates.length === 1) {
      repoRoot = workspace.repoCandidates[0];
      repoSource = "workspace_single_repo";
      pushBasis(repoBasis, "工作区扫描后只发现一个顶层项目候选目录。");
    }
  }

  if (!repoRoot && docsEntries.length) {
    if (docsDerivedFromWorkspace && repoCandidates.length > 1) {
      return {
        ok: false,
        code: "missing_repo",
        message: renderMissingRepoMessage(docsEntries, repoCandidates),
        docsEntries,
        docCandidates,
        repoCandidates,
        workspaceRoot,
      };
    }

    const inferred = inferRepoFromDocs(docsEntries, cwd);
    repoRoot = inferred.repoRoot;
    repoCandidates = uniquePaths([...repoCandidates, ...inferred.candidates]);
    if (repoRoot) {
      if (inferred.source === "ancestor") {
        repoSource = "docs_ancestor";
        pushBasis(repoBasis, "开发文档位于该仓库目录树内，已回溯到真实项目根目录。");
      } else if (inferred.source === "doc_path_hint") {
        repoSource = "doc_path_hint";
        pushBasis(repoBasis, "开发文档内容中出现了指向该仓库的实际路径线索。");
      } else if (inferred.source === "doc_repo_name_hint") {
        repoSource = "doc_repo_name_hint";
        pushBasis(repoBasis, "开发文档内容中出现了与该仓库名称一致的线索。");
      }
    }
  }

  if (!repoRoot) {
    return {
      ok: false,
      code: "missing_repo",
      message: renderMissingRepoMessage(docsEntries, repoCandidates),
      docsEntries,
      docCandidates,
      repoCandidates,
      workspaceRoot,
    };
  }

  const normalizedRepoRoot = findRepoRootFromPath(repoRoot) || repoRoot;
  if (normalizedRepoRoot !== repoRoot) {
    pushBasis(repoBasis, "已自动回溯到项目仓库根目录。");
  }
  repoRoot = normalizedRepoRoot;
  docsEntries = docsEntries.map((entry) => normalizeForRepo(repoRoot, entry));

  if (!docsEntries.length) {
    const inferred = inferDocsForRepo(repoRoot, cwd, configDirName);
    docsEntries = inferred.docsEntries;
    docCandidates = inferred.candidates;
    if (docsEntries.length) {
      docsSource = inferred.source || docsSource;
      if (inferred.source === "existing_state") {
        pushBasis(docsBasis, "已复用 `.helloloop/project.json` 中记录的 requiredDocs。");
      } else if (inferred.source === "cwd") {
        docsSource = "cwd_docs";
        pushBasis(docsBasis, "当前终端目录本身就是开发文档目录或文件。");
      } else if (inferred.source === "repo_docs_dir") {
        pushBasis(docsBasis, "已使用项目目录中的 `docs/` 目录作为默认开发文档入口。");
      } else if (inferred.source === "repo_doc_file") {
        pushBasis(docsBasis, "已使用项目目录中的顶层文档文件作为默认开发文档入口。");
      }
    }
  }

  if (!docsEntries.length) {
    return {
      ok: false,
      code: "missing_docs",
      repoRoot,
      message: renderMissingDocsMessage(repoRoot, docCandidates),
      candidates: docCandidates,
      docsEntries,
      docCandidates,
      repoCandidates,
      workspaceRoot,
    };
  }

  const resolvedDocs = expandDocumentEntries(repoRoot, docsEntries);
  if (!resolvedDocs.length) {
    return {
      ok: false,
      code: "invalid_docs",
      repoRoot,
      message: renderMissingDocsMessage(repoRoot, docCandidates),
      docsEntries,
      docCandidates,
      repoCandidates,
      workspaceRoot,
    };
  }

  return {
    ok: true,
    repoRoot,
    docsEntries,
    resolvedDocs,
    resolution: {
      repo: createRepoResolution(repoRoot, repoSource || "cwd_repo", repoBasis),
      docs: createDocsResolution(docsEntries, docsSource || "repo_docs", docsBasis),
    },
  };
}

export function resolveRepoRoot(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const explicitRepoRoot = options.repoRoot ? resolveAbsolute(options.repoRoot, cwd) : "";
  const explicitInputPath = options.inputPath ? resolveAbsolute(options.inputPath, cwd) : "";

  if (explicitRepoRoot) {
    if (!pathExists(explicitRepoRoot)) {
      return { ok: false, message: `项目路径不存在：${explicitRepoRoot}` };
    }
    return { ok: true, repoRoot: findRepoRootFromPath(explicitRepoRoot) || explicitRepoRoot };
  }

  const classified = classifyExplicitPath(explicitInputPath);
  if (classified.kind === "missing") {
    return { ok: false, message: `路径不存在：${classified.absolutePath}` };
  }
  if (classified.kind === "repo") {
    return { ok: true, repoRoot: findRepoRootFromPath(classified.absolutePath) || classified.absolutePath };
  }
  if (classified.kind === "docs") {
    const inferred = inferRepoFromDocs([classified.absolutePath], cwd);
    if (inferred.repoRoot) {
      return { ok: true, repoRoot: inferred.repoRoot };
    }
    return { ok: false, message: renderMissingRepoMessage([classified.absolutePath], inferred.candidates) };
  }
  if (classified.kind === "directory") {
    return { ok: true, repoRoot: classified.absolutePath };
  }

  if (!explicitRepoRoot && !explicitInputPath && isImplicitHomeDirectory(cwd)) {
    return {
      ok: false,
      message: "当前目录看起来是用户主目录；HelloLoop 不会把主目录自动当作项目仓库。请切到项目目录，或传入一个项目路径/开发文档路径。",
    };
  }

  const repoRoot = findRepoRootFromPath(cwd);
  if (repoRoot) {
    return { ok: true, repoRoot };
  }

  if (looksLikeProjectRoot(cwd)) {
    return { ok: true, repoRoot: cwd };
  }

  return { ok: true, repoRoot: cwd };
}

import path from "node:path";

import { expandDocumentEntries } from "./doc_loader.mjs";
import {
  classifyExplicitPath,
  findRepoRootFromPath,
  looksLikeProjectRoot,
  normalizeForRepo,
  pathExists,
  resolveAbsolute,
} from "./discovery_paths.mjs";
import {
  inferDocsForRepo,
  inferRepoFromDocs,
  renderMissingDocsMessage,
  renderMissingRepoMessage,
} from "./discovery_inference.mjs";

export { findRepoRootFromPath } from "./discovery_paths.mjs";

export function discoverWorkspace(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const configDirName = options.configDirName || ".helloloop";
  const explicitRepoRoot = options.repoRoot ? resolveAbsolute(options.repoRoot, cwd) : "";
  const explicitDocsPath = options.docsPath ? resolveAbsolute(options.docsPath, cwd) : "";
  const explicitInputPath = options.inputPath ? resolveAbsolute(options.inputPath, cwd) : "";

  if (explicitRepoRoot && !pathExists(explicitRepoRoot)) {
    return { ok: false, code: "missing_repo_path", message: `项目路径不存在：${explicitRepoRoot}` };
  }
  if (explicitDocsPath && !pathExists(explicitDocsPath)) {
    return { ok: false, code: "missing_docs_path", message: `开发文档路径不存在：${explicitDocsPath}` };
  }

  let repoRoot = explicitRepoRoot;
  let docsEntries = explicitDocsPath ? [explicitDocsPath] : [];
  let docCandidates = [];
  let repoCandidates = [];

  if (!repoRoot && !docsEntries.length) {
    const classified = classifyExplicitPath(explicitInputPath);
    if (classified.kind === "missing") {
      return { ok: false, code: "missing_input_path", message: `路径不存在：${classified.absolutePath}` };
    }
    if (classified.kind === "docs") {
      docsEntries = [classified.absolutePath];
    }
    if (classified.kind === "repo") {
      repoRoot = classified.absolutePath;
    }
  }

  if (!repoRoot && !docsEntries.length) {
    const cwdRepoRoot = findRepoRootFromPath(cwd);
    if (cwdRepoRoot) {
      repoRoot = cwdRepoRoot;
    } else if (classifyExplicitPath(cwd).kind === "docs") {
      docsEntries = [cwd];
    } else if (looksLikeProjectRoot(cwd)) {
      repoRoot = cwd;
    }
  }

  if (!repoRoot && docsEntries.length) {
    const inferred = inferRepoFromDocs(docsEntries, cwd);
    repoRoot = inferred.repoRoot;
    repoCandidates = inferred.candidates;
  }

  if (!repoRoot) {
    return {
      ok: false,
      code: "missing_repo",
      message: renderMissingRepoMessage(docsEntries, repoCandidates),
    };
  }

  repoRoot = findRepoRootFromPath(repoRoot) || repoRoot;
  docsEntries = docsEntries.map((entry) => normalizeForRepo(repoRoot, entry));

  if (!docsEntries.length) {
    const inferred = inferDocsForRepo(repoRoot, cwd, configDirName);
    docsEntries = inferred.docsEntries;
    docCandidates = inferred.candidates;
  }

  if (!docsEntries.length) {
    return {
      ok: false,
      code: "missing_docs",
      repoRoot,
      message: renderMissingDocsMessage(repoRoot),
      candidates: docCandidates,
    };
  }

  const resolvedDocs = expandDocumentEntries(repoRoot, docsEntries);
  if (!resolvedDocs.length) {
    return {
      ok: false,
      code: "invalid_docs",
      repoRoot,
      message: renderMissingDocsMessage(repoRoot),
    };
  }

  return {
    ok: true,
    repoRoot,
    docsEntries,
    resolvedDocs,
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

  const repoRoot = findRepoRootFromPath(cwd);
  if (repoRoot) {
    return { ok: true, repoRoot };
  }

  if (looksLikeProjectRoot(cwd)) {
    return { ok: true, repoRoot: cwd };
  }

  return {
    ok: false,
    message: "当前目录不是项目仓库。请切到项目目录，或传入一个项目路径/开发文档路径。",
  };
}

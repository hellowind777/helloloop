import fs from "node:fs";
import path from "node:path";

import { readJson } from "./common.mjs";
import { expandDocumentEntries } from "./doc_loader.mjs";
import {
  findRepoRootFromPath,
  isDocFile,
  isDocsDirectory,
  looksLikeProjectRoot,
  normalizeForRepo,
  pathExists,
  resolveAbsolute,
  uniquePaths,
} from "./discovery_paths.mjs";

function loadExistingRequiredDocs(repoRoot, configDirName) {
  const projectFile = path.join(repoRoot, configDirName, "project.json");
  if (!pathExists(projectFile)) {
    return [];
  }

  const projectConfig = readJson(projectFile);
  const entries = Array.isArray(projectConfig.requiredDocs) ? projectConfig.requiredDocs : [];
  const resolved = expandDocumentEntries(repoRoot, entries);
  return resolved.length ? entries : [];
}

function readDocPreview(docEntries, cwd) {
  let remaining = 24000;
  const snippets = [];

  for (const entry of docEntries) {
    const expanded = expandDocumentEntries(cwd, [entry]);
    for (const file of expanded) {
      if (remaining <= 0) {
        return snippets.join("\n");
      }

      const content = fs.readFileSync(file.absolutePath, "utf8");
      const slice = content.slice(0, Math.min(content.length, remaining));
      snippets.push(slice);
      remaining -= slice.length;
    }
  }

  return snippets.join("\n");
}

function normalizePathHint(rawValue) {
  const trimmed = String(rawValue || "").trim().replace(/^["'`(<\[]+|[>"'`)\].,;:]+$/g, "");
  if (/^\/[A-Za-z]:[\\/]/.test(trimmed)) {
    return trimmed.slice(1);
  }
  return trimmed;
}

function extractPathHintsFromText(text) {
  const hints = new Set();
  const normalizedText = String(text || "");
  const windowsMatches = normalizedText.match(/\/?[A-Za-z]:[\\/][^\s"'`<>()\]]+/g) || [];
  const posixMatches = normalizedText.match(/(?:^|[\s("'`])\/[^\s"'`<>()\]]+/g) || [];

  for (const rawMatch of [...windowsMatches, ...posixMatches]) {
    const normalized = normalizePathHint(rawMatch);
    if (normalized) {
      hints.add(normalized);
    }
  }

  return [...hints];
}

function extractRepoNameHintsFromText(text) {
  const hints = new Set();
  const matches = String(text || "").match(/`([A-Za-z0-9._-]{3,})`/g) || [];

  for (const match of matches) {
    const value = match.slice(1, -1);
    if (/^(docs?|src|tests?|readme|sqlite|wal|sqlcipher)$/i.test(value)) {
      continue;
    }
    hints.add(value.toLowerCase());
  }

  return [...hints];
}

function listNearbyProjectCandidates(searchRoot) {
  if (!pathExists(searchRoot) || !fs.statSync(searchRoot).isDirectory()) {
    return [];
  }

  return fs.readdirSync(searchRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(searchRoot, entry.name))
    .filter((directoryPath) => looksLikeProjectRoot(directoryPath));
}

export function inferRepoFromDocs(docEntries, cwd) {
  const expandedFiles = expandDocumentEntries(cwd, docEntries);
  const absoluteEntries = expandedFiles.map((item) => item.absolutePath);

  for (const absolutePath of absoluteEntries) {
    const repoRoot = findRepoRootFromPath(absolutePath);
    if (repoRoot) {
      return {
        repoRoot,
        candidates: [repoRoot],
        source: "ancestor",
      };
    }
  }

  const previewText = readDocPreview(docEntries, cwd);
  const pathHintCandidates = extractPathHintsFromText(previewText)
    .map((item) => resolveAbsolute(item, cwd))
    .filter((candidate) => pathExists(candidate))
    .map((candidate) => (fs.statSync(candidate).isDirectory() ? candidate : path.dirname(candidate)))
    .map((candidate) => findRepoRootFromPath(candidate) || (looksLikeProjectRoot(candidate) ? candidate : ""))
    .filter(Boolean);

  const uniquePathCandidates = uniquePaths(pathHintCandidates);
  if (uniquePathCandidates.length === 1) {
    return {
      repoRoot: uniquePathCandidates[0],
      candidates: uniquePathCandidates,
      source: "doc_path_hint",
    };
  }

  const repoNameHints = extractRepoNameHintsFromText(previewText);
  const searchRoots = uniquePaths(
    absoluteEntries.flatMap((absolutePath) => {
      const directory = fs.statSync(absolutePath).isDirectory()
        ? absolutePath
        : path.dirname(absolutePath);
      const parent = path.dirname(directory);
      return [directory, parent, path.dirname(parent)];
    }),
  );
  const nearbyCandidates = uniquePaths(
    searchRoots.flatMap((searchRoot) => listNearbyProjectCandidates(searchRoot)),
  );
  const namedCandidates = nearbyCandidates.filter((directoryPath) => (
    repoNameHints.includes(path.basename(directoryPath).toLowerCase())
  ));

  if (namedCandidates.length === 1) {
    return {
      repoRoot: namedCandidates[0],
      candidates: namedCandidates,
      source: "doc_repo_name_hint",
    };
  }

  return {
    repoRoot: "",
    candidates: uniquePaths([...uniquePathCandidates, ...namedCandidates]),
    source: "",
  };
}

export function inferDocsForRepo(repoRoot, cwd, configDirName) {
  const existingRequiredDocs = loadExistingRequiredDocs(repoRoot, configDirName);
  if (existingRequiredDocs.length) {
    return {
      docsEntries: existingRequiredDocs,
      source: "existing_state",
      candidates: existingRequiredDocs,
    };
  }

  const cwdIsDocSource = pathExists(cwd) && (isDocFile(cwd) || isDocsDirectory(cwd));
  if (cwdIsDocSource) {
    return {
      docsEntries: [normalizeForRepo(repoRoot, cwd)],
      source: "cwd",
      candidates: [cwd],
    };
  }

  const repoDocsCandidates = uniquePaths([
    path.join(repoRoot, "docs"),
    path.join(repoRoot, "Docs"),
  ].filter((candidate) => isDocsDirectory(candidate)));

  if (repoDocsCandidates.length === 1) {
    return {
      docsEntries: [normalizeForRepo(repoRoot, repoDocsCandidates[0])],
      source: "repo_docs",
      candidates: repoDocsCandidates,
    };
  }

  return {
    docsEntries: [],
    source: "",
    candidates: repoDocsCandidates,
  };
}

export function renderMissingRepoMessage(docEntries, candidates) {
  return [
    "无法自动确定要开发的项目仓库路径。",
    docEntries.length ? `已找到开发文档：${docEntries.join(", ")}` : "",
    candidates.length > 1 ? `本地发现多个候选项目：${candidates.map((item) => path.basename(item)).join(", ")}` : "",
    "请补充项目仓库路径后重试，例如：",
    "npx helloloop --repo <PROJECT_ROOT>",
  ].filter(Boolean).join("\n");
}

export function renderMissingDocsMessage(repoRoot) {
  return [
    "无法自动确定开发文档位置。",
    `已找到项目仓库：${repoRoot}`,
    "请补充开发文档路径后重试，例如：",
    "npx helloloop --docs <DOCS_PATH>",
  ].join("\n");
}

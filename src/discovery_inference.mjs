import fs from "node:fs";
import path from "node:path";

import { readJson } from "./common.mjs";
import { expandDocumentEntries } from "./doc_loader.mjs";
import {
  findPreferredRepoRootFromPath,
  findRepoRootFromPath,
  isDocFile,
  isDocsDirectory,
  listDocFilesInDirectory,
  listProjectCandidatesInDirectory,
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

function formatCandidates(title, candidates) {
  if (!Array.isArray(candidates) || !candidates.length) {
    return [];
  }

  return [
    title,
    ...candidates.map((item, index) => `${index + 1}. ${path.basename(item)} — ${item.replaceAll("\\", "/")}`),
  ];
}

export function inspectWorkspaceDirectory(directoryPath) {
  if (!pathExists(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    return {
      docCandidates: [],
      docsEntries: [],
      repoCandidates: [],
      topLevelDirectories: [],
      topLevelDocFiles: [],
    };
  }

  const topLevelEntries = fs.readdirSync(directoryPath, { withFileTypes: true });
  const namedDocsDirectories = topLevelEntries
    .filter((entry) => (
      entry.isDirectory()
      && ["doc", "docs", "documentation"].includes(entry.name.toLowerCase())
    ))
    .map((entry) => path.join(directoryPath, entry.name))
    .filter((candidate) => isDocsDirectory(candidate));

  const topLevelDocFiles = listDocFilesInDirectory(directoryPath)
    .filter((candidate) => path.basename(candidate).toLowerCase() !== "agents.md");
  const docCandidates = uniquePaths([...topLevelDocFiles, ...namedDocsDirectories]);
  const topLevelDirectories = topLevelEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(directoryPath, entry.name));

  const repoCandidates = uniquePaths(listProjectCandidatesInDirectory(directoryPath));
  return {
    docCandidates,
    docsEntries: docCandidates.length === 1 ? [docCandidates[0]] : [],
    repoCandidates,
    topLevelDirectories,
    topLevelDocFiles,
  };
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
    .map((candidate) => findPreferredRepoRootFromPath(candidate))
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
      const roots = [directory, parent];
      if (["doc", "docs", "documentation"].includes(path.basename(directory).toLowerCase())) {
        roots.push(path.dirname(parent));
      }
      return roots;
    }),
  );
  const nearbyCandidates = uniquePaths(
    searchRoots.flatMap((searchRoot) => listProjectCandidatesInDirectory(searchRoot)),
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
    candidates: uniquePaths([...uniquePathCandidates, ...namedCandidates, ...nearbyCandidates]),
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
    docEntries.length ? `已找到开发文档：${docEntries.map((item) => item.replaceAll("\\", "/")).join("，")}` : "",
    ...formatCandidates("候选项目：", candidates),
    "可重新运行 `npx helloloop` 后按提示选择，或显式补充项目路径，例如：",
    "npx helloloop --repo <PROJECT_ROOT>",
  ].filter(Boolean).join("\n");
}

export function renderMissingDocsMessage(repoRoot, candidates = []) {
  return [
    "无法自动确定开发文档位置。",
    `已找到项目仓库：${repoRoot.replaceAll("\\", "/")}`,
    ...formatCandidates("候选开发文档：", candidates),
    "可重新运行 `npx helloloop` 后按提示选择，或显式补充开发文档路径，例如：",
    "npx helloloop --docs <DOCS_PATH>",
  ].join("\n");
}

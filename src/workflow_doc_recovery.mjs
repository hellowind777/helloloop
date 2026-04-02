import path from "node:path";

import { expandDocumentEntries, readDocumentPackets } from "./doc_loader.mjs";
import {
  isDocsDirectory,
  listDocFilesInDirectory,
  normalizeForRepo,
  uniquePaths,
} from "./discovery_paths.mjs";

function isUsableDocPath(relativePath) {
  return path.basename(String(relativePath || "")).toLowerCase() !== "agents.md";
}

function normalizeExpandedEntries(repoRoot, entries) {
  return uniquePaths(
    expandDocumentEntries(repoRoot, entries)
      .map((item) => item.relativePath)
      .filter(isUsableDocPath),
  );
}

function resolveRepoDocCandidates(repoRoot) {
  const docDirectories = uniquePaths([
    path.join(repoRoot, "docs"),
    path.join(repoRoot, "Docs"),
    path.join(repoRoot, "doc"),
    path.join(repoRoot, "Doc"),
    path.join(repoRoot, "documentation"),
    path.join(repoRoot, "Documentation"),
  ].filter((candidate) => isDocsDirectory(candidate)))
    .map((candidate) => normalizeForRepo(repoRoot, candidate));

  if (docDirectories.length) {
    return docDirectories;
  }

  return listDocFilesInDirectory(repoRoot)
    .filter((candidate) => path.basename(candidate).toLowerCase() !== "agents.md")
    .map((candidate) => normalizeForRepo(repoRoot, candidate));
}

export function resolveWorkflowDocEntries(repoRoot, requiredDocs = []) {
  const configuredEntries = normalizeExpandedEntries(repoRoot, requiredDocs);
  if (configuredEntries.length) {
    return configuredEntries;
  }

  return normalizeExpandedEntries(repoRoot, resolveRepoDocCandidates(repoRoot));
}

export function readWorkflowDocPackets(repoRoot, requiredDocs = [], options = {}) {
  const entries = resolveWorkflowDocEntries(repoRoot, requiredDocs);
  return {
    entries,
    packets: entries.length ? readDocumentPackets(repoRoot, entries, options) : [],
  };
}

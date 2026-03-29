import fs from "node:fs";
import path from "node:path";

import { fileExists } from "./common.mjs";

const DOC_FILE_SUFFIX = new Set([
  ".md",
  ".markdown",
  ".mdx",
  ".txt",
  ".rst",
  ".adoc",
]);

const DOC_DIR_NAMES = new Set([
  "docs",
  "doc",
  "documentation",
]);

const PROJECT_MARKERS = [
  ".git",
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "composer.json",
];

const PROJECT_DIR_MARKERS = [
  "src",
  "app",
  "apps",
  "packages",
  "tests",
];

const IGNORED_PROJECT_SEGMENTS = new Set([
  ".cache",
  ".git",
  ".next",
  ".nuxt",
  ".pnpm",
  ".turbo",
  ".venv",
  ".yarn",
  "__pycache__",
  "build",
  "cache",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "temp",
  "tmp",
  "vendor",
  "venv",
]);

function listImmediateDirectories(directoryPath) {
  if (!pathExists(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    return [];
  }

  return fs.readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(directoryPath, entry.name));
}

function hasProjectMarker(directoryPath) {
  return PROJECT_MARKERS.some((name) => pathExists(path.join(directoryPath, name)));
}

function looksLikeStrongProjectRoot(directoryPath) {
  return pathExists(directoryPath)
    && fs.statSync(directoryPath).isDirectory()
    && hasProjectMarker(directoryPath);
}

export function listDocFilesInDirectory(directoryPath) {
  if (!pathExists(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    return [];
  }

  return fs.readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => (
      entry.isFile() && DOC_FILE_SUFFIX.has(path.extname(entry.name).toLowerCase())
    ))
    .map((entry) => path.join(directoryPath, entry.name));
}

function directoryContainsDocs(directoryPath) {
  return listDocFilesInDirectory(directoryPath).length > 0;
}

function hasIgnoredProjectBasename(targetPath) {
  return IGNORED_PROJECT_SEGMENTS.has(path.basename(targetPath).toLowerCase());
}

function choosePreferredCandidate(candidates, directory) {
  return candidates.find((candidate) => {
    const relativeToLeaf = path.relative(candidate, directory);
    return relativeToLeaf
      .split(/[\\/]+/)
      .filter(Boolean)
      .some((segment) => IGNORED_PROJECT_SEGMENTS.has(segment.toLowerCase()));
  })
    || candidates.find((candidate) => !hasIgnoredProjectBasename(candidate))
    || candidates[0]
    || "";
}

function walkUpDirectories(startPath) {
  const directories = [];
  let current = fs.statSync(startPath).isDirectory()
    ? startPath
    : path.dirname(startPath);

  while (true) {
    directories.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return directories;
}

export function resolveAbsolute(rawPath, cwd) {
  return path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(cwd, rawPath);
}

export function pathExists(targetPath) {
  return fileExists(targetPath);
}

export function isDocFile(targetPath) {
  return pathExists(targetPath)
    && fs.statSync(targetPath).isFile()
    && DOC_FILE_SUFFIX.has(path.extname(targetPath).toLowerCase());
}

export function looksLikeProjectRoot(directoryPath) {
  if (!pathExists(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    return false;
  }

  if (hasProjectMarker(directoryPath)) {
    return true;
  }

  return PROJECT_DIR_MARKERS.some((name) => pathExists(path.join(directoryPath, name)));
}

export function listProjectCandidatesInDirectory(searchRoot) {
  return listImmediateDirectories(searchRoot)
    .filter((directoryPath) => (
      looksLikeProjectRoot(directoryPath) && !hasIgnoredProjectBasename(directoryPath)
    ));
}

export function looksLikeWorkspaceDirectory(directoryPath) {
  if (!pathExists(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    return false;
  }

  const repoCandidates = listProjectCandidatesInDirectory(directoryPath);
  if (!repoCandidates.length) {
    return false;
  }

  const hasLooseDocs = directoryContainsDocs(directoryPath)
    || listImmediateDirectories(directoryPath)
      .some((childPath) => DOC_DIR_NAMES.has(path.basename(childPath).toLowerCase()));

  return repoCandidates.length > 1 || hasLooseDocs;
}

export function isDocsDirectory(directoryPath) {
  if (!pathExists(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    return false;
  }

  const baseName = path.basename(directoryPath).toLowerCase();
  if (DOC_DIR_NAMES.has(baseName)) {
    return true;
  }

  if (looksLikeWorkspaceDirectory(directoryPath)) {
    return false;
  }

  return directoryContainsDocs(directoryPath) && !looksLikeProjectRoot(directoryPath);
}

export function findRepoRootFromPath(startPath) {
  if (!pathExists(startPath)) {
    return "";
  }

  for (const directory of walkUpDirectories(startPath)) {
    if (pathExists(path.join(directory, ".git"))) {
      return directory;
    }
  }

  if (fs.statSync(startPath).isDirectory() && looksLikeProjectRoot(startPath)) {
    return startPath;
  }

  return "";
}

export function findPreferredRepoRootFromPath(startPath) {
  if (!pathExists(startPath)) {
    return "";
  }

  const directory = fs.statSync(startPath).isDirectory()
    ? startPath
    : path.dirname(startPath);
  const strongCandidates = [];
  const weakCandidates = [];

  for (const current of walkUpDirectories(directory)) {
    if (pathExists(path.join(current, ".git"))) {
      return current;
    }

    if (looksLikeStrongProjectRoot(current)) {
      strongCandidates.push(current);
      continue;
    }

    if (looksLikeProjectRoot(current)) {
      weakCandidates.push(current);
    }
  }

  if (strongCandidates.length) {
    return choosePreferredCandidate(strongCandidates, directory);
  }

  return choosePreferredCandidate(weakCandidates, directory);
}

export function normalizeForRepo(repoRoot, targetPath) {
  const relative = path.relative(repoRoot, targetPath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.replaceAll("\\", "/");
  }

  return targetPath.replaceAll("\\", "/");
}

export function uniquePaths(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = path.resolve(item).toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function classifyExplicitPath(inputPath) {
  if (!inputPath) {
    return { kind: "", absolutePath: "" };
  }

  if (!pathExists(inputPath)) {
    return { kind: "missing", absolutePath: inputPath };
  }

  if (isDocFile(inputPath) || isDocsDirectory(inputPath)) {
    return { kind: "docs", absolutePath: inputPath };
  }

  if (fs.statSync(inputPath).isDirectory()) {
    const repoRoot = findRepoRootFromPath(inputPath);
    if (repoRoot) {
      return { kind: "repo", absolutePath: repoRoot };
    }

    if (looksLikeWorkspaceDirectory(inputPath)) {
      return { kind: "workspace", absolutePath: inputPath };
    }

    return { kind: "directory", absolutePath: inputPath };
  }

  return { kind: "unsupported", absolutePath: inputPath };
}

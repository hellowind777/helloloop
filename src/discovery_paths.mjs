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

function directoryContainsDocs(directoryPath) {
  if (!pathExists(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    return false;
  }

  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  return entries.some((entry) => (
    entry.isFile() && DOC_FILE_SUFFIX.has(path.extname(entry.name).toLowerCase())
  ));
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

  if (PROJECT_MARKERS.some((name) => pathExists(path.join(directoryPath, name)))) {
    return true;
  }

  return PROJECT_DIR_MARKERS.some((name) => pathExists(path.join(directoryPath, name)));
}

export function isDocsDirectory(directoryPath) {
  if (!pathExists(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    return false;
  }

  const baseName = path.basename(directoryPath).toLowerCase();
  if (DOC_DIR_NAMES.has(baseName)) {
    return true;
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
    return { kind: "repo", absolutePath: inputPath };
  }

  return { kind: "unsupported", absolutePath: inputPath };
}

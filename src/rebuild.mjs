import fs from "node:fs";
import path from "node:path";

import { ensureDir, nowIso, writeJson } from "./common.mjs";

const PROTECTED_TOP_LEVEL = new Set([
  ".git",
  ".gitignore",
  ".gitattributes",
  ".helloagents",
  ".helloloop",
]);

function ensureSafeRepoRoot(repoRoot) {
  const absoluteRepoRoot = path.resolve(repoRoot);
  const parsed = path.parse(absoluteRepoRoot);
  if (absoluteRepoRoot === parsed.root) {
    throw new Error(`拒绝清理根目录：${absoluteRepoRoot}`);
  }
  if (!fs.existsSync(absoluteRepoRoot) || !fs.statSync(absoluteRepoRoot).isDirectory()) {
    throw new Error(`项目目录不存在或不是目录：${absoluteRepoRoot}`);
  }
}

function collectDocsInsideRepo(repoRoot, discovery) {
  const resolvedDocs = Array.isArray(discovery?.resolvedDocs) ? discovery.resolvedDocs : [];
  return resolvedDocs
    .map((item) => ({
      absolutePath: path.resolve(item.absolutePath),
      relativePath: String(item.relativePath || "").replaceAll("\\", "/"),
    }))
    .filter((item) => {
      const relative = path.relative(repoRoot, item.absolutePath);
      return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
    });
}

function stagePreservedDocs(configRoot, docs) {
  const stageRoot = path.join(configRoot, "rebuild-staging", nowIso().replaceAll(":", "-").replaceAll(".", "-"));
  for (const doc of docs) {
    const stagedTarget = path.join(stageRoot, doc.relativePath);
    ensureDir(path.dirname(stagedTarget));
    fs.copyFileSync(doc.absolutePath, stagedTarget);
  }
  return stageRoot;
}

function removeUnprotectedTopLevel(repoRoot) {
  const removedEntries = [];
  for (const entry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
    if (PROTECTED_TOP_LEVEL.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(repoRoot, entry.name);
    fs.rmSync(entryPath, { recursive: true, force: true });
    removedEntries.push(entry.name);
  }
  return removedEntries;
}

function restoreDocsFromStage(repoRoot, stageRoot, docs) {
  for (const doc of docs) {
    const stagedSource = path.join(stageRoot, doc.relativePath);
    const targetPath = path.join(repoRoot, doc.relativePath);
    ensureDir(path.dirname(targetPath));
    fs.copyFileSync(stagedSource, targetPath);
  }
}

function resetLoopRuntime(context) {
  for (const target of [
    context.backlogFile,
    context.projectFile,
    context.statusFile,
    context.stateFile,
  ]) {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }

  if (fs.existsSync(context.runsDir)) {
    fs.rmSync(context.runsDir, { recursive: true, force: true });
  }
}

export function resetRepoForRebuild(context, discovery) {
  ensureSafeRepoRoot(context.repoRoot);

  const preservedDocs = collectDocsInsideRepo(context.repoRoot, discovery);
  const stageRoot = preservedDocs.length
    ? stagePreservedDocs(context.configRoot, preservedDocs)
    : "";

  const manifestFile = path.join(context.configRoot, "rebuild-manifest.json");
  const removedEntries = removeUnprotectedTopLevel(context.repoRoot);
  resetLoopRuntime(context);

  if (stageRoot) {
    restoreDocsFromStage(context.repoRoot, stageRoot, preservedDocs);
  }

  writeJson(manifestFile, {
    updatedAt: nowIso(),
    repoRoot: context.repoRoot,
    removedEntries,
    preservedDocs: preservedDocs.map((item) => item.relativePath),
  });

  return {
    removedEntries,
    preservedDocs: preservedDocs.map((item) => item.relativePath),
    manifestFile,
  };
}

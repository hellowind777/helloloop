import fs from "node:fs";
import path from "node:path";

import {
  listDocFilesInDirectory,
  listProjectCandidatesInDirectory,
  pathExists,
  resolveAbsolute,
} from "./discovery_paths.mjs";
import { createPromptSession } from "./prompt_session.mjs";

function toDisplayPath(targetPath) {
  return String(targetPath || "").replaceAll("\\", "/");
}

export function createDiscoveryPromptSession() {
  return createPromptSession();
}

function summarizeList(items, options = {}) {
  const limit = Number(options.limit || 12);
  if (!items.length) {
    return ["- 无"];
  }

  const visible = items.slice(0, limit);
  const lines = visible.map((item) => `- ${item}`);
  if (items.length > limit) {
    lines.push(`- 其余 ${items.length - limit} 项未展开`);
  }
  return lines;
}

function collectDirectoryOverview(rootPath) {
  if (!pathExists(rootPath) || !fs.statSync(rootPath).isDirectory()) {
    return {
      rootPath,
      directories: [],
      docFiles: [],
      repoCandidates: [],
    };
  }

  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  return {
    rootPath,
    directories: entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, "zh-CN")),
    docFiles: listDocFilesInDirectory(rootPath)
      .map((filePath) => path.basename(filePath))
      .sort((left, right) => left.localeCompare(right, "zh-CN")),
    repoCandidates: listProjectCandidatesInDirectory(rootPath)
      .map((directoryPath) => path.basename(directoryPath))
      .sort((left, right) => left.localeCompare(right, "zh-CN")),
  };
}

function renderDirectoryOverview(title, overview) {
  return [
    title,
    `扫描目录：${toDisplayPath(overview.rootPath)}`,
    "",
    "顶层文档文件：",
    ...summarizeList(overview.docFiles),
    "",
    "顶层目录：",
    ...summarizeList(overview.directories),
    "",
    "疑似项目目录：",
    ...summarizeList(overview.repoCandidates),
  ].join("\n");
}

function renderExistingChoices(title, candidates) {
  return [
    title,
    ...candidates.map((item, index) => `${index + 1}. ${toDisplayPath(item)}`),
    "",
    "请输入编号；也可以直接输入本地路径；直接回车取消。",
  ].join("\n");
}

async function promptForExistingPathSelection(readline, title, candidates, cwd, preface = "") {
  if (preface) {
    console.log(preface);
    console.log("");
  }
  console.log(renderExistingChoices(title, candidates));
  while (true) {
    const answer = String(await readline.question("> ") || "").trim();
    if (!answer) {
      return "";
    }

    const choiceIndex = Number(answer);
    if (Number.isInteger(choiceIndex) && choiceIndex >= 1 && choiceIndex <= candidates.length) {
      return candidates[choiceIndex - 1];
    }

    const maybePath = resolveAbsolute(answer, cwd);
    if (pathExists(maybePath)) {
      return maybePath;
    }

    console.log("输入无效，请输入候选编号或一个存在的本地路径。");
  }
}

async function promptForDocsPath(readline, discovery, cwd) {
  const docChoices = Array.isArray(discovery.docCandidates) ? discovery.docCandidates : [];
  const scanRoot = discovery.workspaceRoot || discovery.repoRoot || cwd;
  const overview = collectDirectoryOverview(scanRoot);
  const title = docChoices.length
    ? "请选择开发文档来源："
    : "未自动识别到明确的开发文档。请输入开发文档目录或文件路径：";
  const preface = renderDirectoryOverview("当前目录顶层概览", overview);

  if (docChoices.length) {
    return promptForExistingPathSelection(readline, title, docChoices, cwd, preface);
  }

  console.log(preface);
  console.log("");
  console.log(title);
  console.log("可直接输入当前目录下的相对路径或绝对路径；直接回车取消。");
  while (true) {
    const answer = String(await readline.question("> ") || "").trim();
    if (!answer) {
      return "";
    }

    const maybePath = resolveAbsolute(answer, cwd);
    if (pathExists(maybePath)) {
      return maybePath;
    }

    console.log("路径不存在，请输入一个已存在的开发文档目录或文件路径。");
  }
}

async function promptForRepoPath(readline, discovery, cwd) {
  const repoChoices = Array.isArray(discovery.repoCandidates) ? discovery.repoCandidates : [];
  const scanRoot = discovery.workspaceRoot
    || (Array.isArray(discovery.docsEntries) && discovery.docsEntries.length
      ? path.dirname(discovery.docsEntries[0])
      : "")
    || cwd;
  const overview = collectDirectoryOverview(scanRoot);
  const preface = renderDirectoryOverview("当前目录顶层概览", overview);
  const title = repoChoices.length
    ? "请选择目标项目仓库："
    : "请输入要开发的项目路径：";
  console.log(preface);
  console.log("");
  if (repoChoices.length) {
    console.log(renderExistingChoices(title, repoChoices));
    console.log("也可以直接输入项目路径；如果这是新项目，可输入准备创建的新目录路径。");
  } else {
    console.log(title);
    console.log("如果这是新项目，可直接输入准备创建的新目录路径；直接回车取消。");
  }

  while (true) {
    const answer = String(await readline.question("> ") || "").trim();
    if (!answer) {
      return { repoRoot: "", allowNewRepoRoot: false };
    }

    const choiceIndex = Number(answer);
    if (repoChoices.length && Number.isInteger(choiceIndex) && choiceIndex >= 1 && choiceIndex <= repoChoices.length) {
      return {
        repoRoot: repoChoices[choiceIndex - 1],
        allowNewRepoRoot: false,
      };
    }

    const maybePath = resolveAbsolute(answer, cwd);
    if (pathExists(maybePath) && !fs.statSync(maybePath).isDirectory()) {
      console.log("项目路径必须是目录，不能是文件。");
      continue;
    }

    return {
      repoRoot: maybePath,
      allowNewRepoRoot: !pathExists(maybePath),
    };
  }
}

export async function resolveDiscoveryFailureInteractively(
  failure,
  options = {},
  cwd = process.cwd(),
  allowPrompt = true,
  sharedPromptSession = null,
) {
  const discovery = failure?.discovery || {};
  const nextOptions = {
    ...options,
    selectionSources: {
      ...(options.selectionSources || {}),
    },
  };
  let changed = false;
  const promptSession = sharedPromptSession || (allowPrompt ? createDiscoveryPromptSession() : null);
  const ownsPromptSession = Boolean(promptSession) && !sharedPromptSession;

  try {
    if (!nextOptions.docsPath) {
      const docChoices = Array.isArray(discovery.docCandidates) ? discovery.docCandidates : [];
      if (Array.isArray(discovery.docsEntries) && discovery.docsEntries.length === 1) {
        nextOptions.docsPath = discovery.docsEntries[0];
        nextOptions.selectionSources.docs = "workspace_single_doc";
        changed = true;
      } else if (docChoices.length === 1) {
        nextOptions.docsPath = docChoices[0];
        nextOptions.selectionSources.docs = "workspace_single_doc";
        changed = true;
      } else if (failure?.code === "missing_docs" || docChoices.length > 1 || discovery.workspaceRoot) {
        if (!allowPrompt) {
          return null;
        }
        const selectedDocs = await promptForDocsPath(promptSession, discovery, cwd);
        if (!selectedDocs) {
          return null;
        }
        nextOptions.docsPath = selectedDocs;
        nextOptions.selectionSources.docs = "interactive";
        changed = true;
        console.log(`已选择开发文档：${toDisplayPath(selectedDocs)}`);
        console.log("");
      }
    }

    const repoChoices = Array.isArray(discovery.repoCandidates) ? discovery.repoCandidates : [];
    if (!nextOptions.repoRoot && repoChoices.length) {
      if (repoChoices.length === 1) {
        nextOptions.repoRoot = repoChoices[0];
        nextOptions.selectionSources.repo = "workspace_single_repo";
        changed = true;
      }
    }

    if (!nextOptions.repoRoot && failure?.code === "missing_repo") {
      if (!allowPrompt) {
        return null;
      }
      const selectedRepo = await promptForRepoPath(promptSession, discovery, cwd);
      if (!selectedRepo.repoRoot) {
        return null;
      }
      nextOptions.repoRoot = selectedRepo.repoRoot;
      nextOptions.allowNewRepoRoot = selectedRepo.allowNewRepoRoot;
      nextOptions.selectionSources.repo = selectedRepo.allowNewRepoRoot
        ? "interactive_new_repo"
        : "interactive";
      changed = true;
      if (selectedRepo.allowNewRepoRoot) {
        console.log(`已指定项目路径（当前不存在，将按新项目创建）：${toDisplayPath(selectedRepo.repoRoot)}`);
      } else {
        console.log(`已选择项目仓库：${toDisplayPath(selectedRepo.repoRoot)}`);
      }
      console.log("");
    }
    return changed ? nextOptions : null;
  } finally {
    if (ownsPromptSession) {
      promptSession?.close();
    }
  }
}

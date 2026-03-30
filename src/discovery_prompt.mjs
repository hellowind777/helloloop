import fs from "node:fs";
import path from "node:path";

import { pathExists, resolveAbsolute } from "./discovery_paths.mjs";
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

function renderExistingChoices(title, candidates, footer = "请输入编号；也可以直接输入本地路径；直接回车取消。") {
  return [
    title,
    ...candidates.map((item, index) => `${index + 1}. ${toDisplayPath(item)}`),
    "",
    footer,
  ].join("\n");
}

async function promptForExistingPathSelection(readline, title, candidates, cwd, options = {}) {
  if (options.preface) {
    console.log(options.preface);
    console.log("");
  }
  console.log(renderExistingChoices(title, candidates, options.footer));
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

    console.log(options.invalidMessage || "输入无效，请输入候选编号或一个存在的本地路径。");
  }
}

function createCommonDocsPathHints(repoRoot) {
  return [
    "./docs",
    "./doc",
    "./documentation",
    "./README.md",
    "./PRD.md",
    "./requirements.md",
    "./spec.md",
    "./design.md",
    "./plan.md",
    "./roadmap.md",
  ].map((entry) => {
    if (!repoRoot) {
      return entry;
    }
    return toDisplayPath(path.join(repoRoot, entry.replace(/^\.\//, "")));
  });
}

function renderDocsPromptPreface(discovery, cwd) {
  const repoRoot = discovery.repoRoot || "";
  const lines = [];

  if (repoRoot) {
    lines.push("未找到开发文档。");
    lines.push(`项目目录：${toDisplayPath(repoRoot)}`);
    return lines.join("\n");
  }

  if (discovery.workspaceRoot) {
    lines.push("当前目录更像工作区，暂时不直接作为项目目录。");
    lines.push(`当前目录：${toDisplayPath(discovery.workspaceRoot)}`);
    if (Array.isArray(discovery.repoCandidates) && discovery.repoCandidates.length) {
      lines.push(`候选项目目录：${discovery.repoCandidates.length} 个，稍后再确认。`);
    }
    return lines.join("\n");
  }

  lines.push("未找到开发文档。");
  lines.push(`当前目录：${toDisplayPath(cwd)}`);
  return lines.join("\n");
}

function renderRepoPromptPreface(discovery, cwd) {
  const lines = [];
  if (discovery.workspaceRoot) {
    lines.push("当前目录更像工作区，不能直接作为项目目录。");
    lines.push(`当前目录：${toDisplayPath(discovery.workspaceRoot)}`);
  } else {
    lines.push("还需要确认项目目录。");
    lines.push(`当前目录：${toDisplayPath(cwd)}`);
  }

  if (Array.isArray(discovery.docsEntries) && discovery.docsEntries.length) {
    lines.push(`开发文档：${discovery.docsEntries.map((item) => toDisplayPath(item)).join("，")}`);
  }
  return lines.join("\n");
}

async function promptForDocsPath(readline, discovery, cwd) {
  const docChoices = Array.isArray(discovery.docCandidates) ? discovery.docCandidates : [];
  const repoRoot = discovery.repoRoot || "";
  const preface = renderDocsPromptPreface(discovery, cwd);

  if (docChoices.length) {
    return promptForExistingPathSelection(readline, "请选择开发文档：", docChoices, cwd, {
      preface,
      footer: "请输入编号；也可以直接输入已存在的本地路径；直接回车取消。",
      invalidMessage: "输入无效，请输入候选编号或一个已存在的开发文档路径。",
    });
  }

  console.log(preface);
  console.log("");
  if (repoRoot) {
    console.log("已检查这些常见位置：");
    console.log(summarizeList(createCommonDocsPathHints(repoRoot)).join("\n"));
    console.log("");
  }
  console.log("请输入开发文档路径（文件或目录）：");
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
  const preface = renderRepoPromptPreface(discovery, cwd);
  const title = repoChoices.length
    ? "请选择要开发的项目目录："
    : "请输入要开发的项目目录：";

  console.log(preface);
  console.log("");
  if (repoChoices.length) {
    console.log(renderExistingChoices(
      title,
      repoChoices,
      "请输入编号；也可以直接输入项目路径；如果这是新项目，可输入准备创建的新目录路径；直接回车取消。",
    ));
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
        console.log(`已指定项目目录（当前不存在，将按新项目创建）：${toDisplayPath(selectedRepo.repoRoot)}`);
      } else {
        console.log(`已选择项目目录：${toDisplayPath(selectedRepo.repoRoot)}`);
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

import { DOCS_PATH_PLACEHOLDER, REPO_ROOT_PLACEHOLDER } from "./cli_args.mjs";

function renderFollowupExamples() {
  return [
    "下一步示例：",
    "npx helloloop",
    "npx helloloop <PATH>",
    "npx helloloop codex",
    "npx helloloop claude <PATH>",
    "npx helloloop gemini <PATH> 继续完成后续开发",
    "npx helloloop --dry-run",
    "npx helloloop install --host all",
    "npx helloloop uninstall --host all",
    "npx helloloop next",
    `如需显式补充路径：npx helloloop --repo ${REPO_ROOT_PLACEHOLDER} --docs ${DOCS_PATH_PLACEHOLDER}`,
  ].join("\n");
}

export function renderInstallSummary(result) {
  const lines = ["HelloLoop 已安装到以下宿主："];

  for (const item of result.installedHosts) {
    lines.push(`- ${item.displayName}：${item.targetRoot}`);
    if (item.marketplaceFile) {
      lines.push(`  marketplace：${item.marketplaceFile}`);
    }
    if (item.settingsFile) {
      lines.push(`  settings：${item.settingsFile}`);
    }
  }

  lines.push("");
  lines.push("使用入口：");
  lines.push("- Codex：`$helloloop` / `npx helloloop`");
  lines.push("- Claude：`/helloloop`");
  lines.push("- Gemini：`/helloloop`");
  lines.push("");
  lines.push(renderFollowupExamples());
  return lines.join("\n");
}

export function renderUninstallSummary(result) {
  const lines = ["HelloLoop 已从以下宿主卸载："];

  for (const item of result.uninstalledHosts) {
    lines.push(`- ${item.displayName}：${item.removed ? "已清理" : "未发现现有安装"}`);
    lines.push(`  目标目录：${item.targetRoot}`);
    if (item.marketplaceFile) {
      lines.push(`  marketplace：${item.marketplaceFile}`);
    }
    if (item.settingsFile) {
      lines.push(`  settings：${item.settingsFile}`);
    }
  }

  lines.push("");
  lines.push("如需重新安装：");
  lines.push("- `npx helloloop install --host codex`");
  lines.push("- `npx helloloop install --host all`");
  return lines.join("\n");
}

export function renderRebuildSummary(resetSummary) {
  return [
    "已按确认结果清理当前项目，并准备按开发文档重新开始。",
    `- 已清理顶层条目：${resetSummary.removedEntries.length ? resetSummary.removedEntries.join("，") : "无"}`,
    `- 已保留开发文档：${resetSummary.preservedDocs.length ? resetSummary.preservedDocs.join("，") : "无"}`,
    `- 重建记录：${resetSummary.manifestFile.replaceAll("\\", "/")}`,
  ].join("\n");
}

import fs from "node:fs";
import { createInterface } from "node:readline/promises";

import { getEngineDisplayName } from "./engine_metadata.mjs";
import { rankEngines } from "./engine_selection_probe.mjs";

function createPromptSession() {
  if (process.stdin.isTTY) {
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return {
      async question(promptText) {
        return readline.question(promptText);
      },
      close() {
        readline.close();
      },
    };
  }

  const bufferedAnswers = fs.readFileSync(0, "utf8").split(/\r?\n/);
  let answerIndex = 0;
  return {
    async question(promptText) {
      process.stdout.write(promptText);
      const answer = bufferedAnswers[answerIndex] ?? "";
      answerIndex += 1;
      return answer;
    },
    close() {},
  };
}

function parseAffirmative(answer) {
  const raw = String(answer || "").trim();
  const normalized = raw.toLowerCase();
  return ["y", "yes", "ok", "确认", "是", "继续", "好的"].includes(normalized)
    || ["确认", "是", "继续", "好的"].includes(raw);
}

export async function confirmCrossHostSwitch(hostContext, engine, buildMessage) {
  const promptSession = createPromptSession();
  try {
    const answer = await promptSession.question(
      `${buildMessage(hostContext, engine)}\n请输入 y / yes / 确认 继续，其它任意输入取消：`,
    );
    return parseAffirmative(answer);
  } finally {
    promptSession.close();
  }
}

export async function promptSelectEngine(availableEngines, options = {}) {
  const promptSession = createPromptSession();
  const ranked = rankEngines(availableEngines, options.hostContext);
  const choiceLines = ranked.map((engine, index) => {
    const suffix = engine === options.recommendedEngine ? "（推荐）" : "";
    return `${index + 1}. ${getEngineDisplayName(engine)}${suffix}`;
  });

  try {
    const answer = await promptSession.question([
      options.message || "请选择本次要使用的执行引擎：",
      ...choiceLines,
      "",
      "请输入编号；直接回车取消。",
      "> ",
    ].join("\n"));
    const choiceIndex = Number(String(answer || "").trim());
    if (!Number.isInteger(choiceIndex) || choiceIndex < 1 || choiceIndex > ranked.length) {
      return "";
    }
    return ranked[choiceIndex - 1];
  } finally {
    promptSession.close();
  }
}

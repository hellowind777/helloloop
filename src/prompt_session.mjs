import fs from "node:fs";
import { createInterface } from "node:readline/promises";

let bufferedAnswers = null;
let bufferedAnswerIndex = 0;

function loadBufferedAnswers() {
  if (!bufferedAnswers) {
    bufferedAnswers = fs.readFileSync(0, "utf8").split(/\r?\n/);
  }
  return bufferedAnswers;
}

export function createPromptSession() {
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

  return {
    async question(promptText) {
      process.stdout.write(promptText);
      const answers = loadBufferedAnswers();
      const answer = answers[bufferedAnswerIndex] ?? "";
      bufferedAnswerIndex += 1;
      return answer;
    },
    close() {},
  };
}

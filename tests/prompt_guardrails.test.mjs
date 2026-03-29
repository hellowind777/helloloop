import test from "node:test";
import assert from "node:assert/strict";

import { buildAnalysisPrompt } from "../src/analyze_prompt.mjs";
import { buildTaskPrompt } from "../src/prompt.mjs";

function sampleTask() {
  return {
    id: "task-1",
    title: "补齐主流程",
    priority: "P1",
    risk: "low",
    goal: "按开发文档补齐主流程实现。",
    docs: ["docs/plan.md"],
    paths: ["src/"],
    acceptance: ["主流程可运行", "验证命令通过"],
  };
}

test("任务 prompt 在缺少项目约束时注入内建安全底线与默认工程约束", () => {
  const prompt = buildTaskPrompt({
    task: sampleTask(),
    repoStateText: "已有基础骨架。",
    verifyCommands: ["npm test"],
  });

  assert.match(prompt, /## 内建安全底线/);
  assert.match(prompt, /Windows 环境禁止使用 cmd/);
  assert.match(prompt, /## 默认工程约束（文档未明确时生效）/);
  assert.match(prompt, /代码是事实源/);
  assert.match(prompt, /不允许静默失败/);
});

test("任务 prompt 在存在项目约束时保留自定义约束并继续附带安全底线", () => {
  const prompt = buildTaskPrompt({
    task: sampleTask(),
    verifyCommands: ["npm test"],
    constraints: ["必须沿用现有模块边界。"],
  });

  assert.match(prompt, /## 内建安全底线/);
  assert.match(prompt, /## 项目\/用户约束/);
  assert.match(prompt, /必须沿用现有模块边界/);
});

test("分析 prompt 会附带安全底线并限制 constraints 只写项目特有约束", () => {
  const prompt = buildAnalysisPrompt({
    repoRoot: "/repo",
    docsEntries: ["docs"],
    docPackets: [
      {
        path: "docs/plan.md",
        content: "# 计划",
        truncated: false,
      },
    ],
    existingProjectConstraints: [],
  });

  assert.match(prompt, /## 内建安全底线/);
  assert.match(prompt, /Windows 环境禁止使用 cmd/);
  assert.match(prompt, /## 默认工程约束（文档未明确时也必须遵守）/);
  assert.match(prompt, /`constraints` 只写从项目文档或现有项目配置中提炼出的项目特有约束/);
});

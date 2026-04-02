import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { analyzeExecution, unresolvedDependencies } from "../src/backlog.mjs";
import {
  backfillWorkflowArtifacts,
  buildWorkflowBlueprint,
  inferDocumentAnalysis,
} from "../src/workflow_model.mjs";

test("文档画像会根据路径和内容推断 SDLC 角色", () => {
  const docAnalysis = inferDocumentAnalysis("D:/GitHub/dev/helloloop", [
    {
      path: "docs/architecture/01-套件需求总纲.md",
      content: "# HelloMind 套件需求总纲\n\n## 需求\n- 用户故事\n- 验收标准",
    },
    {
      path: "docs/architecture/42-平台端任务拆解.md",
      content: "# 平台端任务拆解\n\n- 待办\n- 工作包",
    },
    {
      path: "docs/architecture/05-套件架构视图.md",
      content: "# 套件架构视图\n\n## 系统上下文视图",
    },
  ]);

  assert.equal(docAnalysis.entries[0].docType, "requirements");
  assert.equal(docAnalysis.entries[0].role, "product_owner");
  assert.equal(docAnalysis.entries[1].docType, "task_breakdown");
  assert.equal(docAnalysis.entries[2].stage, "architecture");
  assert.match(docAnalysis.summary, /需求文档/);
});

test("工作流蓝图会按仓库画像给出主线和 lane", () => {
  const docAnalysis = inferDocumentAnalysis("D:/GitHub/dev/helloloop", [
    {
      path: "README.md",
      content: "# HelloLoop\n\n## Overview",
    },
  ]);
  const workflow = buildWorkflowBlueprint({
    repoRoot: "D:/GitHub/dev/helloloop",
    docAnalysis,
    planner: {
      maxParallelLanes: 4,
    },
  });

  assert.equal(workflow.methodology, "hierarchical_role_based_agile_multi_agent_sdlc");
  assert.equal(workflow.profile, "orchestration_plugin");
  assert.equal(workflow.parallelLanes.includes("dashboard"), true);
  assert.equal(workflow.phaseOrder.includes("implementation"), true);
});

test("调度器会优先选择同 lane 的更早阶段任务，并让后续阶段携带隐式门禁", () => {
  const backlog = {
    tasks: [
      {
        id: "architecture-a",
        title: "先补架构方案",
        status: "pending",
        priority: "P1",
        stage: "architecture",
        role: "architect",
        lane: "runtime",
      },
      {
        id: "implementation-a",
        title: "再落 runtime 实现",
        status: "pending",
        priority: "P1",
        stage: "implementation",
        role: "developer",
        lane: "runtime",
      },
    ],
  };
  const result = analyzeExecution(backlog);

  assert.equal(result.state, "ready");
  assert.equal(result.task.id, "architecture-a");
  assert.equal(unresolvedDependencies(backlog, backlog.tasks[1]).includes("architecture-a"), true);
});

test("调度器会把外部仓库阻塞识别为等待外部依赖", () => {
  const result = analyzeExecution({
    tasks: [
      {
        id: "contract-consumer",
        title: "等待协议仓产物后接入消费端",
        status: "pending",
        priority: "P1",
        stage: "implementation",
        role: "developer",
        lane: "runtime",
        blockedBy: [
          {
            type: "repo",
            id: "hellomind-protocols",
            label: "hellomind-protocols 生成物",
            status: "open",
          },
        ],
      },
    ],
  });

  assert.equal(result.state, "blocked_external");
  assert.equal(result.blockedTask.id, "contract-consumer");
  assert.equal(result.blockingSignals[0].type, "repo");
});

test("工作流回填会在失效 requiredDocs 下回退到仓库 docs 并恢复文档画像", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helloloop-workflow-doc-recovery-"));
  const docsRoot = path.join(repoRoot, "docs");
  fs.mkdirSync(docsRoot, { recursive: true });
  fs.writeFileSync(path.join(docsRoot, "PRD.md"), "# 需求说明\n\n## 需求\n- 用户故事\n- 验收标准\n", "utf8");
  fs.writeFileSync(path.join(docsRoot, "architecture.md"), "# 架构设计\n\n## 系统上下文视图\n", "utf8");

  try {
    const result = backfillWorkflowArtifacts({
      repoRoot,
      workflow: null,
      docAnalysis: null,
      tasks: [],
      requiredDocs: ["C:/Users/HELLOW~1/AppData/Local/Temp/helloloop-new-project-path-sUqseL/plans"],
    });

    assert.equal(result.docAnalysis.entries.length >= 2, true);
    assert.doesNotMatch(result.docAnalysis.summary, /尚未重新分析文档画像/u);
    assert.equal(result.workflow.phaseOrder.includes("product"), true);
    assert.equal(result.workflow.phaseOrder.includes("architecture"), true);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

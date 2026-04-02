import assert from "node:assert/strict";
import test from "node:test";

import { renderApp } from "../apps/hello-app/web/app-render.js";

test("renderApp renders macOS-like app frame and focus panels", () => {
  const root = { innerHTML: "" };
  renderApp(root, {
    locale: "zh-CN",
    theme: "light",
    connected: true,
    error: "",
    currentView: "workspaces",
    selectedSessionId: "session-1",
    settings: {
      locale: "zh-CN",
      theme: "light",
      preferred_host: "codex",
      scheduler_mode: "central_supervisor",
      retry_policy: "balanced",
      notifications_enabled: true,
      tray_launch_on_start: true,
      daemon_auto_start: true,
      refresh_interval_seconds: 5,
    },
    workspaceSelection: {
      repo_root: "D:/GitHub/dev/helloloop",
      docs_path: "docs",
      config_dir_name: ".helloloop",
      preferred_engine: "codex",
    },
    workspace: {
      repoName: "helloloop",
      repoRoot: "D:/GitHub/dev/helloloop",
      configDirName: ".helloloop",
      engine: "codex",
      summary: { total: 8, pending: 3, inProgress: 2, done: 2, failed: 1, blocked: 1 },
      nextTask: { title: "Implement tray shell" },
      automationNextTask: { title: "Refresh workspaces view" },
      workflow: {
        currentFocus: "Continue Hello App implementation",
        profileLabel: "Hierarchical Role-Based Agile Multi-Agent SDLC",
        parallelLanes: ["ui", "daemon"],
        parallelStrategy: "lane_parallel_with_stage_gates",
        phaseOrder: ["product", "implementation", "review"],
        coordinationRules: ["Contracts first", "Review before release"],
        docCoverageSummary: "Docs aligned with app-first shell",
        mainlineSummary: "Coordinate shell, daemon and review surfaces together.",
      },
      docAnalysis: {
        summary: "Design docs describe an app-first command center with desktop shell and tray.",
        gaps: ["Refine release story"],
      },
      tasks: [{
        id: "task-workspace-1",
        title: "Implement tray shell",
        status: "in_progress",
        stage: "implementation",
        role: "developer",
        lane: "daemon",
        priority: "p1",
        depends_on: [],
      }],
      latestStatus: {
        stage: "implementation",
        taskTitle: "Implement tray shell",
        message: "Current workspace is wiring the desktop shell.",
        updatedAt: "2026-04-01T12:02:00.000Z",
      },
      runtime: {
        engineDisplayName: "Codex",
        phase: "implement",
        status: "running",
        updatedAt: "2026-04-01T12:02:00.000Z",
        recoveryCount: 1,
        hardRetryBudget: 5,
        softRetryBudget: 12,
        heartbeat: {
          lastOutputAt: "2026-04-01T12:02:30.000Z",
          idleSeconds: 8,
        },
      },
      supervisor: {
        sessionId: "2026-04-01-12:00:00-000Z",
        status: "running",
        command: "run-loop",
        startedAt: "2026-04-01T12:00:00.000Z",
        keepAliveEnabled: true,
        guardianRestartCount: 0,
      },
      statusModel: {
        label: "执行中",
        reason: "当前任务正在推进",
        currentAction: "Update tray shell",
        todoProgress: "2/3",
        schedulerLabel: "自动推进当前任务",
        activity: {
          label: "Update tray shell",
          updatedAt: "2026-04-01T12:02:20.000Z",
        },
      },
      activity: {
        current: {
          label: "Inspecting tray shell main.rs",
          updatedAt: "2026-04-01T12:02:20.000Z",
        },
        recentReasoning: [{ label: "Evaluating runtime control", updatedAt: "2026-04-01T12:02:10.000Z" }],
        recentCommands: [{ label: "cargo check", updatedAt: "2026-04-01T12:02:15.000Z" }],
      },
    },
    hosts: [{
      display_name: "Codex CLI",
      kind: "codex",
      notes: "background + streaming",
      supports_background: true,
      supports_streaming: true,
      supports_worktree: true,
    }],
    events: [{
      event_type: "command_center",
      created_at: "2026-04-01T12:00:00.000Z",
      payload: { focus_summary: "Continue implementation" },
    }],
    sessionDetail: {
      session: {
        id: "session-1",
        title: "Architect lane",
        state: "failed_recoverable",
        host: "codex",
        role: "architect",
        lane: "ui",
        severity: "high",
        reason_label: "Waiting for shared contract",
        current_action: "Retrying current task",
        current_task: "Update Hello App surface",
        next_task: "Sync app contract",
        auto_action: "System will retry after refresh",
        last_heartbeat_at: "2026-04-01T12:00:00.000Z",
        scheduler: { label: "runtime_retry", reason: "Retry window active", mode: "autonomous", will_auto_resume: true },
        wait: { label: "Waiting retry window", target_label: "2026-04-01T12:03:00.000Z", resumes_automatically: true },
        failure: { label: "HTTP 429", detail: "Too many requests", http_status_label: "HTTP 429 / Rate limited", http_status: 429 },
      },
      related_tasks: [],
      ready_tasks: [],
      running_tasks: [{ title: "Update Hello App surface", state: "running", stage: "implementation", owner_role: "developer", lane: "ui", priority: "p1", depends_on: [] }],
      blocked_tasks: [],
      completed_tasks: [],
      dependency_labels: ["Shared contract"],
      blocker_labels: ["Shared contract"],
      recovery_summary: "Waiting for shared contract",
      next_action_summary: "Refresh now",
      blocker_signature: "sig-1",
      blocker_acknowledged: true,
      blocker_acknowledged_at: "2026-04-01T12:01:00.000Z",
      available_actions: [
        { key: "refresh_now", label: "Refresh now", method: "POST", endpoint: "/api/v1/control/refresh", kind: "primary", implemented: true, reason: "Refresh workspace projection" },
        { key: "resume_session", label: "Resume session", method: "POST", endpoint: "/api/v1/control/sessions/session-1/resume", kind: "secondary", implemented: true, reason: "Resume the session" },
        { key: "retry_current", label: "Retry current", method: "POST", endpoint: "/api/v1/control/sessions/session-1/retry-current", kind: "secondary", implemented: true, reason: "Retry the current task" },
        { key: "rerun_analysis", label: "Rerun analysis", method: "POST", endpoint: "/api/v1/control/sessions/session-1/rerun-analysis", kind: "secondary", implemented: true, reason: "Rerun analysis" },
        { key: "ack_blocker", label: "Acknowledge blocker", method: "POST", endpoint: "/api/v1/control/sessions/session-1/ack-blocker", kind: "secondary", implemented: true, reason: "Acknowledge blocker" },
      ],
    },
    snapshot: {
      workspace_label: "HelloLoop",
      focus_summary: "Continue implementation",
      methodology: "Hierarchical Role-Based Agile Multi-Agent SDLC",
      orchestration_mode: "app-first",
      updated_at: "2026-04-01T12:00:00.000Z",
      sessions: [{
        id: "session-1",
        title: "Architect lane",
        state: "running",
        host: "codex",
        role: "architect",
        reason_label: "Planning the next delivery wave",
        current_action: "Refining delivery shell",
        current_task: "Update Hello App surface",
        last_heartbeat_at: "2026-04-01T12:00:00.000Z",
        scheduler: { label: "adaptive" },
      }],
      tasks: [{
        title: "Ship app shell",
        state: "running",
        stage: "implementation",
        owner_role: "developer",
      }],
    },
  });

  assert.match(root.innerHTML, /class="app-frame"/u);
  assert.match(root.innerHTML, /class="window-bar"/u);
  assert.match(root.innerHTML, /Hello App/u);
  assert.match(root.innerHTML, /Workspaces/u);
  assert.match(root.innerHTML, /Review/u);
  assert.match(root.innerHTML, /Settings/u);
  assert.match(root.innerHTML, /工作区概览/u);
  assert.match(root.innerHTML, /运行中控制面/u);
  assert.match(root.innerHTML, /主线蓝图/u);
  assert.match(root.innerHTML, /工作区导入与分析/u);
  assert.match(root.innerHTML, /暂停主线/u);
  assert.match(root.innerHTML, /继续主线/u);
  assert.match(root.innerHTML, /文档分析/u);
  assert.match(root.innerHTML, /操作动作/u);
  assert.match(root.innerHTML, /Daemon/u);
  assert.match(root.innerHTML, /下一推荐任务/u);
  assert.match(root.innerHTML, /自动续跑任务/u);
  assert.match(root.innerHTML, /Hierarchical Role-Based Agile Multi-Agent SDLC/u);
});

test("renderApp keeps english i18n labels available", () => {
  const root = { innerHTML: "" };
  renderApp(root, {
    locale: "en-US",
    theme: "dark",
    connected: false,
    error: "Sync issue · Request failed: 503",
    currentView: "review",
    selectedSessionId: "",
    sessionDetail: null,
    hosts: [],
    events: [],
    workspaceSelection: {
      repo_root: "D:/GitHub/dev/helloloop",
      docs_path: "docs",
      config_dir_name: ".helloloop",
      preferred_engine: "codex",
    },
    snapshot: {
      workspace_label: "HelloLoop",
      focus_summary: "Waiting for the event stream",
      methodology: "Adaptive orchestration",
      orchestration_mode: "app-first",
      updated_at: "2026-04-01T12:00:00.000Z",
      sessions: [],
      tasks: [],
    },
  });

  assert.match(root.innerHTML, /Review summary/u);
  assert.match(root.innerHTML, /Workspaces/u);
  assert.match(root.innerHTML, /Settings/u);
  assert.match(root.innerHTML, /Event feed/u);
  assert.match(root.innerHTML, /Sync issue/u);
  assert.match(root.innerHTML, /Needs attention/u);
  assert.match(root.innerHTML, /Verification evidence/u);
});

test("renderApp renders settings controls with persisted runtime options", () => {
  const root = { innerHTML: "" };
  renderApp(root, {
    locale: "en-US",
    theme: "light",
    connected: true,
    error: "",
    notice: "Settings saved",
    currentView: "settings",
    selectedSessionId: "",
    sessionDetail: null,
    workspace: null,
    hosts: [{
      display_name: "Codex CLI",
      kind: "codex",
      notes: "background + streaming",
      supports_background: true,
      supports_streaming: true,
      supports_worktree: true,
    }],
    events: [],
    health: {
      status: "ok",
      listen_addr: "127.0.0.1:37176",
      context: {
        workspace_root: "D:/GitHub/dev/helloloop",
        tool_root: "D:/GitHub/dev/helloloop",
        db_path: "D:/GitHub/dev/helloloop/.helloloop/hello-daemon.db",
        config_dir_name: ".helloloop",
        bridge_mode: "node_workspace_bridge",
        bootstrap_source: "workspace_snapshot",
        refresh_interval_seconds: 5,
      },
    },
    settings: {
      locale: "en-US",
      theme: "dark",
      preferred_host: "codex",
      scheduler_mode: "balanced_parallel",
      retry_policy: "aggressive",
      notifications_enabled: true,
      tray_launch_on_start: true,
      daemon_auto_start: true,
      refresh_interval_seconds: 10,
    },
    snapshot: {
      workspace_label: "HelloLoop",
      focus_summary: "Settings",
      methodology: "Adaptive orchestration",
      orchestration_mode: "app-first",
      updated_at: "2026-04-01T12:00:00.000Z",
      sessions: [],
      tasks: [],
    },
  });

  assert.match(root.innerHTML, /System settings/u);
  assert.match(root.innerHTML, /Save settings/u);
  assert.match(root.innerHTML, /Default host/u);
  assert.match(root.innerHTML, /Balanced parallel/u);
  assert.match(root.innerHTML, /Auto-start daemon/u);
});

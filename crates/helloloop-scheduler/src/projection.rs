use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use helloloop_domain::{
    CommandCenterSnapshot, HostKind, SessionFailure, SessionScheduler, SessionSnapshot,
    SessionState, SessionWait, TaskSnapshot,
};
use helloloop_runtime::{NodeTask, NodeWorkspaceSnapshot, parse_timestamp};

pub fn command_center_from_node_snapshot(
    snapshot: &NodeWorkspaceSnapshot,
) -> CommandCenterSnapshot {
    let tasks = snapshot.tasks.iter().map(map_node_task).collect::<Vec<_>>();
    let focus_summary = snapshot
        .workflow
        .as_ref()
        .and_then(|workflow| workflow.current_focus.clone())
        .or_else(|| {
            snapshot
                .workflow
                .as_ref()
                .and_then(|workflow| workflow.mainline_summary.clone())
        })
        .or_else(|| {
            snapshot
                .status_model
                .as_ref()
                .and_then(|status| status.reason.clone())
        })
        .unwrap_or_else(|| "Workspace snapshot loaded from Node runtime.".to_string());

    let mut sessions = vec![build_supervisor_session(snapshot)];
    sessions.extend(build_lane_sessions(snapshot));

    CommandCenterSnapshot::new(snapshot.repo_name.clone(), focus_summary, tasks, sessions)
}

fn build_supervisor_session(snapshot: &NodeWorkspaceSnapshot) -> SessionSnapshot {
    SessionSnapshot {
        id: format!("workspace-{}", snapshot.repo_name.to_lowercase()),
        title: format!("{} supervisor", snapshot.repo_name),
        host: map_engine_to_host(&snapshot.engine),
        role: "supervisor".to_string(),
        state: map_session_state(snapshot),
        reason_code: snapshot
            .status_model
            .as_ref()
            .and_then(|status| status.code.clone())
            .unwrap_or_else(|| "workspace_snapshot".to_string()),
        reason_label: snapshot
            .status_model
            .as_ref()
            .and_then(|status| status.label.clone().or(status.reason.clone()))
            .unwrap_or_else(|| "Workspace snapshot loaded".to_string()),
        http_status: snapshot
            .status_model
            .as_ref()
            .and_then(|status| status.failure.as_ref())
            .and_then(|failure| failure.http_status_code)
            .filter(|status| *status > 0),
        current_task: snapshot
            .latest_status
            .as_ref()
            .and_then(|status| status.task_title.clone())
            .or_else(|| {
                snapshot
                    .status_model
                    .as_ref()
                    .and_then(|status| status.current_action.clone())
            })
            .or_else(|| snapshot.next_task.as_ref().map(|task| task.title.clone()))
            .unwrap_or_else(|| "No active task".to_string()),
        next_task: snapshot
            .automation_next_task
            .as_ref()
            .or(snapshot.next_task.as_ref())
            .map(|task| task.title.clone())
            .unwrap_or_else(|| "No queued task".to_string()),
        depends_on: snapshot
            .next_task
            .as_ref()
            .map(|task| task.depends_on.clone())
            .unwrap_or_default(),
        retry_at: parse_retry_at(snapshot),
        session_started_at: parse_timestamp(&snapshot.updated_at).unwrap_or_else(Utc::now),
        last_heartbeat_at: parse_timestamp(&snapshot.updated_at).unwrap_or_else(Utc::now),
        reason_detail: snapshot
            .status_model
            .as_ref()
            .and_then(|status| status.detail.clone())
            .unwrap_or_default(),
        auto_action: snapshot
            .status_model
            .as_ref()
            .and_then(|status| status.auto_action.clone())
            .unwrap_or_default(),
        current_action: snapshot
            .status_model
            .as_ref()
            .and_then(|status| status.current_action.clone())
            .unwrap_or_default(),
        todo_progress: snapshot
            .status_model
            .as_ref()
            .and_then(|status| status.todo_progress.clone())
            .unwrap_or_default(),
        lane: String::new(),
        severity: snapshot
            .status_model
            .as_ref()
            .and_then(|status| status.severity.clone())
            .unwrap_or_default(),
        scheduler: map_scheduler(snapshot),
        wait: map_wait(snapshot),
        failure: map_failure(snapshot),
    }
}

fn build_lane_sessions(snapshot: &NodeWorkspaceSnapshot) -> Vec<SessionSnapshot> {
    let lanes = snapshot.tasks.iter().fold(
        BTreeMap::<String, Vec<&NodeTask>>::new(),
        |mut acc, task| {
            let lane = task.lane.trim();
            if !lane.is_empty() {
                acc.entry(lane.to_string()).or_default().push(task);
            }
            acc
        },
    );

    lanes
        .into_iter()
        .map(|(lane, tasks)| build_lane_session(snapshot, &lane, &tasks))
        .collect()
}

fn build_lane_session(
    snapshot: &NodeWorkspaceSnapshot,
    lane: &str,
    tasks: &[&NodeTask],
) -> SessionSnapshot {
    let active_task = tasks
        .iter()
        .find(|task| task.status == "in_progress")
        .copied();
    let blocked_task = tasks.iter().find(|task| task.status == "blocked").copied();
    let failed_task = tasks.iter().find(|task| task.status == "failed").copied();
    let next_task = tasks
        .iter()
        .find(|task| !matches!(task.status.as_str(), "done" | "in_progress"))
        .copied()
        .or_else(|| tasks.first().copied());

    let state = if active_task.is_some() {
        SessionState::Running
    } else if let Some(task) = blocked_task {
        if task.depends_on.is_empty() {
            SessionState::FailedRecoverable
        } else {
            SessionState::WaitingDependency
        }
    } else if failed_task.is_some() {
        SessionState::FailedRecoverable
    } else if tasks.iter().all(|task| task.status == "done") {
        SessionState::Completed
    } else {
        SessionState::Ready
    };

    let (reason_code, reason_label, auto_action) = match state {
        SessionState::Running => ("lane_running", "当前 lane 执行中", "系统持续推进当前 lane"),
        SessionState::WaitingDependency => (
            "lane_waiting_dependency",
            "等待前置任务",
            "依赖满足后可继续推进",
        ),
        SessionState::FailedRecoverable => (
            "lane_failed_recoverable",
            "存在待恢复失败",
            "修复后可继续推进",
        ),
        SessionState::Completed => ("lane_completed", "当前 lane 已完成", "等待新的任务分派"),
        _ => ("lane_ready", "可调度执行", "可继续分派该 lane"),
    };

    let current_task = active_task
        .or(blocked_task)
        .or(failed_task)
        .map(|task| task.title.clone())
        .unwrap_or_default();
    let next_task_title = next_task.map(|task| task.title.clone()).unwrap_or_default();
    let depends_on = blocked_task
        .map(|task| task.depends_on.clone())
        .unwrap_or_default();
    let role = tasks
        .iter()
        .find_map(|task| (!task.role.trim().is_empty()).then_some(task.role.clone()))
        .unwrap_or_else(|| "developer".to_string());
    let task_count = tasks.len();
    let timestamp = parse_timestamp(&snapshot.updated_at).unwrap_or_else(Utc::now);

    let mut session = SessionSnapshot::new(
        &format!("{} · {}", snapshot.repo_name, lane),
        map_engine_to_host(&snapshot.engine),
        &role,
        state,
        &current_task,
        &next_task_title,
    );
    session.id = format!(
        "workspace-{}-lane-{}",
        snapshot.repo_name.to_lowercase(),
        lane.replace(' ', "-").to_lowercase()
    );
    session.reason_code = reason_code.to_string();
    session.reason_label = reason_label.to_string();
    session.reason_detail = format!("lane `{lane}` 共 {task_count} 个任务");
    session.auto_action = auto_action.to_string();
    session.depends_on = depends_on.clone();
    session.lane = lane.to_string();
    session.severity = match state {
        SessionState::FailedRecoverable
        | SessionState::FailedTerminal
        | SessionState::HumanInputRequired => "high".to_string(),
        SessionState::WaitingDependency
        | SessionState::RetryScheduled
        | SessionState::RateLimited => "medium".to_string(),
        SessionState::Running => "info".to_string(),
        _ => "low".to_string(),
    };
    session.session_started_at = timestamp;
    session.last_heartbeat_at = timestamp;
    session.current_action = match state {
        SessionState::Running => format!("推进 {lane} lane"),
        SessionState::WaitingDependency => format!("等待 {lane} lane 依赖完成"),
        SessionState::FailedRecoverable => format!("修复 {lane} lane 阻塞"),
        SessionState::Completed => format!("{lane} lane 已完成"),
        _ => format!("准备调度 {lane} lane"),
    };
    session.scheduler = SessionScheduler {
        state: reason_code.to_string(),
        label: reason_label.to_string(),
        mode: if matches!(state, SessionState::Ready | SessionState::Completed) {
            "manual_resume".to_string()
        } else {
            "autonomous".to_string()
        },
        reason: format!("lane: {lane}"),
        detail: session.reason_detail.clone(),
        will_auto_resume: matches!(state, SessionState::Running),
    };
    if matches!(state, SessionState::WaitingDependency) {
        session.wait = SessionWait {
            kind: "dependency".to_string(),
            label: "等待前置任务完成".to_string(),
            detail: session.reason_detail.clone(),
            target_label: depends_on.join("、"),
            resumes_automatically: false,
            until: None,
        };
    }
    if matches!(state, SessionState::FailedRecoverable) {
        session.failure = SessionFailure {
            code: "lane_failed".to_string(),
            label: "存在待恢复失败".to_string(),
            detail: blocked_task
                .or(failed_task)
                .map(|task| task.title.clone())
                .unwrap_or_default(),
            family: "recoverable".to_string(),
            http_status: None,
            http_status_label: String::new(),
            retryable: true,
            retry_at: None,
        };
    }

    session
}

fn map_node_task(task: &NodeTask) -> TaskSnapshot {
    let state = match task.status.as_str() {
        "done" => SessionState::Completed,
        "in_progress" => SessionState::Running,
        "blocked" => {
            if !task.depends_on.is_empty() {
                SessionState::WaitingDependency
            } else {
                SessionState::FailedRecoverable
            }
        }
        "failed" => SessionState::FailedRecoverable,
        _ => {
            if !task.depends_on.is_empty() {
                SessionState::WaitingDependency
            } else {
                SessionState::Ready
            }
        }
    };

    TaskSnapshot {
        id: task.id.clone(),
        title: task.title.clone(),
        stage: if task.stage.trim().is_empty() {
            "implementation".to_string()
        } else {
            task.stage.clone()
        },
        owner_role: if task.role.trim().is_empty() {
            "developer".to_string()
        } else {
            task.role.clone()
        },
        state,
        lane: task.lane.clone(),
        priority: task.priority.clone(),
        depends_on: task.depends_on.clone(),
    }
}

fn map_session_state(snapshot: &NodeWorkspaceSnapshot) -> SessionState {
    let http_status = snapshot
        .status_model
        .as_ref()
        .and_then(|status| status.failure.as_ref())
        .and_then(|failure| failure.http_status_code)
        .or_else(|| {
            snapshot
                .runtime
                .as_ref()
                .and_then(|runtime| runtime.failure_http_status)
        })
        .unwrap_or_default();
    let code = snapshot
        .status_model
        .as_ref()
        .and_then(|status| status.code.as_deref())
        .unwrap_or_default();

    if snapshot.summary.pending == 0 && snapshot.summary.total > 0 {
        return SessionState::Completed;
    }

    if http_status == 429 && matches!(code, "retry_waiting" | "retry_scheduled" | "probe_waiting") {
        return SessionState::RateLimited;
    }
    if matches!(code, "retry_waiting" | "retry_scheduled") {
        return SessionState::RetryScheduled;
    }
    if matches!(code, "blocked_dependencies" | "blocked_stage_gates") {
        return SessionState::WaitingDependency;
    }
    if code == "blocked_external" {
        return SessionState::WaitingExternalSignal;
    }
    if matches!(
        code,
        "blocked_manual_input" | "blocked_risk" | "paused_manual" | "paused_operator"
    ) {
        return SessionState::HumanInputRequired;
    }
    if matches!(code, "blocked_failed" | "recoverable_failure") {
        return SessionState::FailedRecoverable;
    }
    if matches!(code, "failed" | "failed_terminal") {
        return SessionState::FailedTerminal;
    }
    if matches!(code, "recovering" | "running") {
        return SessionState::Running;
    }
    if code == "human_input_required" {
        return SessionState::HumanInputRequired;
    }

    match snapshot
        .runtime
        .as_ref()
        .and_then(|runtime| runtime.status.as_deref())
    {
        Some("running" | "recovering" | "launching") => SessionState::Running,
        Some("retry_waiting") => SessionState::RetryScheduled,
        Some("stopped") if snapshot.summary.pending == 0 && snapshot.summary.total > 0 => {
            SessionState::Completed
        }
        _ if snapshot.summary.pending > 0 => SessionState::Ready,
        _ => SessionState::Ready,
    }
}

fn parse_retry_at(snapshot: &NodeWorkspaceSnapshot) -> Option<DateTime<Utc>> {
    snapshot
        .status_model
        .as_ref()
        .and_then(|status| status.failure.as_ref())
        .and_then(|failure| failure.next_retry_at.as_deref())
        .and_then(parse_timestamp)
        .or_else(|| {
            snapshot
                .status_model
                .as_ref()
                .and_then(|status| status.wait.as_ref())
                .and_then(|wait| wait.until.as_deref())
                .and_then(parse_timestamp)
        })
        .or_else(|| {
            snapshot
                .runtime
                .as_ref()
                .and_then(|runtime| runtime.next_retry_at.as_deref())
                .and_then(parse_timestamp)
        })
}

fn map_scheduler(snapshot: &NodeWorkspaceSnapshot) -> SessionScheduler {
    let status = snapshot.status_model.as_ref();
    let scheduler = status.and_then(|item| item.scheduler.as_ref());

    SessionScheduler {
        state: scheduler
            .and_then(|item| item.state.clone())
            .or_else(|| status.and_then(|item| item.code.clone()))
            .unwrap_or_default(),
        label: scheduler
            .and_then(|item| item.label.clone())
            .or_else(|| status.and_then(|item| item.label.clone()))
            .unwrap_or_default(),
        mode: scheduler
            .and_then(|item| item.mode.clone())
            .unwrap_or_default(),
        reason: scheduler
            .and_then(|item| item.reason.clone())
            .or_else(|| status.and_then(|item| item.reason.clone()))
            .unwrap_or_default(),
        detail: scheduler
            .and_then(|item| item.detail.clone())
            .or_else(|| status.and_then(|item| item.detail.clone()))
            .unwrap_or_default(),
        will_auto_resume: scheduler
            .and_then(|item| item.will_auto_resume)
            .unwrap_or(false),
    }
}

fn map_wait(snapshot: &NodeWorkspaceSnapshot) -> SessionWait {
    let wait = snapshot
        .status_model
        .as_ref()
        .and_then(|status| status.wait.as_ref());

    SessionWait {
        kind: wait.and_then(|item| item.kind.clone()).unwrap_or_default(),
        label: wait.and_then(|item| item.label.clone()).unwrap_or_default(),
        detail: wait
            .and_then(|item| item.detail.clone())
            .unwrap_or_default(),
        target_label: wait
            .and_then(|item| item.target_label.clone())
            .or_else(|| {
                snapshot
                    .status_model
                    .as_ref()
                    .and_then(|status| status.wait_target_label.clone())
            })
            .unwrap_or_default(),
        resumes_automatically: wait
            .and_then(|item| item.resumes_automatically)
            .unwrap_or(false),
        until: wait
            .and_then(|item| item.until.as_deref())
            .and_then(parse_timestamp),
    }
}

fn map_failure(snapshot: &NodeWorkspaceSnapshot) -> SessionFailure {
    let status_failure = snapshot
        .status_model
        .as_ref()
        .and_then(|status| status.failure.as_ref());
    let runtime = snapshot.runtime.as_ref();

    SessionFailure {
        code: status_failure
            .and_then(|item| item.code.clone())
            .or_else(|| runtime.and_then(|item| item.failure_code.clone()))
            .unwrap_or_default(),
        label: status_failure
            .and_then(|item| item.label.clone())
            .unwrap_or_default(),
        detail: status_failure
            .and_then(|item| item.detail.clone().or(item.reason.clone()))
            .or_else(|| runtime.and_then(|item| item.failure_reason.clone()))
            .unwrap_or_default(),
        family: status_failure
            .and_then(|item| item.family.clone())
            .or_else(|| runtime.and_then(|item| item.failure_family.clone()))
            .unwrap_or_default(),
        http_status: status_failure
            .and_then(|item| item.http_status_code)
            .or_else(|| runtime.and_then(|item| item.failure_http_status))
            .filter(|status| *status > 0),
        http_status_label: status_failure
            .and_then(|item| item.http_status_label.clone())
            .unwrap_or_default(),
        retryable: status_failure
            .and_then(|item| item.retryable)
            .unwrap_or(false),
        retry_at: parse_retry_at(snapshot),
    }
}

fn map_engine_to_host(engine: &str) -> HostKind {
    match engine {
        "claude" => HostKind::Claude,
        "gemini" => HostKind::Gemini,
        _ => HostKind::Codex,
    }
}

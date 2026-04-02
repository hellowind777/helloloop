use super::command_center_from_node_snapshot;
use crate::SessionState;
use helloloop_runtime::{
    NodeFailure, NodeRuntime, NodeStatusModel, NodeSummary, NodeTask, NodeWait,
    NodeWorkspaceSnapshot,
};

fn sample_task() -> NodeTask {
    NodeTask {
        id: "task-1".to_string(),
        title: "Handle retry".to_string(),
        status: "in_progress".to_string(),
        stage: "implementation".to_string(),
        role: "developer".to_string(),
        lane: String::new(),
        priority: String::new(),
        depends_on: Vec::new(),
        blocked_by: Vec::new(),
    }
}

#[test]
fn maps_rate_limited_session_details_from_node_snapshot() {
    let snapshot = NodeWorkspaceSnapshot {
        repo_root: "D:/GitHub/dev/helloloop".to_string(),
        repo_name: "helloloop".to_string(),
        config_dir_name: ".helloloop".to_string(),
        engine: "codex".to_string(),
        summary: NodeSummary {
            total: 1,
            pending: 1,
            in_progress: 0,
            done: 0,
            failed: 0,
            blocked: 0,
        },
        next_task: Some(sample_task()),
        automation_next_task: Some(sample_task()),
        tasks: vec![sample_task()],
        workflow: None,
        doc_analysis: None,
        supervisor: None,
        latest_status: None,
        runtime: Some(NodeRuntime {
            engine: None,
            engine_display_name: None,
            phase: None,
            output_prefix: None,
            hard_retry_budget: None,
            soft_retry_budget: None,
            attempt_prefix: None,
            recovery_count: None,
            recovery_history: Vec::new(),
            heartbeat: None,
            activity_file: None,
            activity_events_file: None,
            status: Some("retry_waiting".to_string()),
            updated_at: Some("2026-04-01T11:28:41.705945200Z".to_string()),
            failure_code: Some("rate_limit".to_string()),
            failure_family: Some("soft".to_string()),
            failure_reason: Some("HTTP 429".to_string()),
            failure_http_status: Some(429),
            next_retry_at: Some("2026-04-01T11:29:41.705945200Z".to_string()),
        }),
        activity: None,
        status_model: Some(NodeStatusModel {
            code: Some("retry_waiting".to_string()),
            label: Some("等待自动重试".to_string()),
            reason: Some("限流，等待下一次恢复".to_string()),
            detail: Some("系统将在一分钟后自动恢复".to_string()),
            current_action: Some("等待自动重试".to_string()),
            wait_target_label: Some("2026-04-01 19:29:41".to_string()),
            auto_action: Some("到点后自动恢复".to_string()),
            reason_code: Some("rate_limit".to_string()),
            severity: Some("warn".to_string()),
            todo_progress: Some("1/4".to_string()),
            activity: None,
            failure: Some(NodeFailure {
                code: Some("rate_limit".to_string()),
                family: Some("soft".to_string()),
                label: Some("HTTP 429 / 限流或临时容量不足".to_string()),
                detail: Some("容量不足".to_string()),
                reason: Some("HTTP 429".to_string()),
                http_status_code: Some(429),
                http_status_label: Some("HTTP 429 / 限流或临时容量不足".to_string()),
                retryable: Some(true),
                next_retry_at: Some("2026-04-01T11:29:41.705945200Z".to_string()),
                next_retry_label: Some("2026-04-01 19:29:41".to_string()),
            }),
            wait: Some(NodeWait {
                kind: Some("runtime_retry".to_string()),
                label: Some("等待自动重试".to_string()),
                detail: Some("下一次自动恢复".to_string()),
                target_label: Some("2026-04-01 19:29:41".to_string()),
                until: Some("2026-04-01T11:29:41.705945200Z".to_string()),
                resumes_automatically: Some(true),
            }),
            scheduler: None,
        }),
        updated_at: "2026-04-01T11:28:41.705945200Z".to_string(),
    };

    let command_center = command_center_from_node_snapshot(&snapshot);
    let session = &command_center.sessions[0];

    assert_eq!(session.state, SessionState::RateLimited);
    assert_eq!(session.failure.http_status, Some(429));
    assert_eq!(session.failure.code, "rate_limit");
    assert_eq!(session.wait.kind, "runtime_retry");
    assert_eq!(session.todo_progress, "1/4");
    assert_eq!(session.current_action, "等待自动重试");
    assert!(session.retry_at.is_some());
}

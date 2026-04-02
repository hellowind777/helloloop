use std::path::Path;

use chrono::{Duration, Utc};
use helloloop_domain::{
    CommandCenterSnapshot, HostKind, SessionSnapshot, SessionState, TaskSnapshot,
};

mod projection;

pub use projection::command_center_from_node_snapshot;

pub fn build_bootstrap_snapshot(workspace_root: Option<&str>) -> CommandCenterSnapshot {
    let workspace_label = workspace_root
        .and_then(|value| Path::new(value).file_name())
        .and_then(|value| value.to_str())
        .unwrap_or("hello-app-bootstrap")
        .to_string();

    let tasks = vec![
        TaskSnapshot::new(
            "Analyze requirement docs",
            "product",
            "product_owner",
            SessionState::Running,
        ),
        TaskSnapshot::new(
            "Build workflow graph",
            "architecture",
            "architect",
            SessionState::Ready,
        ),
        TaskSnapshot::new(
            "Prepare host adapters",
            "implementation",
            "supervisor",
            SessionState::WaitingDependency,
        ),
    ];

    let mut codex = SessionSnapshot::new(
        "Codex product lane",
        HostKind::Codex,
        "product_owner",
        SessionState::Running,
        "Analyze requirement docs",
        "Build workflow graph",
    );
    codex.reason_code = "running".to_string();
    codex.reason_label = "Daemon bootstrap is active".to_string();

    let mut claude = SessionSnapshot::new(
        "Claude architecture lane",
        HostKind::Claude,
        "architect",
        SessionState::WaitingDependency,
        "Waiting for product baseline",
        "Build workflow graph",
    );
    claude.reason_code = "waiting_dependency".to_string();
    claude.reason_label = "Waiting for upstream task completion".to_string();
    claude.depends_on = vec!["Analyze requirement docs".to_string()];

    let mut gemini = SessionSnapshot::new(
        "Gemini recovery lane",
        HostKind::Gemini,
        "supervisor",
        SessionState::RetryScheduled,
        "Host probe pending",
        "Prepare host adapters",
    );
    gemini.reason_code = "retry_scheduled".to_string();
    gemini.reason_label = "Bootstrap retry policy engaged".to_string();
    gemini.http_status = Some(429);
    gemini.retry_at = Some(Utc::now() + Duration::seconds(30));

    CommandCenterSnapshot::new(
        workspace_label,
        "Bootstrap control plane is live; next milestone is replacing scaffold sessions with real host sessions.".to_string(),
        tasks,
        vec![codex, claude, gemini],
    )
}

#[cfg(test)]
mod tests;

use std::collections::{BTreeMap, BTreeSet};

use chrono::{DateTime, Utc};
use helloloop_domain::{
    CommandCenterSnapshot, SessionDetailSnapshot, SessionSnapshot, SessionState, TaskSnapshot,
};

use crate::session_actions::available_actions;

#[derive(Debug, Clone)]
pub struct BlockerAcknowledgement {
    pub signature: String,
    pub acknowledged_at: DateTime<Utc>,
}

pub fn build_session_detail(
    snapshot: &CommandCenterSnapshot,
    session_id: &str,
    blocker_acknowledgement: Option<&BlockerAcknowledgement>,
) -> Option<SessionDetailSnapshot> {
    let session = snapshot
        .sessions
        .iter()
        .find(|item| item.id == session_id)
        .cloned()?;
    let related_tasks = related_tasks_for_session(snapshot, &session);
    let task_index = snapshot
        .tasks
        .iter()
        .map(|task| (task.id.clone(), task.title.clone()))
        .collect::<BTreeMap<_, _>>();
    let dependency_labels = related_tasks
        .iter()
        .flat_map(|task| task.depends_on.iter())
        .map(|dependency| {
            task_index
                .get(dependency)
                .cloned()
                .unwrap_or_else(|| dependency.to_string())
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let blocker_labels = session
        .depends_on
        .iter()
        .map(|dependency| {
            task_index
                .get(dependency)
                .cloned()
                .unwrap_or_else(|| dependency.to_string())
        })
        .collect::<Vec<_>>();
    let blocker_signature = blocker_signature(&session, &blocker_labels);
    let blocker_acknowledged = blocker_acknowledgement
        .map(|item| item.signature == blocker_signature && !blocker_signature.is_empty())
        .unwrap_or(false);
    let blocker_acknowledged_at = if blocker_acknowledged {
        blocker_acknowledgement.map(|item| item.acknowledged_at)
    } else {
        None
    };

    Some(SessionDetailSnapshot {
        ready_tasks: filter_tasks(&related_tasks, SessionState::Ready),
        running_tasks: filter_tasks(&related_tasks, SessionState::Running),
        blocked_tasks: related_tasks
            .iter()
            .filter(|task| {
                matches!(
                    task.state,
                    SessionState::WaitingDependency
                        | SessionState::WaitingExternalSignal
                        | SessionState::RetryScheduled
                        | SessionState::RateLimited
                        | SessionState::HumanInputRequired
                        | SessionState::FailedRecoverable
                        | SessionState::FailedTerminal
                )
            })
            .cloned()
            .collect(),
        completed_tasks: filter_tasks(&related_tasks, SessionState::Completed),
        related_tasks,
        dependency_labels,
        blocker_labels,
        recovery_summary: recovery_summary(&session),
        next_action_summary: next_action_summary(&session),
        blocker_signature,
        blocker_acknowledged,
        blocker_acknowledged_at,
        available_actions: available_actions(&session, blocker_acknowledged),
        session,
    })
}

fn related_tasks_for_session(
    snapshot: &CommandCenterSnapshot,
    session: &SessionSnapshot,
) -> Vec<TaskSnapshot> {
    let matches = snapshot
        .tasks
        .iter()
        .filter(|task| {
            if session.role == "supervisor" && session.lane.is_empty() {
                return true;
            }
            if !session.lane.is_empty() {
                return task.lane == session.lane;
            }
            task.owner_role == session.role
        })
        .cloned()
        .collect::<Vec<_>>();

    if matches.is_empty() && session.role == "supervisor" {
        snapshot.tasks.clone()
    } else {
        matches
    }
}

fn filter_tasks(tasks: &[TaskSnapshot], state: SessionState) -> Vec<TaskSnapshot> {
    tasks
        .iter()
        .filter(|task| task.state == state)
        .cloned()
        .collect()
}

fn recovery_summary(session: &SessionSnapshot) -> String {
    if !session.failure.label.is_empty() {
        return format!(
            "{}{}",
            session.failure.label,
            if session.failure.detail.is_empty() {
                String::new()
            } else {
                format!(" · {}", session.failure.detail)
            }
        );
    }
    if !session.wait.label.is_empty() {
        return format!(
            "{}{}",
            session.wait.label,
            if session.wait.target_label.is_empty() {
                String::new()
            } else {
                format!(" · {}", session.wait.target_label)
            }
        );
    }
    if !session.reason_detail.is_empty() {
        return session.reason_detail.clone();
    }
    session.reason_label.clone()
}

fn next_action_summary(session: &SessionSnapshot) -> String {
    if !session.auto_action.is_empty() {
        return session.auto_action.clone();
    }
    if !session.current_action.is_empty() {
        return session.current_action.clone();
    }
    if !session.next_task.is_empty() {
        return format!("next: {}", session.next_task);
    }
    session.reason_label.clone()
}

fn blocker_signature(session: &SessionSnapshot, blocker_labels: &[String]) -> String {
    if blocker_labels.is_empty()
        && session.wait.label.is_empty()
        && session.failure.label.is_empty()
        && session.reason_label.is_empty()
    {
        return String::new();
    }

    [
        session.id.clone(),
        format!("{:?}", session.state),
        session.reason_code.clone(),
        session.reason_label.clone(),
        session.current_task.clone(),
        session.next_task.clone(),
        session.wait.kind.clone(),
        session.wait.label.clone(),
        session.wait.target_label.clone(),
        session.failure.code.clone(),
        session.failure.label.clone(),
        session
            .failure
            .http_status
            .map(|value| value.to_string())
            .unwrap_or_default(),
        blocker_labels.join("|"),
    ]
    .join("::")
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use helloloop_domain::{
        CommandCenterSnapshot, HostKind, SessionFailure, SessionSnapshot, SessionState,
        TaskSnapshot,
    };

    use super::{BlockerAcknowledgement, build_session_detail};

    #[test]
    fn builds_lane_detail_with_dependency_labels_and_actions() {
        let now = Utc::now();
        let tasks = vec![
            TaskSnapshot {
                id: "task-a".to_string(),
                title: "Architect flow".to_string(),
                stage: "design".to_string(),
                owner_role: "architect".to_string(),
                state: SessionState::Running,
                lane: "architecture".to_string(),
                priority: "p1".to_string(),
                depends_on: Vec::new(),
            },
            TaskSnapshot {
                id: "task-b".to_string(),
                title: "Review dependency".to_string(),
                stage: "review".to_string(),
                owner_role: "architect".to_string(),
                state: SessionState::WaitingDependency,
                lane: "architecture".to_string(),
                priority: "p1".to_string(),
                depends_on: vec!["task-a".to_string()],
            },
        ];
        let mut session = SessionSnapshot::new(
            "Architecture lane",
            HostKind::Codex,
            "architect",
            SessionState::FailedRecoverable,
            "Review dependency",
            "Resume implementation",
        );
        session.id = "lane-architecture".to_string();
        session.lane = "architecture".to_string();
        session.depends_on = vec!["task-a".to_string()];
        session.current_action = "Resolve architecture blockers".to_string();
        session.failure = SessionFailure {
            code: "lane_failed".to_string(),
            label: "存在待恢复失败".to_string(),
            detail: "Review dependency".to_string(),
            family: "recoverable".to_string(),
            http_status: None,
            http_status_label: String::new(),
            retryable: true,
            retry_at: None,
        };
        session.session_started_at = now;
        session.last_heartbeat_at = now;

        let snapshot = CommandCenterSnapshot {
            workspace_label: "HelloLoop".to_string(),
            methodology: "method".to_string(),
            orchestration_mode: "mode".to_string(),
            focus_summary: "focus".to_string(),
            updated_at: now,
            tasks,
            sessions: vec![session],
        };

        let detail =
            build_session_detail(&snapshot, "lane-architecture", None).expect("session detail");
        assert_eq!(detail.related_tasks.len(), 2);
        assert!(
            detail
                .dependency_labels
                .iter()
                .any(|item| item == "Architect flow")
        );
        assert!(
            detail
                .available_actions
                .iter()
                .any(|item| item.key == "refresh_now" && item.implemented)
        );
        assert!(
            detail
                .available_actions
                .iter()
                .any(|item| item.key == "resume_session" && item.implemented)
        );
        assert!(
            detail
                .available_actions
                .iter()
                .any(|item| item.key == "retry_current" && item.implemented)
        );
        assert!(
            detail
                .available_actions
                .iter()
                .any(|item| item.key == "rerun_analysis" && item.implemented)
        );
        assert!(
            detail
                .available_actions
                .iter()
                .any(|item| item.key == "ack_blocker" && item.implemented)
        );
        assert!(!detail.blocker_acknowledged);
    }

    #[test]
    fn marks_blocker_acknowledgement_when_signature_matches() {
        let now = Utc::now();
        let mut session = SessionSnapshot::new(
            "Review lane",
            HostKind::Codex,
            "reviewer",
            SessionState::WaitingDependency,
            "Wait for shared protocol",
            "Review UI integration",
        );
        session.id = "review-lane".to_string();
        session.reason_code = "waiting_dependency".to_string();
        session.reason_label = "Waiting for shared protocol".to_string();
        session.depends_on = vec!["task-protocol".to_string()];
        session.last_heartbeat_at = now;
        session.session_started_at = now;

        let snapshot = CommandCenterSnapshot {
            workspace_label: "HelloLoop".to_string(),
            methodology: "method".to_string(),
            orchestration_mode: "mode".to_string(),
            focus_summary: "focus".to_string(),
            updated_at: now,
            tasks: vec![TaskSnapshot {
                id: "task-protocol".to_string(),
                title: "Shared protocol".to_string(),
                stage: "implementation".to_string(),
                owner_role: "developer".to_string(),
                state: SessionState::Running,
                lane: "protocol".to_string(),
                priority: "p1".to_string(),
                depends_on: Vec::new(),
            }],
            sessions: vec![session],
        };

        let detail_without_ack = build_session_detail(&snapshot, "review-lane", None)
            .expect("session detail without ack");
        let acknowledgement = BlockerAcknowledgement {
            signature: detail_without_ack.blocker_signature.clone(),
            acknowledged_at: now,
        };
        let detail_with_ack =
            build_session_detail(&snapshot, "review-lane", Some(&acknowledgement))
                .expect("session detail with ack");

        assert!(detail_with_ack.blocker_acknowledged);
        assert_eq!(detail_with_ack.blocker_acknowledged_at, Some(now));
    }
}

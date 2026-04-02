use helloloop_domain::{SessionAction, SessionSnapshot, SessionState};

pub fn available_actions(
    session: &SessionSnapshot,
    blocker_acknowledged: bool,
) -> Vec<SessionAction> {
    let mut actions = vec![SessionAction {
        key: "refresh_now".to_string(),
        label: "Refresh now".to_string(),
        method: "POST".to_string(),
        endpoint: "/api/v1/control/refresh".to_string(),
        kind: "primary".to_string(),
        implemented: true,
        reason: "Immediately refresh workspace projection".to_string(),
    }];

    if supports_resume(session) {
        actions.push(SessionAction {
            key: "resume_session".to_string(),
            label: "Resume session".to_string(),
            method: "POST".to_string(),
            endpoint: format!("/api/v1/control/sessions/{}/resume", session.id),
            kind: "secondary".to_string(),
            implemented: true,
            reason: resume_reason(session),
        });
    }

    if supports_retry(session) {
        actions.push(SessionAction {
            key: "retry_current".to_string(),
            label: "Retry current".to_string(),
            method: "POST".to_string(),
            endpoint: format!("/api/v1/control/sessions/{}/retry-current", session.id),
            kind: "secondary".to_string(),
            implemented: true,
            reason: retry_reason(session),
        });
    }

    if supports_rerun_analysis(session) {
        actions.push(SessionAction {
            key: "rerun_analysis".to_string(),
            label: "Rerun analysis".to_string(),
            method: "POST".to_string(),
            endpoint: format!("/api/v1/control/sessions/{}/rerun-analysis", session.id),
            kind: "secondary".to_string(),
            implemented: true,
            reason:
                "Rebuild the workflow graph and backlog from the latest repository and docs facts"
                    .to_string(),
        });
    }

    if supports_ack_blocker(session) {
        actions.push(SessionAction {
            key: "ack_blocker".to_string(),
            label: if blocker_acknowledged {
                "Update acknowledgement".to_string()
            } else {
                "Acknowledge blocker".to_string()
            },
            method: "POST".to_string(),
            endpoint: format!("/api/v1/control/sessions/{}/ack-blocker", session.id),
            kind: if blocker_acknowledged {
                "secondary".to_string()
            } else {
                "primary".to_string()
            },
            implemented: true,
            reason: if blocker_acknowledged {
                "Refresh the operator acknowledgement when the blocker context changes".to_string()
            } else {
                "Mark the current blocker as reviewed so the control plane knows it is understood"
                    .to_string()
            },
        });
    }

    actions
}

fn supports_resume(session: &SessionSnapshot) -> bool {
    !matches!(
        session.state,
        SessionState::Running
            | SessionState::Completed
            | SessionState::FailedTerminal
            | SessionState::HumanInputRequired
    )
}

fn resume_reason(session: &SessionSnapshot) -> String {
    match session.state {
        SessionState::Ready => {
            "Launch the next queued task from the current orchestration lane".to_string()
        }
        SessionState::RetryScheduled | SessionState::RateLimited => {
            "Re-enter the supervisor pipeline and continue after transient failure recovery"
                .to_string()
        }
        SessionState::FailedRecoverable => {
            "Retry the recoverable session from the most relevant task candidate".to_string()
        }
        SessionState::WaitingDependency | SessionState::WaitingExternalSignal => {
            "Attempt another scheduling pass in case dependencies are already satisfied".to_string()
        }
        _ => "Resume the current session flow".to_string(),
    }
}

fn supports_retry(session: &SessionSnapshot) -> bool {
    matches!(
        session.state,
        SessionState::RetryScheduled
            | SessionState::RateLimited
            | SessionState::FailedRecoverable
            | SessionState::WaitingExternalSignal
    )
}

fn retry_reason(session: &SessionSnapshot) -> String {
    match session.state {
        SessionState::RetryScheduled | SessionState::RateLimited => {
            "Retry the current task immediately instead of waiting for the next automatic recovery window"
                .to_string()
        }
        SessionState::FailedRecoverable => {
            "Retry the most relevant recoverable task candidate in the current lane".to_string()
        }
        SessionState::WaitingExternalSignal => {
            "Try the current task again in case the external dependency is already available"
                .to_string()
        }
        _ => "Retry the current task candidate".to_string(),
    }
}

fn supports_rerun_analysis(session: &SessionSnapshot) -> bool {
    !matches!(session.state, SessionState::Running)
}

fn supports_ack_blocker(session: &SessionSnapshot) -> bool {
    matches!(
        session.state,
        SessionState::WaitingDependency
            | SessionState::WaitingExternalSignal
            | SessionState::RetryScheduled
            | SessionState::RateLimited
            | SessionState::HumanInputRequired
            | SessionState::FailedRecoverable
            | SessionState::FailedTerminal
    )
}

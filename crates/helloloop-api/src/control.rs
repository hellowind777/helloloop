use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use chrono::Utc;
use helloloop_domain::{HelloAppWorkspaceSelection, SessionDetailSnapshot};
use helloloop_runtime::{ControlIntent, ControlLaunchError};

use crate::ApiState;
use crate::session_detail::{BlockerAcknowledgement, build_session_detail};

#[derive(Debug, serde::Serialize)]
pub(crate) struct SessionControlResponse {
    accepted: bool,
    action_key: String,
    message: String,
    command: String,
    task_id: Option<String>,
    acknowledged_at: Option<chrono::DateTime<Utc>>,
}

pub(crate) async fn resume_session(
    State(state): State<ApiState>,
    Path(session_id): Path<String>,
) -> Result<Json<SessionControlResponse>, StatusCode> {
    launch_session_control(
        &state,
        &session_id,
        "resume_session",
        "control_resume_requested",
        select_resume_intent,
    )
    .await
}

pub(crate) async fn retry_current(
    State(state): State<ApiState>,
    Path(session_id): Path<String>,
) -> Result<Json<SessionControlResponse>, StatusCode> {
    launch_session_control(
        &state,
        &session_id,
        "retry_current",
        "control_retry_requested",
        select_retry_intent,
    )
    .await
}

pub(crate) async fn rerun_analysis(
    State(state): State<ApiState>,
    Path(session_id): Path<String>,
) -> Result<Json<SessionControlResponse>, StatusCode> {
    launch_session_control(
        &state,
        &session_id,
        "rerun_analysis",
        "control_rerun_analysis_requested",
        select_rerun_analysis_intent,
    )
    .await
}

pub(crate) async fn ack_blocker(
    State(state): State<ApiState>,
    Path(session_id): Path<String>,
) -> Result<Json<SessionControlResponse>, StatusCode> {
    let detail = load_session_detail(&state, &session_id).await?;
    if detail.blocker_signature.is_empty() {
        return Err(StatusCode::CONFLICT);
    }
    let acknowledgement = state
        .store
        .acknowledge_blocker(&session_id, &detail.blocker_signature)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let _ = state
        .store
        .append_event("control_blocker_acknowledged")
        .await;
    state.refresh.notify_one();

    Ok(Json(SessionControlResponse {
        accepted: true,
        action_key: "ack_blocker".to_string(),
        message: "blocker acknowledged".to_string(),
        command: "ack-blocker".to_string(),
        task_id: None,
        acknowledged_at: Some(acknowledgement.acknowledged_at),
    }))
}

pub(crate) async fn continue_mainline(
    State(state): State<ApiState>,
) -> Result<Json<SessionControlResponse>, StatusCode> {
    let snapshot = state.store.snapshot().await;
    let session_id = snapshot
        .sessions
        .iter()
        .find(|session| session.role == "supervisor" && session.lane.is_empty())
        .or_else(|| snapshot.sessions.first())
        .map(|session| session.id.clone())
        .ok_or(StatusCode::NOT_FOUND)?;

    try_control_sequence(
        &state,
        &session_id,
        &[
            (
                "retry_current",
                "control_continue_mainline_requested",
                select_retry_intent as fn(&SessionDetailSnapshot) -> Option<ControlIntent>,
            ),
            (
                "resume_session",
                "control_continue_mainline_requested",
                select_resume_intent,
            ),
            (
                "rerun_analysis",
                "control_continue_mainline_requested",
                select_rerun_analysis_intent,
            ),
        ],
    )
    .await
}

pub(crate) async fn pause_mainline(
    State(state): State<ApiState>,
) -> Result<Json<SessionControlResponse>, StatusCode> {
    let selection = state
        .current_workspace_selection()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::CONFLICT)?;
    let launcher = state
        .control_launcher_for_selection(&selection)
        .ok_or(StatusCode::CONFLICT)?;
    let launch_result = launcher
        .launch(ControlIntent::PauseMainline)
        .await
        .map_err(map_control_error)?;
    let _ = state
        .store
        .append_event("control_pause_mainline_requested")
        .await;
    state.refresh.notify_one();

    Ok(Json(SessionControlResponse {
        accepted: true,
        action_key: "pause_mainline".to_string(),
        message: "mainline paused".to_string(),
        command: launch_result.command_label,
        task_id: None,
        acknowledged_at: None,
    }))
}

pub(crate) async fn recover_first(
    State(state): State<ApiState>,
) -> Result<Json<SessionControlResponse>, StatusCode> {
    let snapshot = state.store.snapshot().await;
    let session_id = snapshot
        .sessions
        .iter()
        .find(|session| {
            !matches!(
                session.state,
                helloloop_domain::SessionState::Running
                    | helloloop_domain::SessionState::Completed
                    | helloloop_domain::SessionState::FailedTerminal
            )
        })
        .or_else(|| snapshot.sessions.first())
        .map(|session| session.id.clone())
        .ok_or(StatusCode::NOT_FOUND)?;

    try_control_sequence(
        &state,
        &session_id,
        &[
            (
                "retry_current",
                "control_recover_first_requested",
                select_retry_intent as fn(&SessionDetailSnapshot) -> Option<ControlIntent>,
            ),
            (
                "resume_session",
                "control_recover_first_requested",
                select_resume_intent,
            ),
            (
                "rerun_analysis",
                "control_recover_first_requested",
                select_rerun_analysis_intent,
            ),
        ],
    )
    .await
}

pub(crate) async fn load_session_detail(
    state: &ApiState,
    session_id: &str,
) -> Result<SessionDetailSnapshot, StatusCode> {
    let snapshot = state.store.snapshot().await;
    let blocker_ack = state
        .store
        .blocker_acknowledgement(session_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let blocker_ack = blocker_ack.map(|item| BlockerAcknowledgement {
        signature: item.signature,
        acknowledged_at: item.acknowledged_at,
    });
    build_session_detail(&snapshot, session_id, blocker_ack.as_ref()).ok_or(StatusCode::NOT_FOUND)
}

fn select_resume_intent(detail: &SessionDetailSnapshot) -> Option<ControlIntent> {
    let session = &detail.session;
    if matches!(
        session.state,
        helloloop_domain::SessionState::Running
            | helloloop_domain::SessionState::Completed
            | helloloop_domain::SessionState::FailedTerminal
            | helloloop_domain::SessionState::HumanInputRequired
    ) {
        return None;
    }

    if session.role == "supervisor" && session.lane.is_empty() {
        return Some(ControlIntent::RunLoop);
    }

    if matches!(
        session.state,
        helloloop_domain::SessionState::WaitingDependency
            | helloloop_domain::SessionState::WaitingExternalSignal
    ) && detail.ready_tasks.is_empty()
    {
        return Some(ControlIntent::RunLoop);
    }

    select_task_for_resume(detail).map(|task_id| ControlIntent::RunOnce { task_id })
}

fn select_retry_intent(detail: &SessionDetailSnapshot) -> Option<ControlIntent> {
    let session = &detail.session;
    if !matches!(
        session.state,
        helloloop_domain::SessionState::RetryScheduled
            | helloloop_domain::SessionState::RateLimited
            | helloloop_domain::SessionState::FailedRecoverable
            | helloloop_domain::SessionState::WaitingExternalSignal
    ) {
        return None;
    }

    if session.role == "supervisor" && session.lane.is_empty() {
        return Some(ControlIntent::RunLoop);
    }

    detail
        .running_tasks
        .first()
        .or_else(|| detail.blocked_tasks.first())
        .or_else(|| detail.ready_tasks.first())
        .or_else(|| detail.related_tasks.first())
        .map(|task| ControlIntent::RunOnce {
            task_id: task.id.clone(),
        })
}

fn select_rerun_analysis_intent(detail: &SessionDetailSnapshot) -> Option<ControlIntent> {
    if matches!(
        detail.session.state,
        helloloop_domain::SessionState::Running
    ) {
        return None;
    }
    Some(ControlIntent::Analyze {
        docs_path: None,
        engine: None,
        dry_run: true,
    })
}

fn select_task_for_resume(detail: &SessionDetailSnapshot) -> Option<String> {
    detail
        .ready_tasks
        .first()
        .or_else(|| detail.running_tasks.first())
        .or_else(|| detail.blocked_tasks.first())
        .or_else(|| detail.related_tasks.first())
        .map(|task| task.id.clone())
}

fn map_control_error(error: ControlLaunchError) -> StatusCode {
    match error {
        ControlLaunchError::ProcessFailed { .. } => StatusCode::BAD_GATEWAY,
        ControlLaunchError::Io(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

async fn launch_session_control(
    state: &ApiState,
    session_id: &str,
    action_key: &str,
    event_type: &str,
    intent_selector: fn(&SessionDetailSnapshot) -> Option<ControlIntent>,
) -> Result<Json<SessionControlResponse>, StatusCode> {
    let detail = load_session_detail(state, session_id).await?;
    let selection = state
        .current_workspace_selection()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::CONFLICT)?;
    let launcher = state
        .control_launcher_for_selection(&selection)
        .ok_or(StatusCode::CONFLICT)?;
    let intent = enrich_control_intent(
        intent_selector(&detail).ok_or(StatusCode::CONFLICT)?,
        &selection,
    );
    let launch_result = launcher.launch(intent).await.map_err(map_control_error)?;
    let _ = state.store.append_event(event_type).await;
    state.refresh.notify_one();

    Ok(Json(SessionControlResponse {
        accepted: true,
        action_key: action_key.to_string(),
        message: control_message(
            action_key,
            &launch_result.command_label,
            launch_result.task_id.as_deref(),
        ),
        command: launch_result.command_label,
        task_id: launch_result.task_id,
        acknowledged_at: None,
    }))
}

fn enrich_control_intent(
    intent: ControlIntent,
    selection: &HelloAppWorkspaceSelection,
) -> ControlIntent {
    match intent {
        ControlIntent::Analyze {
            docs_path,
            engine,
            dry_run,
        } => ControlIntent::Analyze {
            docs_path: docs_path.or_else(|| {
                (!selection.docs_path.trim().is_empty()).then_some(selection.docs_path.clone())
            }),
            engine: engine.or_else(|| {
                (!selection.preferred_engine.trim().is_empty())
                    .then_some(selection.preferred_engine.clone())
            }),
            dry_run,
        },
        other => other,
    }
}

async fn try_control_sequence(
    state: &ApiState,
    session_id: &str,
    strategies: &[(
        &'static str,
        &'static str,
        fn(&SessionDetailSnapshot) -> Option<ControlIntent>,
    )],
) -> Result<Json<SessionControlResponse>, StatusCode> {
    for (action_key, event_type, selector) in strategies {
        if let Ok(response) =
            launch_session_control(state, session_id, action_key, event_type, *selector).await
        {
            return Ok(response);
        }
    }
    Err(StatusCode::CONFLICT)
}

fn control_message(action_key: &str, command_label: &str, task_id: Option<&str>) -> String {
    match action_key {
        "retry_current" => match task_id {
            Some(task_id) => format!("retry requested for task {task_id}"),
            None => "retry requested for mainline".to_string(),
        },
        "rerun_analysis" => "analysis rerun requested".to_string(),
        _ => match command_label {
            "run-once" => format!(
                "resume requested for task {}",
                task_id.unwrap_or("unknown-task"),
            ),
            "analyze" => "analysis rerun requested".to_string(),
            _ => "resume requested for mainline".to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use helloloop_domain::{
        CommandCenterSnapshot, HostKind, SessionDetailSnapshot, SessionFailure, SessionSnapshot,
        SessionState, TaskSnapshot,
    };

    use super::{ControlIntent, select_rerun_analysis_intent, select_retry_intent};
    use crate::session_detail::build_session_detail;

    fn sample_detail(state: SessionState) -> SessionDetailSnapshot {
        let now = Utc::now();
        let tasks = vec![TaskSnapshot {
            id: "task-a".to_string(),
            title: "Recover current lane".to_string(),
            stage: "implementation".to_string(),
            owner_role: "developer".to_string(),
            state,
            lane: "lane-a".to_string(),
            priority: "p1".to_string(),
            depends_on: Vec::new(),
        }];
        let mut session = SessionSnapshot::new(
            "Recover lane",
            HostKind::Codex,
            "developer",
            state,
            "Recover current lane",
            "Finalize lane",
        );
        session.id = "session-a".to_string();
        session.lane = "lane-a".to_string();
        session.failure = SessionFailure {
            code: "rate_limit".to_string(),
            label: "HTTP 429".to_string(),
            detail: "Transient capacity".to_string(),
            family: "recoverable".to_string(),
            http_status: Some(429),
            http_status_label: "HTTP 429".to_string(),
            retryable: true,
            retry_at: Some(now),
        };

        let snapshot = CommandCenterSnapshot {
            workspace_label: "HelloLoop".to_string(),
            methodology: "method".to_string(),
            orchestration_mode: "mode".to_string(),
            focus_summary: "focus".to_string(),
            updated_at: now,
            tasks,
            sessions: vec![session],
        };

        build_session_detail(&snapshot, "session-a", None).expect("detail")
    }

    #[test]
    fn retry_prefers_current_lane_task_for_recoverable_sessions() {
        let detail = sample_detail(SessionState::FailedRecoverable);
        let intent = select_retry_intent(&detail);
        assert!(matches!(intent, Some(ControlIntent::RunOnce { .. })));
    }

    #[test]
    fn rerun_analysis_is_disabled_for_running_sessions() {
        let detail = sample_detail(SessionState::Running);
        assert!(select_rerun_analysis_intent(&detail).is_none());
    }
}

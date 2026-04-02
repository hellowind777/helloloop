use std::path::{Path, PathBuf};

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use helloloop_domain::HelloAppWorkspaceSelection;
use helloloop_runtime::{ControlIntent, ControlLaunchError};
use helloloop_scheduler::command_center_from_node_snapshot;

use crate::ApiState;

#[derive(Debug, serde::Serialize)]
pub(crate) struct WorkspaceAnalyzeResponse {
    accepted: bool,
    command: String,
    message: String,
    repo_root: String,
    docs_path: String,
    preferred_engine: String,
}

pub(crate) async fn current_selection(
    State(state): State<ApiState>,
) -> Result<Json<HelloAppWorkspaceSelection>, StatusCode> {
    state
        .current_workspace_selection()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

pub(crate) async fn update_selection(
    State(state): State<ApiState>,
    Json(selection): Json<HelloAppWorkspaceSelection>,
) -> Result<Json<HelloAppWorkspaceSelection>, StatusCode> {
    let selection = validate_selection(selection)?;
    let saved = state
        .store
        .save_workspace_selection(&selection)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let snapshot = state
        .load_workspace_snapshot_for_selection(&saved)
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;

    state
        .store
        .replace(command_center_from_node_snapshot(&snapshot))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let _ = state
        .store
        .append_event("workspace_selection_updated")
        .await;
    state.refresh.notify_one();

    Ok(Json(saved))
}

pub(crate) async fn current_workspace(
    State(state): State<ApiState>,
) -> Result<Json<helloloop_runtime::NodeWorkspaceSnapshot>, StatusCode> {
    let selection = state
        .current_workspace_selection()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::CONFLICT)?;

    state
        .load_workspace_snapshot_for_selection(&selection)
        .await
        .map(Json)
        .map_err(|_| StatusCode::BAD_GATEWAY)
}

pub(crate) async fn analyze_current_workspace(
    State(state): State<ApiState>,
) -> Result<Json<WorkspaceAnalyzeResponse>, StatusCode> {
    let selection = state
        .current_workspace_selection()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::CONFLICT)?;
    if selection.docs_path.trim().is_empty() {
        return Err(StatusCode::CONFLICT);
    }

    let launcher = state
        .control_launcher_for_selection(&selection)
        .ok_or(StatusCode::CONFLICT)?;
    let launch_result = launcher
        .launch(ControlIntent::Analyze {
            docs_path: Some(selection.docs_path.clone()),
            engine: Some(selection.preferred_engine.clone()),
            dry_run: true,
        })
        .await
        .map_err(map_control_error)?;

    let _ = state
        .store
        .append_event("workspace_analysis_requested")
        .await;
    state.refresh.notify_one();

    Ok(Json(WorkspaceAnalyzeResponse {
        accepted: true,
        command: launch_result.command_label,
        message: "workspace analysis requested".to_string(),
        repo_root: selection.repo_root,
        docs_path: selection.docs_path,
        preferred_engine: selection.preferred_engine,
    }))
}

fn validate_selection(
    selection: HelloAppWorkspaceSelection,
) -> Result<HelloAppWorkspaceSelection, StatusCode> {
    let mut normalized = selection.normalized();
    if !normalized.is_configured() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let repo_root = resolve_path(&normalized.repo_root, None);
    if !repo_root.is_dir() {
        return Err(StatusCode::BAD_REQUEST);
    }
    normalized.repo_root = repo_root.display().to_string();

    if normalized.docs_path.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let docs_path = resolve_path(&normalized.docs_path, Some(&repo_root));
    if !docs_path.exists() {
        return Err(StatusCode::BAD_REQUEST);
    }
    normalized.docs_path = docs_path.display().to_string();

    Ok(normalized)
}

fn resolve_path(value: &str, base: Option<&Path>) -> PathBuf {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        return path;
    }

    match base {
        Some(base) => base.join(path),
        None => std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path),
    }
}

fn map_control_error(error: ControlLaunchError) -> StatusCode {
    match error {
        ControlLaunchError::ProcessFailed { .. } => StatusCode::BAD_GATEWAY,
        ControlLaunchError::Io(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use helloloop_domain::{
    DaemonContext, DaemonHealth, HelloAppWorkspaceSelection, SessionDetailSnapshot,
};
use helloloop_runtime::{
    ControlLauncher, HostDescriptor, RuntimeRegistry, WorkspaceBridgeOptions,
    load_workspace_snapshot,
};
use helloloop_store::BootstrapStore;
use serde::{Deserialize, Serialize};
use tokio::sync::{Notify, watch};
use tokio_stream::StreamExt;
use tokio_stream::wrappers::WatchStream;

mod control;
mod frontend;
mod session_actions;
mod session_detail;
mod settings;
mod workspaces;

#[derive(Clone)]
pub struct ApiState {
    store: BootstrapStore,
    runtime: RuntimeRegistry,
    tool_root: Option<PathBuf>,
    default_workspace: Option<HelloAppWorkspaceSelection>,
    node_executable: String,
    shutdown: watch::Sender<bool>,
    refresh: Arc<Notify>,
    listen_addr: String,
    started_at: chrono::DateTime<Utc>,
    context: DaemonContext,
}

impl ApiState {
    pub fn new(
        store: BootstrapStore,
        runtime: RuntimeRegistry,
        tool_root: Option<PathBuf>,
        default_workspace: Option<HelloAppWorkspaceSelection>,
        node_executable: String,
        shutdown: watch::Sender<bool>,
        refresh: Arc<Notify>,
        listen_addr: String,
        context: DaemonContext,
    ) -> Self {
        Self {
            store,
            runtime,
            tool_root,
            default_workspace,
            node_executable,
            shutdown,
            refresh,
            listen_addr,
            started_at: Utc::now(),
            context,
        }
    }

    pub async fn current_workspace_selection(
        &self,
    ) -> Result<Option<HelloAppWorkspaceSelection>, sqlx::Error> {
        let stored = self.store.workspace_selection().await?;
        Ok(stored
            .filter(HelloAppWorkspaceSelection::is_configured)
            .or_else(|| self.default_workspace.clone()))
    }

    pub fn bridge_options_for_selection(
        &self,
        selection: &HelloAppWorkspaceSelection,
    ) -> Option<WorkspaceBridgeOptions> {
        let tool_root = self.tool_root.clone()?;
        Some(WorkspaceBridgeOptions {
            tool_root,
            repo_root: PathBuf::from(&selection.repo_root),
            config_dir_name: selection.config_dir_name.clone(),
            node_executable: self.node_executable.clone(),
        })
    }

    pub fn control_launcher_for_selection(
        &self,
        selection: &HelloAppWorkspaceSelection,
    ) -> Option<ControlLauncher> {
        let tool_root = self.tool_root.clone()?;
        Some(ControlLauncher {
            tool_root,
            workspace_root: PathBuf::from(&selection.repo_root),
            config_dir_name: selection.config_dir_name.clone(),
            node_executable: self.node_executable.clone(),
        })
    }

    pub async fn load_workspace_snapshot_for_selection(
        &self,
        selection: &HelloAppWorkspaceSelection,
    ) -> Result<helloloop_runtime::NodeWorkspaceSnapshot, String> {
        let options = self
            .bridge_options_for_selection(selection)
            .ok_or_else(|| "workspace bridge unavailable".to_string())?;
        load_workspace_snapshot(&options)
            .await
            .map_err(|error| error.to_string())
    }

    async fn effective_health_context(&self) -> DaemonContext {
        let mut context = self.context.clone();
        if let Ok(Some(selection)) = self.current_workspace_selection().await {
            context.workspace_root = Some(selection.repo_root.clone());
            context.config_dir_name = selection.config_dir_name;
            if self.tool_root.is_some() {
                context.bridge_mode = "node_workspace_bridge".to_string();
                context.bootstrap_source = "workspace_selection".to_string();
            }
        }
        context
    }
}

#[derive(Debug, Serialize)]
struct ShutdownResponse {
    accepted: bool,
    message: &'static str,
}

#[derive(Debug, Serialize)]
struct RefreshResponse {
    accepted: bool,
    message: &'static str,
}

#[derive(Debug, Deserialize)]
struct RecentEventsQuery {
    limit: Option<usize>,
}

pub fn build_router(state: ApiState) -> Router {
    Router::new()
        .route("/", get(frontend::app_redirect))
        .route("/app", get(frontend::app_redirect))
        .route("/app/", get(frontend::app_shell))
        .route("/app/{asset}", get(frontend::app_asset))
        .route("/healthz", get(healthz))
        .route("/api/v1/command-center", get(command_center))
        .route(
            "/api/v1/workspaces/selection",
            get(workspaces::current_selection).put(workspaces::update_selection),
        )
        .route(
            "/api/v1/workspaces/current",
            get(workspaces::current_workspace),
        )
        .route(
            "/api/v1/workspaces/current/analyze",
            post(workspaces::analyze_current_workspace),
        )
        .route("/api/v1/sessions/{session_id}", get(session_detail))
        .route("/api/v1/events", get(events))
        .route("/api/v1/events/recent", get(recent_events))
        .route("/api/v1/hosts", get(hosts))
        .route(
            "/api/v1/settings",
            get(settings::get_settings).put(settings::update_settings),
        )
        .route("/api/v1/control/refresh", post(refresh))
        .route("/api/v1/control/pause-mainline", post(control::pause_mainline))
        .route(
            "/api/v1/control/continue-mainline",
            post(control::continue_mainline),
        )
        .route(
            "/api/v1/control/recover-first",
            post(control::recover_first),
        )
        .route(
            "/api/v1/control/sessions/{session_id}/resume",
            post(control::resume_session),
        )
        .route(
            "/api/v1/control/sessions/{session_id}/retry-current",
            post(control::retry_current),
        )
        .route(
            "/api/v1/control/sessions/{session_id}/rerun-analysis",
            post(control::rerun_analysis),
        )
        .route(
            "/api/v1/control/sessions/{session_id}/ack-blocker",
            post(control::ack_blocker),
        )
        .route("/api/v1/control/shutdown", post(shutdown))
        .with_state(state)
}

async fn healthz(State(state): State<ApiState>) -> Json<DaemonHealth> {
    let listen_addr = state.listen_addr.clone();
    let context = state.effective_health_context().await;
    Json(DaemonHealth {
        service: "hello-daemon".to_string(),
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        pid: std::process::id(),
        listen_addr,
        started_at: state.started_at,
        checked_at: Utc::now(),
        context,
    })
}

async fn command_center(
    State(state): State<ApiState>,
) -> Json<helloloop_domain::CommandCenterSnapshot> {
    Json(state.store.snapshot().await)
}

async fn session_detail(
    State(state): State<ApiState>,
    Path(session_id): Path<String>,
) -> Result<Json<SessionDetailSnapshot>, StatusCode> {
    control::load_session_detail(&state, &session_id)
        .await
        .map(Json)
}

async fn events(
    State(state): State<ApiState>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let stream = WatchStream::new(state.store.subscribe()).map(|snapshot| {
        let data = serde_json::to_string(&snapshot).unwrap_or_else(|_| "{}".to_string());
        Ok(Event::default().event("command_center").data(data))
    });

    Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn recent_events(
    State(state): State<ApiState>,
    Query(query): Query<RecentEventsQuery>,
) -> Result<Json<Vec<helloloop_domain::CommandCenterEventRecord>>, StatusCode> {
    let limit = query.limit.unwrap_or(20).clamp(1, 200);
    state
        .store
        .recent_events(limit)
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn hosts(State(state): State<ApiState>) -> Json<Vec<HostDescriptor>> {
    Json(state.runtime.descriptors())
}

async fn refresh(State(state): State<ApiState>) -> Json<RefreshResponse> {
    state.refresh.notify_one();
    let _ = state.store.append_event("control_refresh_requested").await;
    Json(RefreshResponse {
        accepted: true,
        message: "refresh requested",
    })
}

async fn shutdown(State(state): State<ApiState>) -> Json<ShutdownResponse> {
    let _ = state.shutdown.send(true);
    Json(ShutdownResponse {
        accepted: true,
        message: "shutdown requested",
    })
}

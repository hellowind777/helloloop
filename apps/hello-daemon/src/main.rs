use std::env;
use std::error::Error;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use helloloop_api::ApiState;
use helloloop_domain::{DaemonContext, HelloAppWorkspaceSelection};
use helloloop_runtime::{
    RuntimeRegistry, WorkspaceBridgeOptions, bind_preferred_listener, clear_active_daemon_record,
    detect_tool_root, load_workspace_snapshot, persist_active_daemon_record,
};
use helloloop_scheduler::{build_bootstrap_snapshot, command_center_from_node_snapshot};
use helloloop_store::BootstrapStore;
use tokio::sync::{Notify, watch};
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

const REFRESH_INTERVAL_SECONDS: u64 = 5;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_target(false)
        .compact()
        .init();

    let workspace_root = env::var("HELLO_WORKSPACE").ok();
    let config_dir_name =
        env::var("HELLO_CONFIG_DIR_NAME").unwrap_or_else(|_| ".helloloop".to_string());
    let node_executable = env::var("HELLO_NODE_BIN").unwrap_or_else(|_| "node".to_string());
    let tool_root = detect_tool_root();
    let default_workspace = workspace_root.as_ref().map(|workspace_root| {
        HelloAppWorkspaceSelection {
            repo_root: workspace_root.clone(),
            docs_path: String::new(),
            config_dir_name: config_dir_name.clone(),
            preferred_engine: "codex".to_string(),
        }
        .normalized()
    });
    let initial_snapshot = if let (Some(tool_root), Some(workspace_root)) =
        (tool_root.clone(), workspace_root.clone())
    {
        let bridge_options = WorkspaceBridgeOptions {
            tool_root,
            repo_root: PathBuf::from(&workspace_root),
            config_dir_name: config_dir_name.clone(),
            node_executable: node_executable.clone(),
        };
        match load_workspace_snapshot(&bridge_options).await {
            Ok(snapshot) => {
                info!(
                    "workspace bridge bootstrap succeeded: repo={} tasks={} engine={}",
                    snapshot.repo_root,
                    snapshot.tasks.len(),
                    snapshot.engine
                );
                command_center_from_node_snapshot(&snapshot)
            }
            Err(error) => {
                warn!("workspace bridge bootstrap failed: {}", error);
                build_bootstrap_snapshot(Some(&workspace_root))
            }
        }
    } else {
        build_bootstrap_snapshot(workspace_root.as_deref())
    };
    let db_path = resolve_db_path(workspace_root.as_deref());
    info!(
        "hello-daemon bootstrap: workspace_root={:?} tool_root={:?} db_path={:?}",
        workspace_root, tool_root, db_path
    );
    let store = BootstrapStore::new(initial_snapshot, db_path.as_deref()).await?;
    let runtime = RuntimeRegistry::new(vec![
        helloloop_host_codex::descriptor(),
        helloloop_host_claude::descriptor(),
        helloloop_host_gemini::descriptor(),
    ]);

    let bind_override = env::var("HELLO_DAEMON_BIND").ok();
    let (listener, local_addr, bind_source) =
        bind_preferred_listener(bind_override.as_deref()).await?;
    let active_record_path =
        persist_active_daemon_record(&local_addr, std::process::id(), workspace_root.as_deref())
            .await
            .ok()
            .map(|path| path.display().to_string());
    if bind_source == "fallback_scan" {
        warn!(
            "default daemon port unavailable, fell back to alternate listener {}",
            local_addr
        );
    }
    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);
    let refresh_signal = Arc::new(Notify::new());
    let context = DaemonContext {
        workspace_root: workspace_root.clone(),
        tool_root: tool_root.as_ref().map(|path| path.display().to_string()),
        db_path: db_path.as_ref().map(|path| path.display().to_string()),
        config_dir_name: config_dir_name.clone(),
        bridge_mode: if workspace_root.is_some() && tool_root.is_some() {
            "node_workspace_bridge".to_string()
        } else {
            "bootstrap_snapshot".to_string()
        },
        bootstrap_source: if workspace_root.is_some() && tool_root.is_some() {
            "workspace_snapshot".to_string()
        } else {
            "bootstrap_scaffold".to_string()
        },
        refresh_interval_seconds: REFRESH_INTERVAL_SECONDS,
        bind_source,
        active_record_path,
    };

    let state = ApiState::new(
        store.clone(),
        runtime,
        tool_root.clone(),
        default_workspace.clone(),
        node_executable.clone(),
        shutdown_tx,
        refresh_signal.clone(),
        local_addr.clone(),
        context,
    );
    let app = helloloop_api::build_router(state);
    let heartbeat_store = store.clone();
    let refresh_tool_root = tool_root.clone();
    let refresh_default_workspace = default_workspace.clone();
    let refresh_node_executable = node_executable.clone();
    let refresh_listener = refresh_signal.clone();
    let heartbeat_task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(REFRESH_INTERVAL_SECONDS));
        loop {
            tokio::select! {
                _ = interval.tick() => {}
                _ = refresh_listener.notified() => {}
            }
            let selected_workspace = heartbeat_store
                .workspace_selection()
                .await
                .ok()
                .flatten()
                .filter(HelloAppWorkspaceSelection::is_configured)
                .or_else(|| refresh_default_workspace.clone());
            if let (Some(tool_root), Some(selection)) =
                (refresh_tool_root.clone(), selected_workspace)
            {
                let bridge_options = WorkspaceBridgeOptions {
                    tool_root,
                    repo_root: PathBuf::from(&selection.repo_root),
                    config_dir_name: selection.config_dir_name.clone(),
                    node_executable: refresh_node_executable.clone(),
                };
                match load_workspace_snapshot(&bridge_options).await {
                    Ok(snapshot) => {
                        info!(
                            "workspace bridge refresh succeeded: repo={} tasks={} engine={}",
                            snapshot.repo_root,
                            snapshot.tasks.len(),
                            snapshot.engine
                        );
                        if let Err(error) = heartbeat_store
                            .replace(command_center_from_node_snapshot(&snapshot))
                            .await
                        {
                            warn!("failed to persist refreshed snapshot: {}", error);
                        }
                    }
                    Err(error) => {
                        warn!("workspace bridge refresh failed: {}", error);
                        if let Err(store_error) = heartbeat_store.touch_heartbeat().await {
                            warn!("failed to persist heartbeat fallback: {}", store_error);
                        }
                    }
                }
            } else if let Err(error) = heartbeat_store.touch_heartbeat().await {
                warn!("failed to persist heartbeat: {}", error);
            }
        }
    });

    info!("hello-daemon listening on {}", local_addr);
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {},
                result = shutdown_rx.changed() => {
                    let _ = result;
                }
            }
        })
        .await?;

    heartbeat_task.abort();
    let _ = clear_active_daemon_record(&local_addr, std::process::id()).await;
    Ok(())
}

fn resolve_db_path(workspace_root: Option<&str>) -> Option<PathBuf> {
    if let Ok(path) = env::var("HELLO_DAEMON_DB") {
        return Some(PathBuf::from(path));
    }

    workspace_root.map(|root| {
        PathBuf::from(root)
            .join(".helloloop")
            .join("hello-daemon.db")
    })
}

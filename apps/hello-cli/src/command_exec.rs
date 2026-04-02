use std::error::Error;
use std::process::{Command, Stdio};
use std::time::Duration;

use helloloop_domain::{
    CommandCenterSnapshot, HelloAppWorkspaceSelection, SessionAction, SessionSnapshot,
};
use helloloop_runtime::active_daemon_record_path;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::api::{
    app_url, daemon_url, fetch_command_center, fetch_health, fetch_optional_json_at,
    fetch_session_detail, local_http_client, post_control, put_json_at,
};
use crate::command_options::{ConnectOptions, DaemonLaunchOptions, ExportOptions, RecoverOptions};
use crate::command_support::{apply_windows_hidden_flags, daemon_binary_path, open_app_target};

#[derive(Debug, Serialize, Deserialize)]
struct SessionControlResponse {
    accepted: bool,
    action_key: String,
    message: String,
    command: String,
    task_id: Option<String>,
    acknowledged_at: Option<String>,
}

pub async fn run_doctor(as_json: bool) -> Result<(), Box<dyn Error>> {
    let daemon_binary = daemon_binary_path();
    let health = fetch_health().await.ok();

    if as_json {
        let payload = serde_json::json!({
            "daemon_url": daemon_url(),
            "app_url": app_url(),
            "active_record": active_daemon_record_path(),
            "daemon_binary": daemon_binary,
            "daemon_reachable": health.is_some(),
            "health": health,
        });
        println!("{}", serde_json::to_string_pretty(&payload)?);
        return Ok(());
    }

    println!("daemon url: {}", daemon_url());
    println!("app url: {}", app_url());
    println!("active record: {}", active_daemon_record_path().display());
    println!("daemon binary: {}", daemon_binary.display());
    match health {
        Some(snapshot) => {
            println!("daemon: reachable");
            println!("status: {}", snapshot.status);
            println!("listen: {}", snapshot.listen_addr);
        }
        None => println!("daemon: unreachable"),
    }
    Ok(())
}

pub async fn show_daemon_status(as_json: bool) -> Result<(), Box<dyn Error>> {
    let health = fetch_health().await?;
    let snapshot = fetch_command_center().await?;

    if as_json {
        let payload = serde_json::json!({
            "app_url": app_url(),
            "health": health,
            "command_center": snapshot,
        });
        println!("{}", serde_json::to_string_pretty(&payload)?);
        return Ok(());
    }

    println!("daemon: {}", health.status);
    println!("app: {}", app_url());
    println!("listen: {}", health.listen_addr);
    println!("bind source: {}", health.context.bind_source.as_str());
    println!("workspace: {}", snapshot.workspace_label);
    println!("sessions: {}", snapshot.sessions.len());
    println!("tasks: {}", snapshot.tasks.len());
    println!("updated_at: {}", snapshot.updated_at);
    Ok(())
}

pub async fn start_daemon(options: DaemonLaunchOptions) -> Result<(), Box<dyn Error>> {
    if fetch_health().await.is_ok() {
        println!("hello-daemon is already running");
        return Ok(());
    }

    let daemon_binary = daemon_binary_path();
    let mut command = Command::new(&daemon_binary);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(workspace) = &options.workspace {
        command.env("HELLO_WORKSPACE", workspace);
    }
    if let Some(tool_root) = &options.tool_root {
        command.env("HELLO_TOOL_ROOT", tool_root);
    }
    if let Some(db) = &options.db {
        command.env("HELLO_DAEMON_DB", db);
    }
    if let Some(bind) = &options.bind {
        command.env("HELLO_DAEMON_BIND", bind);
    }
    if let Some(node_bin) = &options.node_bin {
        command.env("HELLO_NODE_BIN", node_bin);
    }
    if let Some(config_dir_name) = &options.config_dir_name {
        command.env("HELLO_CONFIG_DIR_NAME", config_dir_name);
    }
    apply_windows_hidden_flags(&mut command);
    command.spawn()?;

    for _ in 0..20 {
        tokio::time::sleep(Duration::from_millis(250)).await;
        if fetch_health().await.is_ok() {
            let health = fetch_health().await?;
            println!("hello-daemon started");
            println!("daemon url: http://{}", health.listen_addr);
            return Ok(());
        }
    }

    Err(format!(
        "hello-daemon did not become ready: {}",
        daemon_binary.display()
    )
    .into())
}

pub async fn open_app() -> Result<(), Box<dyn Error>> {
    let opened = open_app_target()?;
    println!("opened {opened}");
    Ok(())
}

pub async fn connect(options: ConnectOptions) -> Result<(), Box<dyn Error>> {
    let mut selection = fetch_optional_json_at::<HelloAppWorkspaceSelection>(
        "/api/v1/workspaces/selection",
        &[404],
    )
    .await?
    .unwrap_or_default()
    .normalized();

    if let Some(workspace) = &options.workspace {
        selection.repo_root = workspace.clone();
    }
    if let Some(docs) = &options.docs {
        selection.docs_path = docs.clone();
    }
    if let Some(engine) = &options.engine {
        selection.preferred_engine = engine.clone();
    }
    if let Some(config_dir_name) = &options.config_dir_name {
        selection.config_dir_name = config_dir_name.clone();
    }
    selection = selection.normalized();

    let should_save_selection = options.workspace.is_some()
        || options.docs.is_some()
        || options.engine.is_some()
        || options.config_dir_name.is_some();
    let saved_selection = if should_save_selection {
        Some(
            put_json_at::<HelloAppWorkspaceSelection, _>(
                "/api/v1/workspaces/selection",
                &selection,
            )
            .await?,
        )
    } else if selection.is_configured() {
        Some(selection.clone())
    } else {
        None
    };

    let analyze_response = if options.analyze {
        Some(post_control::<Value>("/api/v1/workspaces/current/analyze").await?)
    } else {
        None
    };
    let health = fetch_health().await.ok();
    let snapshot = fetch_command_center().await.ok();

    if options.open {
        let _ = open_app_target()?;
    }

    if options.as_json {
        let payload = serde_json::json!({
            "daemon_url": daemon_url(),
            "app_url": app_url(),
            "open_requested": options.open,
            "workspace_selection": saved_selection,
            "analysis": analyze_response,
            "health": health,
            "command_center": snapshot,
        });
        println!("{}", serde_json::to_string_pretty(&payload)?);
        return Ok(());
    }

    println!("daemon: {}", daemon_url());
    println!("app: {}", app_url());
    println!(
        "status: {}",
        health
            .as_ref()
            .map(|item| item.status.as_str())
            .unwrap_or("unreachable")
    );
    if let Some(selection) = saved_selection {
        println!("repo_root: {}", selection.repo_root);
        println!("docs_path: {}", selection.docs_path);
        println!("preferred_engine: {}", selection.preferred_engine);
    }
    if let Some(snapshot) = snapshot {
        println!("workspace: {}", snapshot.workspace_label);
        println!("sessions: {}", snapshot.sessions.len());
        println!("tasks: {}", snapshot.tasks.len());
    }
    if let Some(result) = analyze_response {
        println!(
            "analysis: {}",
            result["message"].as_str().unwrap_or("submitted")
        );
    }
    if options.open {
        println!("browser: opened");
    }
    Ok(())
}

pub async fn stop_daemon() -> Result<(), Box<dyn Error>> {
    let client = local_http_client()?;
    let response = client
        .post(format!("{}/api/v1/control/shutdown", daemon_url()))
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(format!("daemon stop failed: {}", response.status()).into());
    }

    println!("hello-daemon stop requested");
    Ok(())
}

pub async fn recover_session(options: RecoverOptions) -> Result<(), Box<dyn Error>> {
    let snapshot = fetch_command_center().await?;
    let session = resolve_target_session(&snapshot, options.session_id.as_deref())
        .ok_or("no recoverable session available")?;
    let detail = fetch_session_detail(&session.id).await?;

    let action = resolve_target_action(&detail.available_actions, options.action_key.as_deref())
        .ok_or("no implemented recovery action available")?;
    let response: SessionControlResponse = post_control(&action.endpoint).await?;

    if options.as_json {
        let payload = serde_json::json!({
            "session_id": session.id,
            "session_title": session.title,
            "action": action,
            "response": response,
        });
        println!("{}", serde_json::to_string_pretty(&payload)?);
        return Ok(());
    }

    println!("session: {} ({})", session.title, session.id);
    println!("action: {}", action.key);
    println!("message: {}", response.message);
    Ok(())
}

pub async fn export_snapshot(options: ExportOptions) -> Result<(), Box<dyn Error>> {
    let snapshot = fetch_command_center().await?;
    let output = if options.pretty {
        serde_json::to_string_pretty(&snapshot)?
    } else {
        serde_json::to_string(&snapshot)?
    };
    std::fs::write(&options.out_file, output)?;
    println!("exported snapshot to {}", options.out_file);
    Ok(())
}

fn resolve_target_session<'a>(
    snapshot: &'a CommandCenterSnapshot,
    requested_session_id: Option<&str>,
) -> Option<&'a SessionSnapshot> {
    if let Some(session_id) = requested_session_id {
        return snapshot
            .sessions
            .iter()
            .find(|session| session.id == session_id);
    }

    snapshot
        .sessions
        .iter()
        .find(|session| {
            !matches!(
                session.state,
                helloloop_domain::SessionState::Running | helloloop_domain::SessionState::Completed
            )
        })
        .or_else(|| snapshot.sessions.first())
}

fn resolve_target_action<'a>(
    actions: &'a [SessionAction],
    requested_action_key: Option<&str>,
) -> Option<&'a SessionAction> {
    if let Some(action_key) = requested_action_key {
        return actions.iter().find(|action| {
            action.key == action_key && action.implemented && action.method == "POST"
        });
    }

    for priority in [
        "retry_current",
        "resume_session",
        "rerun_analysis",
        "ack_blocker",
    ] {
        if let Some(action) = actions
            .iter()
            .find(|action| action.key == priority && action.implemented && action.method == "POST")
        {
            return Some(action);
        }
    }

    actions
        .iter()
        .find(|action| action.implemented && action.method == "POST")
}

#[cfg(test)]
mod tests {
    use helloloop_domain::SessionState;

    use super::resolve_target_action;

    #[test]
    fn action_priority_prefers_retry_then_resume() {
        let actions = vec![
            helloloop_domain::SessionAction {
                key: "resume_session".to_string(),
                label: String::new(),
                method: "POST".to_string(),
                endpoint: String::new(),
                kind: String::new(),
                implemented: true,
                reason: String::new(),
            },
            helloloop_domain::SessionAction {
                key: "retry_current".to_string(),
                label: String::new(),
                method: "POST".to_string(),
                endpoint: String::new(),
                kind: String::new(),
                implemented: true,
                reason: String::new(),
            },
        ];

        let action = resolve_target_action(&actions, None).expect("action");
        assert_eq!(action.key, "retry_current");
        assert_ne!(SessionState::Completed, SessionState::Ready);
    }
}

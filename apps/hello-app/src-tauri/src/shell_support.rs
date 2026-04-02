use std::env;
use std::error::Error;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use helloloop_runtime::{daemon_url_hint, local_daemon_http_client, resolve_reachable_daemon_url};
use reqwest::Client;
use serde::Deserialize;

#[derive(Clone, Deserialize)]
pub struct CommandCenterSnapshot {
    pub workspace_label: String,
    pub focus_summary: String,
    pub sessions: Vec<CommandSession>,
}

#[derive(Clone, Deserialize)]
pub struct CommandSession {
    pub state: String,
}

#[derive(Clone, Deserialize)]
pub struct HealthSnapshot {
    pub context: HealthContext,
}

#[derive(Clone, Deserialize)]
pub struct HealthContext {
    pub workspace_root: Option<String>,
    pub db_path: Option<String>,
}

#[derive(Clone)]
pub struct TraySummary {
    pub workspace_label: String,
    pub focus_summary: String,
    pub session_count: usize,
    pub blocked_count: usize,
}

pub async fn fetch_tray_summary() -> Result<TraySummary, Box<dyn Error>> {
    let client = local_http_client();
    let snapshot: CommandCenterSnapshot = client
        .get(format!(
            "{}/api/v1/command-center",
            current_daemon_url(&client).await
        ))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let blocked_count = snapshot
        .sessions
        .iter()
        .filter(|session| !matches!(session.state.as_str(), "ready" | "running" | "completed"))
        .count();

    Ok(TraySummary {
        workspace_label: snapshot.workspace_label,
        focus_summary: snapshot.focus_summary,
        session_count: snapshot.sessions.len(),
        blocked_count,
    })
}

pub async fn current_workspace_dir() -> Option<PathBuf> {
    if let Ok(value) = env::var("HELLO_WORKSPACE") {
        return Some(PathBuf::from(value));
    }

    fetch_health()
        .await
        .ok()
        .and_then(|health| health.context.workspace_root.map(PathBuf::from))
}

pub async fn logs_dir() -> Option<PathBuf> {
    if let Some(path) = fetch_health()
        .await
        .ok()
        .and_then(|health| health.context.db_path.map(PathBuf::from))
    {
        return path.parent().map(Path::to_path_buf);
    }

    current_workspace_dir()
        .await
        .map(|path| path.join(".helloloop"))
}

pub async fn ensure_daemon_ready() -> Result<(), Box<dyn Error>> {
    if daemon_reachable().await {
        return Ok(());
    }

    spawn_daemon()?;
    for _ in 0..40 {
        tokio::time::sleep(Duration::from_millis(250)).await;
        if daemon_reachable().await {
            return Ok(());
        }
    }

    Err("hello-daemon did not become ready".into())
}

pub async fn restart_daemon() -> Result<(), Box<dyn Error>> {
    let _ = control_post("/api/v1/control/shutdown").await;
    tokio::time::sleep(Duration::from_millis(600)).await;
    ensure_daemon_ready().await
}

pub async fn control_post(path: &str) -> Result<(), Box<dyn Error>> {
    let client = local_http_client();
    client
        .post(format!("{}{}", current_daemon_url(&client).await, path))
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

pub fn app_url() -> String {
    format!("{}/app/", daemon_url().trim_end_matches('/'))
}

pub fn open_path(path: &Path) -> Result<(), Box<dyn Error>> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg(path);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(path);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };

    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    apply_windows_hidden_flags(&mut command);
    command.spawn()?;
    Ok(())
}

pub fn daemon_url() -> String {
    env::var("HELLO_DAEMON_URL").unwrap_or_else(|_| daemon_url_hint())
}

async fn fetch_health() -> Result<HealthSnapshot, Box<dyn Error>> {
    let client = local_http_client();
    client
        .get(format!("{}/healthz", current_daemon_url(&client).await))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await
        .map_err(|error| error.into())
}

async fn daemon_reachable() -> bool {
    let client = local_http_client();
    resolve_reachable_daemon_url(&client).await.is_some()
}

fn local_http_client() -> Client {
    local_daemon_http_client(Duration::from_secs(2)).expect("reqwest client")
}

fn spawn_daemon() -> Result<(), Box<dyn Error>> {
    let daemon_binary = daemon_binary_path();
    let mut command = Command::new(&daemon_binary);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Ok(value) = env::var("HELLO_WORKSPACE") {
        command.env("HELLO_WORKSPACE", value);
    }
    if let Ok(value) = env::var("HELLO_TOOL_ROOT") {
        command.env("HELLO_TOOL_ROOT", value);
    }
    if let Ok(value) = env::var("HELLO_DAEMON_DB") {
        command.env("HELLO_DAEMON_DB", value);
    }
    if let Ok(value) = env::var("HELLO_DAEMON_BIND") {
        command.env("HELLO_DAEMON_BIND", value);
    }
    if let Ok(value) = env::var("HELLO_NODE_BIN") {
        command.env("HELLO_NODE_BIN", value);
    }
    if let Ok(value) = env::var("HELLO_CONFIG_DIR_NAME") {
        command.env("HELLO_CONFIG_DIR_NAME", value);
    }
    apply_windows_hidden_flags(&mut command);
    command.spawn()?;
    Ok(())
}

async fn current_daemon_url(client: &Client) -> String {
    if let Ok(url) = env::var("HELLO_DAEMON_URL") {
        return url;
    }

    resolve_reachable_daemon_url(client)
        .await
        .unwrap_or_else(daemon_url_hint)
}

fn daemon_binary_path() -> PathBuf {
    let file_name = if cfg!(windows) {
        "hello-daemon.exe"
    } else {
        "hello-daemon"
    };

    env::current_exe()
        .ok()
        .map(|path| path.with_file_name(file_name))
        .filter(|path| path.exists())
        .unwrap_or_else(|| PathBuf::from(file_name))
}

fn apply_windows_hidden_flags(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

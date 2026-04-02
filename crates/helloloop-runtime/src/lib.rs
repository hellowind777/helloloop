use std::path::{Path, PathBuf};
use std::process::Stdio;

use chrono::{DateTime, Utc};
use helloloop_domain::HostKind;
use serde::{Deserialize, Serialize};
use tokio::process::Command;

mod control_launch;
mod daemon_endpoint;

pub use control_launch::{ControlIntent, ControlLaunchError, ControlLaunchResult, ControlLauncher};
pub use daemon_endpoint::{
    DEFAULT_DAEMON_BIND, active_daemon_record_path, bind_preferred_listener,
    clear_active_daemon_record, daemon_url_hint, local_daemon_http_client,
    persist_active_daemon_record, resolve_reachable_daemon_url,
};

#[derive(Debug, Clone, Serialize)]
pub struct HostDescriptor {
    pub kind: HostKind,
    pub display_name: String,
    pub binary_candidates: Vec<String>,
    pub supports_background: bool,
    pub supports_streaming: bool,
    pub supports_worktree: bool,
    pub notes: String,
}

impl HostDescriptor {
    pub fn new(
        kind: HostKind,
        display_name: &str,
        binary_candidates: Vec<String>,
        supports_background: bool,
        supports_streaming: bool,
        supports_worktree: bool,
        notes: &str,
    ) -> Self {
        Self {
            kind,
            display_name: display_name.to_string(),
            binary_candidates,
            supports_background,
            supports_streaming,
            supports_worktree,
            notes: notes.to_string(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct RuntimeRegistry {
    descriptors: Vec<HostDescriptor>,
}

impl RuntimeRegistry {
    pub fn new(descriptors: Vec<HostDescriptor>) -> Self {
        Self { descriptors }
    }

    pub fn descriptors(&self) -> Vec<HostDescriptor> {
        self.descriptors.clone()
    }
}

#[derive(Debug, Clone)]
pub struct WorkspaceBridgeOptions {
    pub tool_root: PathBuf,
    pub repo_root: PathBuf,
    pub config_dir_name: String,
    pub node_executable: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeWorkspaceSnapshot {
    pub repo_root: String,
    pub repo_name: String,
    pub config_dir_name: String,
    pub engine: String,
    pub summary: NodeSummary,
    pub next_task: Option<NodeTask>,
    pub automation_next_task: Option<NodeTask>,
    pub tasks: Vec<NodeTask>,
    pub workflow: Option<NodeWorkflow>,
    pub doc_analysis: Option<NodeDocAnalysis>,
    pub supervisor: Option<NodeSupervisor>,
    pub latest_status: Option<NodeLatestStatus>,
    pub runtime: Option<NodeRuntime>,
    pub activity: Option<serde_json::Value>,
    pub status_model: Option<NodeStatusModel>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeSummary {
    pub total: u32,
    pub pending: u32,
    #[serde(rename = "inProgress")]
    pub in_progress: u32,
    pub done: u32,
    pub failed: u32,
    pub blocked: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeTask {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub stage: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub lane: String,
    #[serde(default)]
    pub priority: String,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub blocked_by: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeWorkflow {
    pub current_focus: Option<String>,
    pub mainline_summary: Option<String>,
    pub profile_label: Option<String>,
    #[serde(default)]
    pub methodology: Option<String>,
    #[serde(default)]
    pub profile: Option<String>,
    #[serde(default)]
    pub orchestration_mode: Option<String>,
    #[serde(default)]
    pub parallel_strategy: Option<String>,
    #[serde(default)]
    pub doc_coverage_summary: Option<String>,
    #[serde(default)]
    pub phase_order: Vec<String>,
    #[serde(default)]
    pub parallel_lanes: Vec<String>,
    #[serde(default)]
    pub coordination_rules: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeDocAnalysis {
    pub summary: Option<String>,
    #[serde(default)]
    pub entries: Vec<serde_json::Value>,
    #[serde(default)]
    pub gaps: Vec<String>,
    #[serde(default)]
    pub repo_profile: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeSupervisor {
    #[serde(default)]
    pub session_id: Option<String>,
    pub status: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub lease: Option<serde_json::Value>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub pid: Option<u32>,
    #[serde(default)]
    pub guardian_pid: Option<u32>,
    #[serde(default)]
    pub worker_pid: Option<u32>,
    #[serde(default)]
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub completed_at: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    pub updated_at: Option<String>,
    #[serde(default)]
    pub guardian_restart_count: Option<u32>,
    #[serde(default)]
    pub keep_alive_enabled: Option<bool>,
    #[serde(default)]
    pub pause_reason_code: Option<String>,
    #[serde(default)]
    pub stopped_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeLatestStatus {
    #[serde(default)]
    pub ok: Option<bool>,
    #[serde(default)]
    pub session_id: Option<String>,
    pub stage: Option<String>,
    #[serde(default)]
    pub task_id: Option<String>,
    pub task_title: Option<String>,
    #[serde(default)]
    pub run_dir: Option<String>,
    #[serde(default)]
    pub summary: Option<serde_json::Value>,
    #[serde(default)]
    pub message: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeRuntime {
    #[serde(default)]
    pub engine: Option<String>,
    #[serde(default)]
    pub engine_display_name: Option<String>,
    #[serde(default)]
    pub phase: Option<String>,
    #[serde(default)]
    pub output_prefix: Option<String>,
    #[serde(default)]
    pub hard_retry_budget: Option<u32>,
    #[serde(default)]
    pub soft_retry_budget: Option<u32>,
    #[serde(default)]
    pub attempt_prefix: Option<String>,
    #[serde(default)]
    pub recovery_count: Option<u32>,
    #[serde(default)]
    pub recovery_history: Vec<serde_json::Value>,
    #[serde(default)]
    pub heartbeat: Option<serde_json::Value>,
    #[serde(default)]
    pub activity_file: Option<String>,
    #[serde(default)]
    pub activity_events_file: Option<String>,
    pub status: Option<String>,
    pub updated_at: Option<String>,
    pub failure_code: Option<String>,
    pub failure_family: Option<String>,
    pub failure_reason: Option<String>,
    pub failure_http_status: Option<u16>,
    pub next_retry_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeFailure {
    pub code: Option<String>,
    pub family: Option<String>,
    pub label: Option<String>,
    pub detail: Option<String>,
    pub reason: Option<String>,
    pub http_status_code: Option<u16>,
    pub http_status_label: Option<String>,
    pub retryable: Option<bool>,
    pub next_retry_at: Option<String>,
    pub next_retry_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeWait {
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub label: Option<String>,
    pub detail: Option<String>,
    pub target_label: Option<String>,
    pub until: Option<String>,
    pub resumes_automatically: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeScheduler {
    pub state: Option<String>,
    pub label: Option<String>,
    pub mode: Option<String>,
    pub reason: Option<String>,
    pub detail: Option<String>,
    pub will_auto_resume: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeStatusModel {
    pub code: Option<String>,
    pub label: Option<String>,
    pub reason: Option<String>,
    pub detail: Option<String>,
    pub current_action: Option<String>,
    pub wait_target_label: Option<String>,
    pub auto_action: Option<String>,
    pub reason_code: Option<String>,
    pub severity: Option<String>,
    pub todo_progress: Option<String>,
    #[serde(default)]
    pub activity: Option<serde_json::Value>,
    pub failure: Option<NodeFailure>,
    pub wait: Option<NodeWait>,
    pub scheduler: Option<NodeScheduler>,
}

#[derive(Debug, thiserror::Error)]
pub enum BridgeError {
    #[error("node bridge process failed: {0}")]
    Process(String),
    #[error("node bridge returned invalid json: {0}")]
    InvalidJson(String),
}

pub async fn load_workspace_snapshot(
    options: &WorkspaceBridgeOptions,
) -> Result<NodeWorkspaceSnapshot, BridgeError> {
    let script_file = options
        .tool_root
        .join("scripts")
        .join("hello-app-workspace-snapshot.mjs");

    let mut command = Command::new(&options.node_executable);
    command
        .arg(script_file)
        .arg("--repo-root")
        .arg(&options.repo_root)
        .arg("--config-dir-name")
        .arg(&options.config_dir_name)
        .current_dir(&options.tool_root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_windows_hidden_flags(&mut command);

    let output = command
        .output()
        .await
        .map_err(|error| BridgeError::Process(error.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(BridgeError::Process(stderr));
    }

    serde_json::from_slice::<NodeWorkspaceSnapshot>(&output.stdout)
        .map_err(|error| BridgeError::InvalidJson(error.to_string()))
}

pub fn parse_timestamp(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| timestamp.with_timezone(&Utc))
}

pub fn detect_tool_root() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("HELLO_TOOL_ROOT") {
        let path = PathBuf::from(value);
        if path.exists() {
            return Some(path);
        }
    }

    std::env::current_exe()
        .ok()
        .and_then(|path| {
            path.ancestors().map(Path::to_path_buf).find(|candidate| {
                candidate.join("package.json").exists() && candidate.join("src").exists()
            })
        })
        .or_else(|| {
            std::env::current_dir().ok().and_then(|path| {
                if path.join("package.json").exists() && path.join("src").exists() {
                    Some(path)
                } else {
                    None
                }
            })
        })
}

fn apply_windows_hidden_flags(command: &mut Command) {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

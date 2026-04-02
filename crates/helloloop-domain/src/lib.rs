use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

mod settings;
mod workspace_selection;

pub use settings::HelloAppSettings;
pub use workspace_selection::HelloAppWorkspaceSelection;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HostKind {
    Codex,
    Claude,
    Gemini,
}

impl HostKind {
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Codex => "Codex CLI",
            Self::Claude => "Claude Code",
            Self::Gemini => "Gemini CLI",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Ready,
    Running,
    WaitingDependency,
    WaitingExternalSignal,
    RetryScheduled,
    RateLimited,
    HumanInputRequired,
    FailedRecoverable,
    FailedTerminal,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DaemonContext {
    #[serde(default)]
    pub workspace_root: Option<String>,
    #[serde(default)]
    pub tool_root: Option<String>,
    #[serde(default)]
    pub db_path: Option<String>,
    #[serde(default)]
    pub config_dir_name: String,
    #[serde(default)]
    pub bridge_mode: String,
    #[serde(default)]
    pub bootstrap_source: String,
    #[serde(default)]
    pub refresh_interval_seconds: u64,
    #[serde(default)]
    pub bind_source: String,
    #[serde(default)]
    pub active_record_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonHealth {
    pub service: String,
    pub status: String,
    pub version: String,
    pub pid: u32,
    pub listen_addr: String,
    pub started_at: DateTime<Utc>,
    pub checked_at: DateTime<Utc>,
    pub context: DaemonContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskSnapshot {
    pub id: String,
    pub title: String,
    pub stage: String,
    pub owner_role: String,
    pub state: SessionState,
    #[serde(default)]
    pub lane: String,
    #[serde(default)]
    pub priority: String,
    #[serde(default)]
    pub depends_on: Vec<String>,
}

impl TaskSnapshot {
    pub fn new(title: &str, stage: &str, owner_role: &str, state: SessionState) -> Self {
        Self {
            id: Uuid::now_v7().to_string(),
            title: title.to_string(),
            stage: stage.to_string(),
            owner_role: owner_role.to_string(),
            state,
            lane: String::new(),
            priority: String::new(),
            depends_on: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionScheduler {
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub detail: String,
    #[serde(default)]
    pub will_auto_resume: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionWait {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub detail: String,
    #[serde(default)]
    pub target_label: String,
    #[serde(default)]
    pub resumes_automatically: bool,
    #[serde(default)]
    pub until: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionFailure {
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub detail: String,
    #[serde(default)]
    pub family: String,
    #[serde(default)]
    pub http_status: Option<u16>,
    #[serde(default)]
    pub http_status_label: String,
    #[serde(default)]
    pub retryable: bool,
    #[serde(default)]
    pub retry_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSnapshot {
    pub id: String,
    pub title: String,
    pub host: HostKind,
    pub role: String,
    pub state: SessionState,
    pub reason_code: String,
    pub reason_label: String,
    pub http_status: Option<u16>,
    pub current_task: String,
    pub next_task: String,
    pub depends_on: Vec<String>,
    pub retry_at: Option<DateTime<Utc>>,
    pub session_started_at: DateTime<Utc>,
    pub last_heartbeat_at: DateTime<Utc>,
    #[serde(default)]
    pub reason_detail: String,
    #[serde(default)]
    pub auto_action: String,
    #[serde(default)]
    pub current_action: String,
    #[serde(default)]
    pub todo_progress: String,
    #[serde(default)]
    pub lane: String,
    #[serde(default)]
    pub severity: String,
    #[serde(default)]
    pub scheduler: SessionScheduler,
    #[serde(default)]
    pub wait: SessionWait,
    #[serde(default)]
    pub failure: SessionFailure,
}

impl SessionSnapshot {
    pub fn new(
        title: &str,
        host: HostKind,
        role: &str,
        state: SessionState,
        current_task: &str,
        next_task: &str,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::now_v7().to_string(),
            title: title.to_string(),
            host,
            role: role.to_string(),
            state,
            reason_code: "bootstrap".to_string(),
            reason_label: "Bootstrap scaffold".to_string(),
            http_status: None,
            current_task: current_task.to_string(),
            next_task: next_task.to_string(),
            depends_on: Vec::new(),
            retry_at: None,
            session_started_at: now,
            last_heartbeat_at: now,
            reason_detail: String::new(),
            auto_action: String::new(),
            current_action: String::new(),
            todo_progress: String::new(),
            lane: String::new(),
            severity: String::new(),
            scheduler: SessionScheduler::default(),
            wait: SessionWait::default(),
            failure: SessionFailure::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionAction {
    pub key: String,
    pub label: String,
    pub method: String,
    pub endpoint: String,
    pub kind: String,
    pub implemented: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionDetailSnapshot {
    pub session: SessionSnapshot,
    pub related_tasks: Vec<TaskSnapshot>,
    pub ready_tasks: Vec<TaskSnapshot>,
    pub running_tasks: Vec<TaskSnapshot>,
    pub blocked_tasks: Vec<TaskSnapshot>,
    pub completed_tasks: Vec<TaskSnapshot>,
    pub dependency_labels: Vec<String>,
    pub blocker_labels: Vec<String>,
    pub recovery_summary: String,
    pub next_action_summary: String,
    #[serde(default)]
    pub blocker_signature: String,
    #[serde(default)]
    pub blocker_acknowledged: bool,
    #[serde(default)]
    pub blocker_acknowledged_at: Option<DateTime<Utc>>,
    pub available_actions: Vec<SessionAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandCenterSnapshot {
    pub workspace_label: String,
    pub methodology: String,
    pub orchestration_mode: String,
    pub focus_summary: String,
    pub updated_at: DateTime<Utc>,
    pub tasks: Vec<TaskSnapshot>,
    pub sessions: Vec<SessionSnapshot>,
}

impl CommandCenterSnapshot {
    pub fn new(
        workspace_label: String,
        focus_summary: String,
        tasks: Vec<TaskSnapshot>,
        sessions: Vec<SessionSnapshot>,
    ) -> Self {
        Self {
            workspace_label,
            methodology: "hierarchical_role_based_agile_multi_agent_sdlc".to_string(),
            orchestration_mode: "central_supervisor".to_string(),
            focus_summary,
            updated_at: Utc::now(),
            tasks,
            sessions,
        }
    }

    pub fn touch_heartbeat(&mut self) {
        let now = Utc::now();
        self.updated_at = now;
        for session in &mut self.sessions {
            session.last_heartbeat_at = now;
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandCenterEventRecord {
    pub id: i64,
    pub event_type: String,
    pub payload: CommandCenterSnapshot,
    pub created_at: DateTime<Utc>,
}

use std::path::PathBuf;
use std::process::Stdio;

use tokio::process::Command;

#[derive(Debug, Clone)]
pub struct ControlLauncher {
    pub tool_root: PathBuf,
    pub workspace_root: PathBuf,
    pub config_dir_name: String,
    pub node_executable: String,
}

#[derive(Debug, Clone)]
pub enum ControlIntent {
    RunLoop,
    RunOnce {
        task_id: String,
    },
    PauseMainline,
    Analyze {
        docs_path: Option<String>,
        engine: Option<String>,
        dry_run: bool,
    },
}

#[derive(Debug, Clone)]
pub struct ControlLaunchResult {
    pub command_label: String,
    pub task_id: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ControlLaunchError {
    #[error("control launcher exited with code {code}: {stderr}")]
    ProcessFailed { code: i32, stderr: String },
    #[error("control launcher spawn failed: {0}")]
    Io(String),
}

impl ControlLauncher {
    pub async fn launch(
        &self,
        intent: ControlIntent,
    ) -> Result<ControlLaunchResult, ControlLaunchError> {
        let (args, task_id) = self.build_args(intent);
        let command_label = if task_id.is_some() {
            "run-once".to_string()
        } else if args.iter().any(|item| item == "pause-mainline") {
            "pause-mainline".to_string()
        } else if args.iter().any(|item| item == "analyze") {
            "analyze".to_string()
        } else {
            "run-loop".to_string()
        };

        let mut command = Command::new(&self.node_executable);
        command
            .args(args)
            .current_dir(&self.workspace_root)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(false)
            .env("HELLO_TOOL_ROOT", &self.tool_root);
        apply_windows_hidden_flags(&mut command);

        let output = command
            .output()
            .await
            .map_err(|error| ControlLaunchError::Io(error.to_string()))?;
        if !output.status.success() {
            return Err(ControlLaunchError::ProcessFailed {
                code: output.status.code().unwrap_or(-1),
                stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
            });
        }

        Ok(ControlLaunchResult {
            command_label,
            task_id,
        })
    }

    fn build_args(&self, intent: ControlIntent) -> (Vec<String>, Option<String>) {
        let script_file = self.tool_root.join("bin").join("helloloop.js");
        let command_name = match &intent {
            ControlIntent::RunLoop => "run-loop",
            ControlIntent::RunOnce { .. } => "run-once",
            ControlIntent::PauseMainline => "pause-mainline",
            ControlIntent::Analyze { .. } => "analyze",
        };
        let mut args = vec![
            script_file.display().to_string(),
            command_name.to_string(),
            "--repo".to_string(),
            self.workspace_root.display().to_string(),
            "--config-dir".to_string(),
            self.config_dir_name.clone(),
        ];
        if !matches!(intent, ControlIntent::PauseMainline) {
            args.push("--detach".to_string());
        }
        let mut task_id = None;
        match intent {
            ControlIntent::RunOnce {
                task_id: selected_task_id,
            } => {
                args.push("--task-id".to_string());
                args.push(selected_task_id.clone());
                task_id = Some(selected_task_id);
            }
            ControlIntent::Analyze {
                docs_path,
                engine,
                dry_run,
            } => {
                if let Some(docs_path) = docs_path.filter(|item| !item.trim().is_empty()) {
                    args.push("--docs".to_string());
                    args.push(docs_path);
                }
                if let Some(engine) = engine.filter(|item| !item.trim().is_empty()) {
                    args.push("--engine".to_string());
                    args.push(engine);
                }
                args.push("--yes".to_string());
                if dry_run {
                    args.push("--dry-run".to_string());
                }
            }
            ControlIntent::PauseMainline => {}
            ControlIntent::RunLoop => {}
        }
        (args, task_id)
    }
}

fn apply_windows_hidden_flags(command: &mut Command) {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{ControlIntent, ControlLauncher};

    #[test]
    fn builds_run_loop_args_without_task_id() {
        let launcher = ControlLauncher {
            tool_root: PathBuf::from("D:/tool"),
            workspace_root: PathBuf::from("D:/repo"),
            config_dir_name: ".helloloop".to_string(),
            node_executable: "node".to_string(),
        };

        let (args, task_id) = launcher.build_args(ControlIntent::RunLoop);
        assert!(task_id.is_none());
        assert!(args.iter().any(|item| item == "run-loop"));
        assert!(args.iter().any(|item| item == "--detach"));
    }

    #[test]
    fn builds_run_once_args_with_task_id() {
        let launcher = ControlLauncher {
            tool_root: PathBuf::from("D:/tool"),
            workspace_root: PathBuf::from("D:/repo"),
            config_dir_name: ".helloloop".to_string(),
            node_executable: "node".to_string(),
        };

        let (args, task_id) = launcher.build_args(ControlIntent::RunOnce {
            task_id: "task-123".to_string(),
        });
        assert_eq!(task_id.as_deref(), Some("task-123"));
        assert!(args.iter().any(|item| item == "run-once"));
        assert!(
            args.windows(2)
                .any(|window| window == ["--task-id", "task-123"])
        );
    }

    #[test]
    fn builds_analyze_args_with_yes_and_detach() {
        let launcher = ControlLauncher {
            tool_root: PathBuf::from("D:/tool"),
            workspace_root: PathBuf::from("D:/repo"),
            config_dir_name: ".helloloop".to_string(),
            node_executable: "node".to_string(),
        };

        let (args, task_id) = launcher.build_args(ControlIntent::Analyze {
            docs_path: Some("docs".to_string()),
            engine: Some("claude".to_string()),
            dry_run: true,
        });
        assert!(task_id.is_none());
        assert!(args.iter().any(|item| item == "analyze"));
        assert!(args.iter().any(|item| item == "--yes"));
        assert!(args.iter().any(|item| item == "--dry-run"));
        assert!(args.iter().any(|item| item == "--detach"));
        assert!(args.windows(2).any(|window| window == ["--docs", "docs"]));
        assert!(
            args.windows(2)
                .any(|window| window == ["--engine", "claude"])
        );
    }

    #[test]
    fn builds_pause_mainline_args_without_detach() {
        let launcher = ControlLauncher {
            tool_root: PathBuf::from("D:/tool"),
            workspace_root: PathBuf::from("D:/repo"),
            config_dir_name: ".helloloop".to_string(),
            node_executable: "node".to_string(),
        };

        let (args, task_id) = launcher.build_args(ControlIntent::PauseMainline);
        assert!(task_id.is_none());
        assert!(args.iter().any(|item| item == "pause-mainline"));
        assert!(!args.iter().any(|item| item == "--detach"));
    }
}

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct HelloAppWorkspaceSelection {
    pub repo_root: String,
    pub docs_path: String,
    pub config_dir_name: String,
    pub preferred_engine: String,
}

impl HelloAppWorkspaceSelection {
    #[must_use]
    pub fn normalized(mut self) -> Self {
        self.repo_root = self.repo_root.trim().to_string();
        self.docs_path = self.docs_path.trim().to_string();
        self.config_dir_name = match self.config_dir_name.trim() {
            "" => ".helloloop".to_string(),
            value => value.to_string(),
        };
        self.preferred_engine = match self.preferred_engine.trim() {
            "claude" => "claude".to_string(),
            "gemini" => "gemini".to_string(),
            _ => "codex".to_string(),
        };
        self
    }

    #[must_use]
    pub fn is_configured(&self) -> bool {
        !self.repo_root.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::HelloAppWorkspaceSelection;

    #[test]
    fn normalizes_workspace_selection_defaults() {
        let selection = HelloAppWorkspaceSelection {
            repo_root: "  D:/GitHub/dev/helloloop  ".to_string(),
            docs_path: "  docs  ".to_string(),
            config_dir_name: "".to_string(),
            preferred_engine: "other".to_string(),
        }
        .normalized();

        assert_eq!(selection.repo_root, "D:/GitHub/dev/helloloop");
        assert_eq!(selection.docs_path, "docs");
        assert_eq!(selection.config_dir_name, ".helloloop");
        assert_eq!(selection.preferred_engine, "codex");
        assert!(selection.is_configured());
    }
}

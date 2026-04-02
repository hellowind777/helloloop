use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HelloAppSettings {
    pub locale: String,
    pub theme: String,
    pub preferred_host: String,
    pub scheduler_mode: String,
    pub retry_policy: String,
    pub notifications_enabled: bool,
    pub tray_launch_on_start: bool,
    pub daemon_auto_start: bool,
    pub refresh_interval_seconds: u64,
}

impl Default for HelloAppSettings {
    fn default() -> Self {
        Self {
            locale: "zh-CN".to_string(),
            theme: "light".to_string(),
            preferred_host: "codex".to_string(),
            scheduler_mode: "central_supervisor".to_string(),
            retry_policy: "balanced".to_string(),
            notifications_enabled: true,
            tray_launch_on_start: true,
            daemon_auto_start: true,
            refresh_interval_seconds: 5,
        }
    }
}

impl HelloAppSettings {
    #[must_use]
    pub fn normalized(mut self) -> Self {
        self.locale = match self.locale.as_str() {
            "en-US" => "en-US".to_string(),
            _ => "zh-CN".to_string(),
        };
        self.theme = match self.theme.as_str() {
            "dark" => "dark".to_string(),
            _ => "light".to_string(),
        };
        self.preferred_host = match self.preferred_host.as_str() {
            "claude" => "claude".to_string(),
            "gemini" => "gemini".to_string(),
            _ => "codex".to_string(),
        };
        self.scheduler_mode = match self.scheduler_mode.as_str() {
            "balanced_parallel" => "balanced_parallel".to_string(),
            "strict_stage_gate" => "strict_stage_gate".to_string(),
            _ => "central_supervisor".to_string(),
        };
        self.retry_policy = match self.retry_policy.as_str() {
            "conservative" => "conservative".to_string(),
            "aggressive" => "aggressive".to_string(),
            _ => "balanced".to_string(),
        };
        self.refresh_interval_seconds = self.refresh_interval_seconds.clamp(3, 60);
        self
    }
}

#[cfg(test)]
mod tests {
    use super::HelloAppSettings;

    #[test]
    fn normalizes_unknown_values_to_supported_defaults() {
        let settings = HelloAppSettings {
            locale: "fr-FR".to_string(),
            theme: "system".to_string(),
            preferred_host: "other".to_string(),
            scheduler_mode: "anything".to_string(),
            retry_policy: "wild".to_string(),
            notifications_enabled: true,
            tray_launch_on_start: false,
            daemon_auto_start: false,
            refresh_interval_seconds: 120,
        }
        .normalized();

        assert_eq!(settings.locale, "zh-CN");
        assert_eq!(settings.theme, "light");
        assert_eq!(settings.preferred_host, "codex");
        assert_eq!(settings.scheduler_mode, "central_supervisor");
        assert_eq!(settings.retry_policy, "balanced");
        assert_eq!(settings.refresh_interval_seconds, 60);
    }
}

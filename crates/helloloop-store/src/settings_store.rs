use helloloop_domain::HelloAppSettings;
use sqlx::{Executor, SqlitePool};

use crate::BootstrapStore;

impl BootstrapStore {
    pub async fn settings(&self) -> Result<HelloAppSettings, sqlx::Error> {
        let Some(pool) = &self.pool else {
            return Ok(HelloAppSettings::default());
        };

        load_settings(pool)
            .await
            .map(|settings| settings.unwrap_or_default())
    }

    pub async fn save_settings(
        &self,
        settings: &HelloAppSettings,
    ) -> Result<HelloAppSettings, sqlx::Error> {
        let normalized = settings.clone().normalized();
        if let Some(pool) = &self.pool {
            persist_settings(pool, &normalized).await?;
        }
        Ok(normalized)
    }
}

pub(crate) async fn initialize_settings_schema(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    pool.execute(
        "CREATE TABLE IF NOT EXISTS hello_app_settings (
            settings_key TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
    )
    .await?;
    Ok(())
}

async fn load_settings(pool: &SqlitePool) -> Result<Option<HelloAppSettings>, sqlx::Error> {
    let row = sqlx::query_scalar::<_, String>(
        "SELECT payload FROM hello_app_settings WHERE settings_key = 'default' LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;

    row.map(|payload| {
        serde_json::from_str::<HelloAppSettings>(&payload)
            .map(|settings| settings.normalized())
            .map_err(|error| sqlx::Error::Protocol(error.to_string().into()))
    })
    .transpose()
}

async fn persist_settings(
    pool: &SqlitePool,
    settings: &HelloAppSettings,
) -> Result<(), sqlx::Error> {
    let payload = serde_json::to_string(settings)
        .map_err(|error| sqlx::Error::Protocol(error.to_string().into()))?;

    sqlx::query(
        "INSERT INTO hello_app_settings (settings_key, payload, updated_at)
         VALUES ('default', ?1, datetime('now'))
         ON CONFLICT(settings_key)
         DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
    )
    .bind(payload)
    .execute(pool)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use helloloop_domain::{
        CommandCenterSnapshot, HelloAppSettings, HostKind, SessionSnapshot, SessionState,
        TaskSnapshot,
    };

    use crate::BootstrapStore;

    fn sample_snapshot() -> CommandCenterSnapshot {
        CommandCenterSnapshot::new(
            "helloloop".to_string(),
            "focus".to_string(),
            vec![TaskSnapshot::new(
                "task",
                "implementation",
                "developer",
                SessionState::Ready,
            )],
            vec![SessionSnapshot::new(
                "session",
                HostKind::Codex,
                "supervisor",
                SessionState::Ready,
                "task",
                "task",
            )],
        )
    }

    fn unique_db_path() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("helloloop-settings-store-{nonce}.db"))
    }

    #[tokio::test]
    async fn persists_settings_payload() {
        let db_path = unique_db_path();
        let store = BootstrapStore::new(sample_snapshot(), Some(&db_path))
            .await
            .expect("store should initialize");

        let saved = store
            .save_settings(&HelloAppSettings {
                locale: "en-US".to_string(),
                theme: "dark".to_string(),
                preferred_host: "claude".to_string(),
                scheduler_mode: "balanced_parallel".to_string(),
                retry_policy: "aggressive".to_string(),
                notifications_enabled: false,
                tray_launch_on_start: false,
                daemon_auto_start: true,
                refresh_interval_seconds: 9,
            })
            .await
            .expect("settings should persist");

        let loaded = store.settings().await.expect("settings should load");

        assert_eq!(saved, loaded);

        let _ = tokio::fs::remove_file(db_path).await;
    }
}

use helloloop_domain::HelloAppWorkspaceSelection;
use sqlx::{Executor, SqlitePool};

use crate::BootstrapStore;

impl BootstrapStore {
    pub async fn workspace_selection(
        &self,
    ) -> Result<Option<HelloAppWorkspaceSelection>, sqlx::Error> {
        let Some(pool) = &self.pool else {
            return Ok(None);
        };

        load_workspace_selection(pool).await
    }

    pub async fn save_workspace_selection(
        &self,
        selection: &HelloAppWorkspaceSelection,
    ) -> Result<HelloAppWorkspaceSelection, sqlx::Error> {
        let normalized = selection.clone().normalized();
        if let Some(pool) = &self.pool {
            persist_workspace_selection(pool, &normalized).await?;
        }
        Ok(normalized)
    }
}

pub(crate) async fn initialize_workspace_schema(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    pool.execute(
        "CREATE TABLE IF NOT EXISTS hello_app_workspace_selection (
            selection_key TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
    )
    .await?;
    Ok(())
}

async fn load_workspace_selection(
    pool: &SqlitePool,
) -> Result<Option<HelloAppWorkspaceSelection>, sqlx::Error> {
    let row = sqlx::query_scalar::<_, String>(
        "SELECT payload
         FROM hello_app_workspace_selection
         WHERE selection_key = 'current'
         LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;

    row.map(|payload| {
        serde_json::from_str::<HelloAppWorkspaceSelection>(&payload)
            .map(|selection| selection.normalized())
            .map_err(|error| sqlx::Error::Protocol(error.to_string().into()))
    })
    .transpose()
}

async fn persist_workspace_selection(
    pool: &SqlitePool,
    selection: &HelloAppWorkspaceSelection,
) -> Result<(), sqlx::Error> {
    let payload = serde_json::to_string(selection)
        .map_err(|error| sqlx::Error::Protocol(error.to_string().into()))?;

    sqlx::query(
        "INSERT INTO hello_app_workspace_selection (selection_key, payload, updated_at)
         VALUES ('current', ?1, datetime('now'))
         ON CONFLICT(selection_key)
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
        CommandCenterSnapshot, HelloAppWorkspaceSelection, HostKind, SessionSnapshot, SessionState,
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
        std::env::temp_dir().join(format!("helloloop-workspace-store-{nonce}.db"))
    }

    #[tokio::test]
    async fn persists_workspace_selection_payload() {
        let db_path = unique_db_path();
        let store = BootstrapStore::new(sample_snapshot(), Some(&db_path))
            .await
            .expect("store should initialize");

        let saved = store
            .save_workspace_selection(&HelloAppWorkspaceSelection {
                repo_root: "D:/GitHub/dev/helloloop".to_string(),
                docs_path: "docs".to_string(),
                config_dir_name: ".helloloop".to_string(),
                preferred_engine: "claude".to_string(),
            })
            .await
            .expect("workspace selection should persist");

        let loaded = store
            .workspace_selection()
            .await
            .expect("workspace selection should load");

        assert_eq!(loaded.as_ref(), Some(&saved));

        let _ = tokio::fs::remove_file(db_path).await;
    }
}

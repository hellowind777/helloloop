use std::path::Path;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use helloloop_domain::{CommandCenterEventRecord, CommandCenterSnapshot};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Executor, SqlitePool};
use tokio::sync::{RwLock, watch};

mod settings_store;
mod workspace_store;

use settings_store::initialize_settings_schema;
use workspace_store::initialize_workspace_schema;

#[derive(Clone)]
pub struct BootstrapStore {
    snapshot: Arc<RwLock<CommandCenterSnapshot>>,
    updates: watch::Sender<CommandCenterSnapshot>,
    pool: Option<SqlitePool>,
}

#[derive(Debug, Clone)]
pub struct BlockerAcknowledgementRecord {
    pub signature: String,
    pub acknowledged_at: DateTime<Utc>,
}

impl BootstrapStore {
    pub async fn new(
        snapshot: CommandCenterSnapshot,
        db_path: Option<&Path>,
    ) -> Result<Self, sqlx::Error> {
        let (updates, _) = watch::channel(snapshot.clone());
        let pool = if let Some(db_path) = db_path {
            if let Some(parent) = db_path.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(sqlx::Error::Io)?;
            }
            let options = SqliteConnectOptions::new()
                .filename(db_path)
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal)
                .synchronous(SqliteSynchronous::Normal);
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(options)
                .await?;
            initialize_schema(&pool).await?;
            if let Some(stored) = load_latest_snapshot(&pool).await? {
                let _ = updates.send(stored.clone());
                return Ok(Self {
                    snapshot: Arc::new(RwLock::new(stored)),
                    updates,
                    pool: Some(pool),
                });
            }
            persist_snapshot(&pool, "bootstrap", &snapshot).await?;
            Some(pool)
        } else {
            None
        };

        Ok(Self {
            snapshot: Arc::new(RwLock::new(snapshot)),
            updates,
            pool,
        })
    }

    pub async fn snapshot(&self) -> CommandCenterSnapshot {
        self.snapshot.read().await.clone()
    }

    pub async fn replace(&self, snapshot: CommandCenterSnapshot) -> Result<(), sqlx::Error> {
        *self.snapshot.write().await = snapshot;
        let current = self.snapshot().await;
        if let Some(pool) = &self.pool {
            persist_snapshot(pool, "snapshot_updated", &current).await?;
        }
        let _ = self.updates.send(current);
        Ok(())
    }

    pub async fn touch_heartbeat(&self) -> Result<(), sqlx::Error> {
        self.snapshot.write().await.touch_heartbeat();
        let current = self.snapshot().await;
        if let Some(pool) = &self.pool {
            persist_snapshot(pool, "heartbeat", &current).await?;
        }
        let _ = self.updates.send(current);
        Ok(())
    }

    pub fn subscribe(&self) -> watch::Receiver<CommandCenterSnapshot> {
        self.updates.subscribe()
    }

    pub async fn recent_events(
        &self,
        limit: usize,
    ) -> Result<Vec<CommandCenterEventRecord>, sqlx::Error> {
        let Some(pool) = &self.pool else {
            return Ok(Vec::new());
        };

        let rows = sqlx::query_as::<_, (i64, String, String, String)>(
            "SELECT id, event_type, payload, created_at
             FROM command_center_events
             ORDER BY id DESC
             LIMIT ?1",
        )
        .bind(limit as i64)
        .fetch_all(pool)
        .await?;

        rows.into_iter()
            .map(|(id, event_type, payload, created_at)| {
                let payload = serde_json::from_str::<CommandCenterSnapshot>(&payload)
                    .map_err(|error| sqlx::Error::Protocol(error.to_string().into()))?;
                let created_at = DateTime::parse_from_rfc3339(&created_at)
                    .map(|value| value.with_timezone(&Utc))
                    .map_err(|error| sqlx::Error::Protocol(error.to_string().into()))?;
                Ok(CommandCenterEventRecord {
                    id,
                    event_type,
                    payload,
                    created_at,
                })
            })
            .collect()
    }

    pub async fn append_event(&self, event_type: &str) -> Result<(), sqlx::Error> {
        let current = self.snapshot().await;
        if let Some(pool) = &self.pool {
            persist_event_only(pool, event_type, &current).await?;
        }
        let _ = self.updates.send(current);
        Ok(())
    }

    pub async fn blocker_acknowledgement(
        &self,
        session_id: &str,
    ) -> Result<Option<BlockerAcknowledgementRecord>, sqlx::Error> {
        let Some(pool) = &self.pool else {
            return Ok(None);
        };

        let row = sqlx::query_as::<_, (String, String)>(
            "SELECT blocker_signature, acknowledged_at
             FROM session_blocker_acknowledgements
             WHERE session_id = ?1
             LIMIT 1",
        )
        .bind(session_id)
        .fetch_optional(pool)
        .await?;

        row.map(|(signature, acknowledged_at)| {
            let acknowledged_at = DateTime::parse_from_rfc3339(&acknowledged_at)
                .map(|value| value.with_timezone(&Utc))
                .map_err(|error| sqlx::Error::Protocol(error.to_string().into()))?;
            Ok(BlockerAcknowledgementRecord {
                signature,
                acknowledged_at,
            })
        })
        .transpose()
    }

    pub async fn acknowledge_blocker(
        &self,
        session_id: &str,
        blocker_signature: &str,
    ) -> Result<BlockerAcknowledgementRecord, sqlx::Error> {
        let acknowledged_at = Utc::now();
        if let Some(pool) = &self.pool {
            persist_blocker_acknowledgement(pool, session_id, blocker_signature, acknowledged_at)
                .await?;
        }
        let current = self.snapshot().await;
        let _ = self.updates.send(current);
        Ok(BlockerAcknowledgementRecord {
            signature: blocker_signature.to_string(),
            acknowledged_at,
        })
    }
}

async fn initialize_schema(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    pool.execute(
        "CREATE TABLE IF NOT EXISTS command_center_snapshots (
            snapshot_key TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
    )
    .await?;
    pool.execute(
        "CREATE TABLE IF NOT EXISTS command_center_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL
        )",
    )
    .await?;
    pool.execute(
        "CREATE TABLE IF NOT EXISTS session_blocker_acknowledgements (
            session_id TEXT PRIMARY KEY,
            blocker_signature TEXT NOT NULL,
            acknowledged_at TEXT NOT NULL
        )",
    )
    .await?;
    initialize_settings_schema(pool).await?;
    initialize_workspace_schema(pool).await?;
    Ok(())
}

async fn load_latest_snapshot(
    pool: &SqlitePool,
) -> Result<Option<CommandCenterSnapshot>, sqlx::Error> {
    let row = sqlx::query_scalar::<_, String>(
        "SELECT payload FROM command_center_snapshots WHERE snapshot_key = 'latest' LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.and_then(|payload| serde_json::from_str::<CommandCenterSnapshot>(&payload).ok()))
}

async fn persist_snapshot(
    pool: &SqlitePool,
    event_type: &str,
    snapshot: &CommandCenterSnapshot,
) -> Result<(), sqlx::Error> {
    let payload = serde_json::to_string(snapshot)
        .map_err(|error| sqlx::Error::Protocol(error.to_string().into()))?;
    let updated_at = snapshot.updated_at.to_rfc3339();

    sqlx::query(
        "INSERT INTO command_center_snapshots (snapshot_key, payload, updated_at)
         VALUES ('latest', ?1, ?2)
         ON CONFLICT(snapshot_key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
    )
    .bind(&payload)
    .bind(&updated_at)
    .execute(pool)
    .await?;

    sqlx::query(
        "INSERT INTO command_center_events (event_type, payload, created_at)
         VALUES (?1, ?2, ?3)",
    )
    .bind(event_type)
    .bind(payload)
    .bind(updated_at)
    .execute(pool)
    .await?;

    Ok(())
}

async fn persist_event_only(
    pool: &SqlitePool,
    event_type: &str,
    snapshot: &CommandCenterSnapshot,
) -> Result<(), sqlx::Error> {
    let payload = serde_json::to_string(snapshot)
        .map_err(|error| sqlx::Error::Protocol(error.to_string().into()))?;

    sqlx::query(
        "INSERT INTO command_center_events (event_type, payload, created_at)
         VALUES (?1, ?2, ?3)",
    )
    .bind(event_type)
    .bind(payload)
    .bind(snapshot.updated_at.to_rfc3339())
    .execute(pool)
    .await?;

    Ok(())
}

async fn persist_blocker_acknowledgement(
    pool: &SqlitePool,
    session_id: &str,
    blocker_signature: &str,
    acknowledged_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO session_blocker_acknowledgements (session_id, blocker_signature, acknowledged_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(session_id)
         DO UPDATE SET blocker_signature = excluded.blocker_signature, acknowledged_at = excluded.acknowledged_at",
    )
    .bind(session_id)
    .bind(blocker_signature)
    .bind(acknowledged_at.to_rfc3339())
    .execute(pool)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use helloloop_domain::{
        CommandCenterSnapshot, HostKind, SessionSnapshot, SessionState, TaskSnapshot,
    };

    use super::BootstrapStore;

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
        std::env::temp_dir().join(format!("helloloop-store-{nonce}.db"))
    }

    #[tokio::test]
    async fn stores_and_queries_recent_events() {
        let db_path = unique_db_path();
        let store = BootstrapStore::new(sample_snapshot(), Some(&db_path))
            .await
            .expect("store should initialize");

        store
            .touch_heartbeat()
            .await
            .expect("heartbeat should persist");
        let events = store
            .recent_events(4)
            .await
            .expect("recent events should load");

        assert!(!events.is_empty());
        assert!(events.iter().any(|event| event.event_type == "bootstrap"));
        assert!(events.iter().any(|event| event.event_type == "heartbeat"));

        let _ = tokio::fs::remove_file(db_path).await;
    }

    #[tokio::test]
    async fn persists_blocker_acknowledgements() {
        let db_path = unique_db_path();
        let store = BootstrapStore::new(sample_snapshot(), Some(&db_path))
            .await
            .expect("store should initialize");

        store
            .acknowledge_blocker("session-1", "waiting_dependency|task-a")
            .await
            .expect("acknowledgement should persist");

        let acknowledgement = store
            .blocker_acknowledgement("session-1")
            .await
            .expect("acknowledgement should load");

        assert_eq!(
            acknowledgement.as_ref().map(|item| item.signature.as_str()),
            Some("waiting_dependency|task-a"),
        );

        let _ = tokio::fs::remove_file(db_path).await;
    }
}

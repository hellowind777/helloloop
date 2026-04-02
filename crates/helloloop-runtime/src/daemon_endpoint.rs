use std::collections::HashSet;
use std::env;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::Utc;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;

pub const DEFAULT_DAEMON_BIND: &str = "127.0.0.1:37176";
const ACTIVE_DAEMON_RECORD_FILE: &str = "active-daemon.json";
const DEFAULT_SCAN_PORT_COUNT: u16 = 8;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ActiveDaemonRecord {
    daemon_url: String,
    listen_addr: String,
    pid: u32,
    workspace_root: Option<String>,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
struct DaemonHealthProbe {
    pid: u32,
    listen_addr: String,
    context: DaemonHealthContext,
}

#[derive(Debug, Deserialize, Default)]
struct DaemonHealthContext {
    workspace_root: Option<String>,
}

pub fn daemon_url_hint() -> String {
    explicit_daemon_url()
        .or_else(|| {
            load_active_daemon_record(active_daemon_record_path()).map(|record| record.daemon_url)
        })
        .unwrap_or_else(|| format!("http://{DEFAULT_DAEMON_BIND}"))
}

pub fn active_daemon_record_path() -> PathBuf {
    state_root_dir().join(ACTIVE_DAEMON_RECORD_FILE)
}

pub fn local_daemon_http_client(timeout: Duration) -> Result<Client, reqwest::Error> {
    Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_millis(timeout.as_millis().min(800) as u64))
        .timeout(timeout)
        .build()
}

pub async fn bind_preferred_listener(
    bind_override: Option<&str>,
) -> io::Result<(TcpListener, String, String)> {
    if let Some(bind) = bind_override.filter(|value| !value.trim().is_empty()) {
        let listener = TcpListener::bind(bind).await?;
        let listen_addr = listener.local_addr()?.to_string();
        return Ok((listener, listen_addr, "env_override".to_string()));
    }

    let (host, start_port) = split_bind_host_port(DEFAULT_DAEMON_BIND)?;
    let mut last_addr_in_use = None;

    for offset in 0..DEFAULT_SCAN_PORT_COUNT {
        let port = start_port + offset;
        let bind = format!("{host}:{port}");
        match TcpListener::bind(&bind).await {
            Ok(listener) => {
                let listen_addr = listener.local_addr()?.to_string();
                let bind_source = if offset == 0 {
                    "default".to_string()
                } else {
                    "fallback_scan".to_string()
                };
                return Ok((listener, listen_addr, bind_source));
            }
            Err(error) if error.kind() == io::ErrorKind::AddrInUse => {
                last_addr_in_use = Some(error);
            }
            Err(error) => return Err(error),
        }
    }

    Err(last_addr_in_use.unwrap_or_else(|| {
        io::Error::new(
            io::ErrorKind::AddrInUse,
            format!(
                "no available daemon port found in {}..{}",
                start_port,
                start_port + DEFAULT_SCAN_PORT_COUNT - 1
            ),
        )
    }))
}

pub async fn persist_active_daemon_record(
    listen_addr: &str,
    pid: u32,
    workspace_root: Option<&str>,
) -> io::Result<PathBuf> {
    let path = active_daemon_record_path();
    let record = ActiveDaemonRecord {
        daemon_url: format!("http://{listen_addr}"),
        listen_addr: listen_addr.to_string(),
        pid,
        workspace_root: workspace_root.map(ToOwned::to_owned),
        updated_at: Utc::now().to_rfc3339(),
    };
    write_active_daemon_record(&path, &record).await?;
    Ok(path)
}

pub async fn clear_active_daemon_record(listen_addr: &str, pid: u32) -> io::Result<()> {
    let path = active_daemon_record_path();
    let Some(record) = load_active_daemon_record(&path) else {
        return Ok(());
    };

    if record.listen_addr == listen_addr && record.pid == pid {
        match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }?;
    }

    Ok(())
}

pub async fn resolve_reachable_daemon_url(client: &Client) -> Option<String> {
    if let Some(url) = explicit_daemon_url() {
        return Some(url);
    }

    let record_path = active_daemon_record_path();
    let probe_client =
        local_daemon_http_client(Duration::from_millis(350)).unwrap_or_else(|_| client.clone());
    let mut stale_record = false;
    for url in candidate_daemon_urls(load_active_daemon_record(&record_path).as_ref()) {
        if let Some(record) = probe_daemon_url(&probe_client, &url).await {
            let _ = write_active_daemon_record(&record_path, &record).await;
            return Some(record.daemon_url);
        }

        if load_active_daemon_record(&record_path)
            .as_ref()
            .is_some_and(|record| record.daemon_url == url)
        {
            stale_record = true;
        }
    }

    if stale_record {
        let _ = std::fs::remove_file(record_path);
    }

    None
}

fn explicit_daemon_url() -> Option<String> {
    env::var("HELLO_DAEMON_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn candidate_daemon_urls(record: Option<&ActiveDaemonRecord>) -> Vec<String> {
    let mut urls = Vec::new();
    let mut seen = HashSet::new();

    if let Some(record) = record {
        push_candidate(&mut urls, &mut seen, &record.daemon_url);
    }

    let (host, start_port) = split_bind_host_port(DEFAULT_DAEMON_BIND)
        .unwrap_or_else(|_| ("127.0.0.1".to_string(), 37176));
    for offset in 0..DEFAULT_SCAN_PORT_COUNT {
        push_candidate(
            &mut urls,
            &mut seen,
            &format!("http://{host}:{}", start_port + offset),
        );
    }

    urls
}

async fn probe_daemon_url(client: &Client, daemon_url: &str) -> Option<ActiveDaemonRecord> {
    let response = client
        .get(format!("{daemon_url}/healthz"))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?;
    let health = response.json::<DaemonHealthProbe>().await.ok()?;
    Some(ActiveDaemonRecord {
        daemon_url: format!("http://{}", health.listen_addr),
        listen_addr: health.listen_addr,
        pid: health.pid,
        workspace_root: health.context.workspace_root,
        updated_at: Utc::now().to_rfc3339(),
    })
}

async fn write_active_daemon_record(path: &Path, record: &ActiveDaemonRecord) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let payload = serde_json::to_vec_pretty(record)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error.to_string()))?;
    std::fs::write(path, payload)
}

fn load_active_daemon_record(path: impl AsRef<Path>) -> Option<ActiveDaemonRecord> {
    let payload = std::fs::read(path).ok()?;
    serde_json::from_slice::<ActiveDaemonRecord>(&payload).ok()
}

fn state_root_dir() -> PathBuf {
    if let Ok(value) = env::var("HELLO_DAEMON_STATE_DIR") {
        let path = PathBuf::from(value);
        if !path.as_os_str().is_empty() {
            return path;
        }
    }

    #[cfg(windows)]
    {
        if let Ok(value) = env::var("LOCALAPPDATA") {
            return PathBuf::from(value).join("HelloLoop");
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(value) = env::var("HOME") {
            return PathBuf::from(value)
                .join("Library")
                .join("Application Support")
                .join("HelloLoop");
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Ok(value) = env::var("XDG_STATE_HOME") {
            return PathBuf::from(value).join("helloloop");
        }
        if let Ok(value) = env::var("HOME") {
            return PathBuf::from(value)
                .join(".local")
                .join("state")
                .join("helloloop");
        }
    }

    env::temp_dir().join("helloloop")
}

fn split_bind_host_port(bind: &str) -> io::Result<(String, u16)> {
    let mut segments = bind.rsplitn(2, ':');
    let port_segment = segments.next().unwrap_or_default();
    let host_segment = segments.next().unwrap_or_default();
    let port = port_segment.parse::<u16>().map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid daemon bind port `{port_segment}`: {error}"),
        )
    })?;
    let host = if host_segment.trim().is_empty() {
        "127.0.0.1".to_string()
    } else {
        host_segment.to_string()
    };
    Ok((host, port))
}

fn push_candidate(urls: &mut Vec<String>, seen: &mut HashSet<String>, daemon_url: &str) {
    let normalized = daemon_url.trim().trim_end_matches('/').to_string();
    if !normalized.is_empty() && seen.insert(normalized.clone()) {
        urls.push(normalized);
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::{ActiveDaemonRecord, candidate_daemon_urls, write_active_daemon_record};

    #[test]
    fn candidate_urls_prioritize_active_record_without_duplicates() {
        let urls = candidate_daemon_urls(Some(&ActiveDaemonRecord {
            daemon_url: "http://127.0.0.1:37177".to_string(),
            listen_addr: "127.0.0.1:37177".to_string(),
            pid: 1,
            workspace_root: None,
            updated_at: String::new(),
        }));

        assert_eq!(
            urls.first().map(String::as_str),
            Some("http://127.0.0.1:37177")
        );
        assert_eq!(
            urls.iter()
                .filter(|item| item.as_str() == "http://127.0.0.1:37177")
                .count(),
            1
        );
        assert!(urls.iter().any(|item| item == "http://127.0.0.1:37176"));
    }

    #[tokio::test]
    async fn writes_active_daemon_record_payload() {
        let temp_dir =
            std::env::temp_dir().join(format!("helloloop-daemon-endpoint-{}", std::process::id()));
        let file_path = temp_dir.join("active-daemon.json");
        let record = ActiveDaemonRecord {
            daemon_url: "http://127.0.0.1:37177".to_string(),
            listen_addr: "127.0.0.1:37177".to_string(),
            pid: 99,
            workspace_root: Some("D:/GitHub/dev/helloloop".to_string()),
            updated_at: Utc::now().to_rfc3339(),
        };

        write_active_daemon_record(&file_path, &record)
            .await
            .expect("active daemon record should be written");

        let payload = std::fs::read_to_string(&file_path).expect("record should exist");
        assert!(payload.contains("127.0.0.1:37177"));
        assert!(payload.contains("\"pid\": 99"));

        let _ = std::fs::remove_file(&file_path);
        let _ = std::fs::remove_dir_all(temp_dir);
    }
}

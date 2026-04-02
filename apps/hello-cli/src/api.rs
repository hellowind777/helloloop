use std::env;
use std::error::Error;
use std::time::Duration;

use helloloop_domain::{CommandCenterSnapshot, DaemonHealth, SessionDetailSnapshot};
use helloloop_runtime::{daemon_url_hint, local_daemon_http_client, resolve_reachable_daemon_url};
use serde::Serialize;
use serde::de::DeserializeOwned;

pub fn daemon_url() -> String {
    env::var("HELLO_DAEMON_URL").unwrap_or_else(|_| daemon_url_hint())
}

pub fn app_url() -> String {
    format!("{}/app/", daemon_url().trim_end_matches('/'))
}

pub fn local_http_client() -> Result<reqwest::Client, Box<dyn Error>> {
    local_daemon_http_client(Duration::from_secs(2)).map_err(|error| error.into())
}

pub async fn fetch_health() -> Result<DaemonHealth, Box<dyn Error>> {
    fetch_json_at("/healthz").await
}

pub async fn fetch_command_center() -> Result<CommandCenterSnapshot, Box<dyn Error>> {
    fetch_json_at("/api/v1/command-center").await
}

pub async fn fetch_session_detail(
    session_id: &str,
) -> Result<SessionDetailSnapshot, Box<dyn Error>> {
    fetch_json_at(&format!("/api/v1/sessions/{session_id}")).await
}

pub async fn fetch_json_at<T: DeserializeOwned>(path: &str) -> Result<T, Box<dyn Error>> {
    fetch_json(path).await
}

pub async fn fetch_optional_json_at<T: DeserializeOwned>(
    path: &str,
    ignored_statuses: &[u16],
) -> Result<Option<T>, Box<dyn Error>> {
    let client = local_http_client()?;
    let daemon_url = resolved_daemon_url(&client).await;
    let response = client.get(format!("{daemon_url}{path}")).send().await?;
    if ignored_statuses.contains(&response.status().as_u16()) {
        return Ok(None);
    }
    let response = response.error_for_status()?;
    Ok(Some(response.json::<T>().await?))
}

pub async fn post_control<T: DeserializeOwned>(path: &str) -> Result<T, Box<dyn Error>> {
    let client = local_http_client()?;
    let daemon_url = resolved_daemon_url(&client).await;
    let response = client.post(format!("{daemon_url}{path}")).send().await?;
    let response = response.error_for_status()?;
    Ok(response.json::<T>().await?)
}

pub async fn put_json_at<T: DeserializeOwned, B: Serialize>(
    path: &str,
    body: &B,
) -> Result<T, Box<dyn Error>> {
    let client = local_http_client()?;
    let daemon_url = resolved_daemon_url(&client).await;
    let response = client
        .put(format!("{daemon_url}{path}"))
        .json(body)
        .send()
        .await?;
    let response = response.error_for_status()?;
    Ok(response.json::<T>().await?)
}

async fn fetch_json<T: DeserializeOwned>(path: &str) -> Result<T, Box<dyn Error>> {
    let client = local_http_client()?;
    let daemon_url = resolved_daemon_url(&client).await;
    let response = client.get(format!("{daemon_url}{path}")).send().await?;
    let response = response.error_for_status()?;
    Ok(response.json::<T>().await?)
}

async fn resolved_daemon_url(client: &reqwest::Client) -> String {
    if let Ok(url) = env::var("HELLO_DAEMON_URL") {
        return url;
    }

    resolve_reachable_daemon_url(client)
        .await
        .unwrap_or_else(daemon_url_hint)
}

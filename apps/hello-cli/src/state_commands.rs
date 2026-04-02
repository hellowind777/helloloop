use std::error::Error;

use helloloop_domain::HelloAppWorkspaceSelection;
use serde_json::Value;

use crate::api::{fetch_json_at, fetch_optional_json_at, post_control};

pub async fn show_settings(as_json: bool) -> Result<(), Box<dyn Error>> {
    let settings: Value = fetch_json_at("/api/v1/settings").await?;
    if as_json {
        println!("{}", serde_json::to_string_pretty(&settings)?);
        return Ok(());
    }

    println!(
        "locale: {}",
        settings["locale"].as_str().unwrap_or("unknown")
    );
    println!("theme: {}", settings["theme"].as_str().unwrap_or("unknown"));
    println!(
        "preferred_host: {}",
        settings["preferred_host"].as_str().unwrap_or("unknown")
    );
    println!(
        "scheduler_mode: {}",
        settings["scheduler_mode"].as_str().unwrap_or("unknown")
    );
    println!(
        "retry_policy: {}",
        settings["retry_policy"].as_str().unwrap_or("unknown")
    );
    println!(
        "refresh_interval_seconds: {}",
        settings["refresh_interval_seconds"]
            .as_u64()
            .unwrap_or_default()
    );
    Ok(())
}

pub async fn show_workspace(as_json: bool) -> Result<(), Box<dyn Error>> {
    let workspace: Value = fetch_json_at("/api/v1/workspaces/current").await?;
    let selection = fetch_optional_json_at::<HelloAppWorkspaceSelection>(
        "/api/v1/workspaces/selection",
        &[404],
    )
    .await?;
    if as_json {
        let payload = serde_json::json!({
            "workspace": workspace,
            "selection": selection,
        });
        println!("{}", serde_json::to_string_pretty(&payload)?);
        return Ok(());
    }

    println!(
        "workspace: {}",
        workspace["repoName"].as_str().unwrap_or("unknown")
    );
    println!(
        "repo_root: {}",
        workspace["repoRoot"].as_str().unwrap_or("unknown")
    );
    println!(
        "engine: {}",
        workspace["engine"].as_str().unwrap_or("unknown")
    );
    println!(
        "focus: {}",
        workspace["workflow"]["currentFocus"]
            .as_str()
            .unwrap_or("unknown")
    );
    println!(
        "next_task: {}",
        workspace["nextTask"]["title"].as_str().unwrap_or("unknown")
    );
    println!(
        "parallel_lanes: {}",
        workspace["workflow"]["parallelLanes"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default()
    );
    if let Some(selection) = selection {
        println!("docs_path: {}", selection.docs_path);
        println!("config_dir_name: {}", selection.config_dir_name);
        println!("preferred_engine: {}", selection.preferred_engine);
    }
    Ok(())
}

pub async fn continue_mainline(as_json: bool) -> Result<(), Box<dyn Error>> {
    let response: Value = post_control("/api/v1/control/continue-mainline").await?;
    if as_json {
        println!("{}", serde_json::to_string_pretty(&response)?);
        return Ok(());
    }
    println!(
        "continue_mainline: {}",
        response["message"].as_str().unwrap_or("submitted")
    );
    Ok(())
}

pub async fn pause_mainline(as_json: bool) -> Result<(), Box<dyn Error>> {
    let response: Value = post_control("/api/v1/control/pause-mainline").await?;
    if as_json {
        println!("{}", serde_json::to_string_pretty(&response)?);
        return Ok(());
    }
    println!(
        "pause_mainline: {}",
        response["message"].as_str().unwrap_or("submitted")
    );
    Ok(())
}

pub async fn recover_first_available(as_json: bool) -> Result<(), Box<dyn Error>> {
    let response: Value = post_control("/api/v1/control/recover-first").await?;
    if as_json {
        println!("{}", serde_json::to_string_pretty(&response)?);
        return Ok(());
    }
    println!(
        "recover_first: {}",
        response["message"].as_str().unwrap_or("submitted")
    );
    Ok(())
}

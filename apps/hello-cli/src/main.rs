mod api;
mod command_exec;
mod command_options;
mod command_support;
mod commands;
mod state_commands;

use std::env;
use std::error::Error;

use commands::{
    connect, continue_mainline, export_snapshot, open_app, parse_connect_options,
    parse_daemon_launch_options, parse_export_options, parse_recover_options, pause_mainline,
    recover_first_available, recover_session, run_doctor, show_daemon_status, show_settings,
    show_workspace, start_daemon, stop_daemon,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let arguments = env::args().skip(1).collect::<Vec<_>>();

    if arguments.is_empty() || arguments.as_slice() == ["--help"] || arguments.as_slice() == ["-h"]
    {
        print_help();
        return Ok(());
    }

    match arguments.as_slice() {
        [command] if command == "doctor" => run_doctor(false).await,
        [command, flag] if command == "doctor" && flag == "--json" => run_doctor(true).await,
        [command] if command == "open" => open_app().await,
        [command] if command == "settings" => show_settings(false).await,
        [command, flag] if command == "settings" && flag == "--json" => show_settings(true).await,
        [command] if command == "workspace" => show_workspace(false).await,
        [command, flag] if command == "workspace" && flag == "--json" => show_workspace(true).await,
        [command] if command == "continue" => continue_mainline(false).await,
        [command, flag] if command == "continue" && flag == "--json" => {
            continue_mainline(true).await
        }
        [command] if command == "pause" => pause_mainline(false).await,
        [command, flag] if command == "pause" && flag == "--json" => {
            pause_mainline(true).await
        }
        [command] if command == "recover-first" => recover_first_available(false).await,
        [command, flag] if command == "recover-first" && flag == "--json" => {
            recover_first_available(true).await
        }
        [command] if command == "status" => show_daemon_status(false).await,
        [group, command] if group == "daemon" && command == "status" => {
            show_daemon_status(false).await
        }
        [group, command, flag] if group == "daemon" && command == "status" && flag == "--json" => {
            show_daemon_status(true).await
        }
        [group, command, rest @ ..] if group == "daemon" && command == "start" => {
            start_daemon(parse_daemon_launch_options(rest)?).await
        }
        [group, command] if group == "daemon" && command == "stop" => stop_daemon().await,
        [command, rest @ ..] if command == "recover" => {
            recover_session(parse_recover_options(rest)?).await
        }
        [command, rest @ ..] if command == "connect" => connect(parse_connect_options(rest)?).await,
        [command, rest @ ..] if command == "export" => {
            export_snapshot(parse_export_options(rest)?).await
        }
        _ => {
            print_help();
            Err("unsupported command".into())
        }
    }
}

fn print_help() {
    println!("hello-cli commands:");
    println!("  hello-cli doctor [--json]");
    println!("  hello-cli open");
    println!("  hello-cli settings [--json]");
    println!("  hello-cli workspace [--json]");
    println!("  hello-cli continue [--json]");
    println!("  hello-cli pause [--json]");
    println!("  hello-cli recover-first [--json]");
    println!(
        "  hello-cli connect [--workspace <path>] [--docs <path>] [--engine <codex|claude|gemini>] [--config-dir-name <name>] [--analyze] [--open] [--json]"
    );
    println!("  hello-cli recover [--session <id>] [--action <key>] [--json]");
    println!("  hello-cli export --out <path> [--pretty]");
    println!(
        "  hello-cli daemon start [--workspace <path>] [--tool-root <path>] [--db <path>] [--bind <addr>]"
    );
    println!("  hello-cli daemon status [--json]");
    println!("  hello-cli daemon stop");
}

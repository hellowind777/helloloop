mod shell_support;

use std::time::Duration;

use shell_support::{
    TraySummary, app_url, control_post, current_workspace_dir, ensure_daemon_ready,
    fetch_tray_summary, logs_dir, open_path, restart_daemon,
};
use tauri::menu::{Menu, MenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const TRAY_ID: &str = "hello-app-tray";
const WINDOW_LABEL: &str = "main";
const MENU_OPEN_APP: &str = "open_app";
const MENU_OPEN_SETTINGS: &str = "open_settings";
const MENU_OPEN_WORKSPACE: &str = "open_workspace";
const MENU_OPEN_LOGS: &str = "open_logs";
const MENU_PAUSE_MAINLINE: &str = "pause_mainline";
const MENU_CONTINUE_MAINLINE: &str = "continue_mainline";
const MENU_RECOVER_FIRST: &str = "recover_first";
const MENU_REFRESH: &str = "refresh";
const MENU_RESTART_DAEMON: &str = "restart_daemon";
const MENU_QUIT: &str = "quit";
const MENU_SUMMARY_SESSIONS: &str = "summary_sessions";
const MENU_SUMMARY_BLOCKED: &str = "summary_blocked";
const MENU_SUMMARY_FOCUS: &str = "summary_focus";

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle().clone();
            tauri::async_runtime::block_on(async {
                let _ = ensure_daemon_ready().await;
            });
            install_tray(app)?;
            create_or_focus_window(&app_handle)?;
            spawn_tray_sync_task(app_handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("hello app shell failed to run");
}

fn install_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let menu = build_tray_menu(app, None)?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))
        .expect("tray icon should be valid png");

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Hello App")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| handle_menu_event(app, event.id.as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = create_or_focus_window(&tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn build_tray_menu<R: Runtime, M: Manager<R>>(
    manager: &M,
    summary: Option<&TraySummary>,
) -> tauri::Result<Menu<R>> {
    let sessions_label = summary
        .map(|summary| format!("Sessions: {}", summary.session_count))
        .unwrap_or_else(|| "Sessions: --".to_string());
    let blocked_label = summary
        .map(|summary| format!("Blocked: {}", summary.blocked_count))
        .unwrap_or_else(|| "Blocked: --".to_string());
    let focus_label = summary
        .map(|summary| {
            let compact = summary.focus_summary.trim();
            if compact.is_empty() {
                format!("Workspace: {}", summary.workspace_label)
            } else {
                format!("Focus: {}", compact)
            }
        })
        .unwrap_or_else(|| "Daemon: offline".to_string());

    MenuBuilder::new(manager)
        .text(MENU_OPEN_APP, "Open Hello App")
        .text(MENU_OPEN_SETTINGS, "Open Settings")
        .text(MENU_OPEN_WORKSPACE, "Open Workspace")
        .text(MENU_OPEN_LOGS, "Open Logs")
        .separator()
        .text(MENU_SUMMARY_SESSIONS, sessions_label)
        .text(MENU_SUMMARY_BLOCKED, blocked_label)
        .text(MENU_SUMMARY_FOCUS, focus_label)
        .separator()
        .text(MENU_PAUSE_MAINLINE, "Pause Mainline")
        .text(MENU_CONTINUE_MAINLINE, "Continue Mainline")
        .text(MENU_RECOVER_FIRST, "Recover First Session")
        .text(MENU_REFRESH, "Refresh")
        .text(MENU_RESTART_DAEMON, "Restart Daemon")
        .separator()
        .text(MENU_QUIT, "Quit")
        .build()
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        MENU_OPEN_APP => {
            let _ = create_or_focus_window(app);
        }
        MENU_OPEN_SETTINGS => {
            let _ = show_app_view(app, "settings");
        }
        MENU_OPEN_WORKSPACE => {
            tauri::async_runtime::spawn({
                let app = app.clone();
                async move {
                    if let Some(path) = current_workspace_dir().await {
                        let _ = open_path(&path);
                    } else {
                        let _ = create_or_focus_window(&app);
                    }
                }
            });
        }
        MENU_OPEN_LOGS => {
            tauri::async_runtime::spawn(async {
                if let Some(path) = logs_dir().await {
                    let _ = open_path(&path);
                }
            });
        }
        MENU_PAUSE_MAINLINE => spawn_control(app, "/api/v1/control/pause-mainline"),
        MENU_CONTINUE_MAINLINE => spawn_control(app, "/api/v1/control/continue-mainline"),
        MENU_RECOVER_FIRST => spawn_control(app, "/api/v1/control/recover-first"),
        MENU_REFRESH => spawn_control(app, "/api/v1/control/refresh"),
        MENU_RESTART_DAEMON => {
            tauri::async_runtime::spawn({
                let app = app.clone();
                async move {
                    let _ = restart_daemon().await;
                    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
                        let _ = sync_window_location(&window);
                    }
                    let _ = refresh_tray_status(&app).await;
                }
            });
        }
        MENU_QUIT => app.exit(0),
        _ => {}
    }
}

fn spawn_control(app: &AppHandle, path: &'static str) {
    tauri::async_runtime::spawn({
        let app = app.clone();
        async move {
            let _ = control_post(path).await;
            let _ = refresh_tray_status(&app).await;
        }
    });
}

fn spawn_tray_sync_task(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let _ = refresh_tray_status(&app).await;
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}

async fn refresh_tray_status(app: &AppHandle) -> tauri::Result<()> {
    let summary = fetch_tray_summary().await.ok();
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let menu = build_tray_menu(app, summary.as_ref())?;
        tray.set_menu(Some(menu))?;
        if let Some(summary) = summary {
            tray.set_tooltip(Some(format!(
                "Hello App · {} sessions · {} blocked",
                summary.session_count, summary.blocked_count
            )))?;
        } else {
            tray.set_tooltip(Some("Hello App · daemon offline"))?;
        }
    }
    Ok(())
}

fn create_or_focus_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = sync_window_location(&window);
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }

    let url = WebviewUrl::External(app_url().parse().expect("hello app url should be valid"));
    let window = WebviewWindowBuilder::new(app, WINDOW_LABEL, url)
        .title("Hello App")
        .inner_size(1640.0, 1040.0)
        .min_inner_size(1180.0, 780.0)
        .resizable(true)
        .center()
        .build()?;

    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

fn show_app_view(app: &AppHandle, view: &str) -> tauri::Result<()> {
    create_or_focus_window(app)?;
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = sync_window_location(&window);
        let script = format!(
            "localStorage.setItem('hello-app-view', '{}'); if (window.__HELLO_APP_NAVIGATE) {{ window.__HELLO_APP_NAVIGATE('{}'); }}",
            view, view
        );
        let _ = window.eval(&script);
    }
    Ok(())
}

fn sync_window_location(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let url_literal = format!("{:?}", app_url());
    window.eval(&format!(
        "if (window.location.href !== {url_literal}) {{ window.location.replace({url_literal}); }}"
    ))
}

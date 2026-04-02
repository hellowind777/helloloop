use std::env;
use std::error::Error;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use crate::api::{app_url, daemon_url};

pub fn daemon_binary_path() -> PathBuf {
    let file_name = if cfg!(windows) {
        "hello-daemon.exe"
    } else {
        "hello-daemon"
    };

    env::current_exe()
        .ok()
        .map(|path| path.with_file_name(file_name))
        .filter(|path| path.exists())
        .unwrap_or_else(|| PathBuf::from(file_name))
}

pub fn open_app_target() -> Result<String, Box<dyn Error>> {
    if let Some(app_shell) = app_shell_binary_path() {
        let mut command = Command::new(&app_shell);
        command
            .env("HELLO_DAEMON_URL", daemon_url())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        apply_windows_hidden_flags(&mut command);
        command.spawn()?;
        return Ok(app_shell.display().to_string());
    }

    let url = app_url();
    open_in_browser(&url)?;
    Ok(url)
}

pub fn open_in_browser(url: &str) -> Result<(), Box<dyn Error>> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("rundll32");
        command.arg("url.dll,FileProtocolHandler").arg(url);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };

    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    apply_windows_hidden_flags(&mut command);
    command.spawn()?;
    Ok(())
}

pub fn apply_windows_hidden_flags(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

fn app_shell_binary_path() -> Option<PathBuf> {
    let file_name = if cfg!(windows) {
        "hello-app-shell.exe"
    } else {
        "hello-app-shell"
    };

    let dev_shell = env::current_dir()
        .ok()
        .map(|path| {
            path.join("apps")
                .join("hello-app")
                .join("src-tauri")
                .join("target")
                .join("debug")
                .join(file_name)
        })
        .filter(|path| path.exists());

    env::current_exe()
        .ok()
        .map(|path| path.with_file_name(file_name))
        .filter(|path| path.exists())
        .or(dev_shell)
}

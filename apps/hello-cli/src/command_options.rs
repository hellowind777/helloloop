use std::error::Error;
use std::path::Path;

#[derive(Debug, Default, Clone)]
pub struct DaemonLaunchOptions {
    pub workspace: Option<String>,
    pub tool_root: Option<String>,
    pub db: Option<String>,
    pub bind: Option<String>,
    pub node_bin: Option<String>,
    pub config_dir_name: Option<String>,
}

#[derive(Debug, Default, Clone)]
pub struct RecoverOptions {
    pub session_id: Option<String>,
    pub action_key: Option<String>,
    pub as_json: bool,
}

#[derive(Debug, Default, Clone)]
pub struct ConnectOptions {
    pub as_json: bool,
    pub open: bool,
    pub workspace: Option<String>,
    pub docs: Option<String>,
    pub engine: Option<String>,
    pub config_dir_name: Option<String>,
    pub analyze: bool,
}

#[derive(Debug, Default, Clone)]
pub struct ExportOptions {
    pub out_file: String,
    pub pretty: bool,
}

pub fn parse_daemon_launch_options(
    arguments: &[String],
) -> Result<DaemonLaunchOptions, Box<dyn Error>> {
    let mut options = DaemonLaunchOptions::default();
    let mut index = 0usize;

    while index < arguments.len() {
        let argument = arguments[index].as_str();
        let next = arguments.get(index + 1).cloned();

        match argument {
            "--workspace" => {
                options.workspace = Some(expect_flag_value(argument, next)?);
                index += 2;
            }
            "--tool-root" => {
                options.tool_root = Some(expect_flag_value(argument, next)?);
                index += 2;
            }
            "--db" => {
                options.db = Some(expect_flag_value(argument, next)?);
                index += 2;
            }
            "--bind" => {
                options.bind = Some(expect_flag_value(argument, next)?);
                index += 2;
            }
            "--node-bin" => {
                options.node_bin = Some(expect_flag_value(argument, next)?);
                index += 2;
            }
            "--config-dir-name" => {
                options.config_dir_name = Some(expect_flag_value(argument, next)?);
                index += 2;
            }
            other => return Err(format!("unsupported daemon start flag: {other}").into()),
        }
    }

    Ok(options)
}

pub fn parse_recover_options(arguments: &[String]) -> Result<RecoverOptions, Box<dyn Error>> {
    let mut options = RecoverOptions::default();
    let mut index = 0usize;

    while index < arguments.len() {
        match arguments[index].as_str() {
            "--session" => {
                options.session_id = Some(expect_flag_value(
                    "--session",
                    arguments.get(index + 1).cloned(),
                )?);
                index += 2;
            }
            "--action" => {
                options.action_key = Some(expect_flag_value(
                    "--action",
                    arguments.get(index + 1).cloned(),
                )?);
                index += 2;
            }
            "--json" => {
                options.as_json = true;
                index += 1;
            }
            other => return Err(format!("unsupported recover flag: {other}").into()),
        }
    }

    Ok(options)
}

pub fn parse_connect_options(arguments: &[String]) -> Result<ConnectOptions, Box<dyn Error>> {
    let mut options = ConnectOptions::default();
    let mut index = 0usize;

    while index < arguments.len() {
        let next = arguments.get(index + 1).cloned();
        match arguments[index].as_str() {
            "--json" => {
                options.as_json = true;
                index += 1;
            }
            "--open" => {
                options.open = true;
                index += 1;
            }
            "--analyze" => {
                options.analyze = true;
                index += 1;
            }
            "--workspace" => {
                options.workspace = Some(expect_flag_value("--workspace", next)?);
                index += 2;
            }
            "--docs" => {
                options.docs = Some(expect_flag_value("--docs", next)?);
                index += 2;
            }
            "--engine" => {
                options.engine = Some(expect_flag_value("--engine", next)?);
                index += 2;
            }
            "--config-dir-name" => {
                options.config_dir_name = Some(expect_flag_value("--config-dir-name", next)?);
                index += 2;
            }
            other => return Err(format!("unsupported connect flag: {other}").into()),
        }
    }
    Ok(options)
}

pub fn parse_export_options(arguments: &[String]) -> Result<ExportOptions, Box<dyn Error>> {
    let mut options = ExportOptions::default();
    let mut index = 0usize;

    while index < arguments.len() {
        match arguments[index].as_str() {
            "--out" => {
                options.out_file = expect_flag_value("--out", arguments.get(index + 1).cloned())?;
                index += 2;
            }
            "--pretty" => {
                options.pretty = true;
                index += 1;
            }
            other => return Err(format!("unsupported export flag: {other}").into()),
        }
    }

    if options.out_file.trim().is_empty() {
        return Err("missing value for --out".into());
    }
    if let Some(parent) = Path::new(&options.out_file)
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)?;
    }

    Ok(options)
}

fn expect_flag_value(flag: &str, value: Option<String>) -> Result<String, Box<dyn Error>> {
    value
        .filter(|item| !item.starts_with("--"))
        .ok_or_else(|| format!("missing value for {flag}").into())
}

#[cfg(test)]
mod tests {
    use super::{parse_connect_options, parse_export_options};

    #[test]
    fn export_options_require_out_file() {
        assert!(parse_export_options(&["--pretty".to_string()]).is_err());
    }

    #[test]
    fn connect_options_support_workspace_and_analysis() {
        let options = parse_connect_options(&[
            "--workspace".to_string(),
            "D:/repo".to_string(),
            "--docs".to_string(),
            "docs".to_string(),
            "--engine".to_string(),
            "claude".to_string(),
            "--config-dir-name".to_string(),
            ".hello".to_string(),
            "--analyze".to_string(),
            "--open".to_string(),
            "--json".to_string(),
        ])
        .expect("connect options should parse");

        assert_eq!(options.workspace.as_deref(), Some("D:/repo"));
        assert_eq!(options.docs.as_deref(), Some("docs"));
        assert_eq!(options.engine.as_deref(), Some("claude"));
        assert_eq!(options.config_dir_name.as_deref(), Some(".hello"));
        assert!(options.analyze);
        assert!(options.open);
        assert!(options.as_json);
    }
}

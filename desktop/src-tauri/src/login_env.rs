//! GUI apps do not inherit the login shell's PATH, so nvm and Homebrew CLIs would not be found.

use std::{collections::HashMap, ffi::OsString, path::PathBuf, process::Stdio, time::Duration};
use tokio::{process::Command, sync::OnceCell};

const MARKER: &str = "__TANDEM_ENV_START__";
static LOGIN_ENV: OnceCell<HashMap<String, String>> = OnceCell::const_new();

pub async fn login_env() -> &'static HashMap<String, String> {
    LOGIN_ENV.get_or_init(read_login_env).await
}

async fn read_login_env() -> HashMap<String, String> {
    let fallback = || std::env::vars().collect::<HashMap<_, _>>();
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let output = Command::new(shell)
        .args(["-ilc", &format!("printf {MARKER}; env -0")])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .output();
    match tokio::time::timeout(Duration::from_secs(10), output).await {
        Ok(Ok(output)) => {
            let parsed = parse_env_output(&String::from_utf8_lossy(&output.stdout));
            if parsed.contains_key("PATH") {
                parsed
            } else {
                fallback()
            }
        }
        _ => fallback(),
    }
}

/// Shell startup files may print text, so only what follows the marker is read.
fn parse_env_output(output: &str) -> HashMap<String, String> {
    let Some((_, body)) = output.rsplit_once(MARKER) else {
        return HashMap::new();
    };
    body.split('\0')
        .filter_map(|entry| entry.split_once('='))
        .map(|(key, value)| (key.to_owned(), value.to_owned()))
        .collect()
}

pub fn find_in_path(program: &str, path: Option<&String>) -> Option<PathBuf> {
    let path = path.map(OsString::from)?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(program))
        .find(|candidate| is_executable(candidate))
}

fn is_executable(path: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_text_printed_by_shell_startup_files() {
        let output = format!("welcome=banner\n{MARKER}PATH=/a:/b\0HOME=/h\0");
        let env = parse_env_output(&output);
        assert_eq!(env.get("PATH").map(String::as_str), Some("/a:/b"));
        assert_eq!(env.get("HOME").map(String::as_str), Some("/h"));
        assert!(!env.contains_key("welcome"));
    }

    #[test]
    fn output_without_marker_is_empty() {
        assert!(parse_env_output("PATH=/a").is_empty());
    }

    #[test]
    fn finds_only_executable_files() {
        let dir = tempfile::tempdir().unwrap();
        let plain = dir.path().join("plain");
        std::fs::write(&plain, "").unwrap();
        let tool = dir.path().join("tool");
        std::fs::write(&tool, "").unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o755)).unwrap();
        let path = dir.path().to_string_lossy().to_string();
        assert_eq!(find_in_path("tool", Some(&path)), Some(tool));
        assert_eq!(find_in_path("plain", Some(&path)), None);
    }
}

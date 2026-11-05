//! Which agent CLIs the user has installed. Tandem only looks: it never installs or updates them.

use crate::login_env;
use serde::Serialize;
use std::{process::Stdio, time::Duration};
use tokio::process::Command;

const VERSION_TIMEOUT: Duration = Duration::from_secs(5);
const AGENTS: [&str; 3] = ["claude", "codex", "pi"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    command: &'static str,
    path: Option<String>,
    version: Option<String>,
}

pub async fn read() -> Vec<AgentStatus> {
    let env = login_env::login_env().await;
    let mut statuses = Vec::new();
    for command in AGENTS {
        let path = login_env::find_in_path(command, env.get("PATH"));
        let mut version = None;
        if let Some(program) = &path {
            let run = Command::new(program)
                .arg("--version")
                .env_clear()
                .envs(env.clone())
                .stdin(Stdio::null())
                .kill_on_drop(true)
                .output();
            if let Ok(Ok(output)) = tokio::time::timeout(VERSION_TIMEOUT, run).await {
                version = first_line(&output.stdout).or_else(|| first_line(&output.stderr));
            }
        }
        statuses.push(AgentStatus {
            command,
            path: path.map(|path| path.to_string_lossy().into_owned()),
            version,
        });
    }
    statuses
}

fn first_line(bytes: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(bytes);
    let line = text.lines().map(str::trim).find(|line| !line.is_empty())?;
    Some(line.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_the_first_line_with_text() {
        assert_eq!(first_line(b"\n 2.1.318 (Claude Code)\nmore").unwrap(), "2.1.318 (Claude Code)");
        assert!(first_line(b"\n  \n").is_none());
    }
}

//! The agent CLIs on this machine: what is installed, who is logged in, and installing or logging
//! in when the user asks. Tandem never bundles or updates them on its own.

use crate::login_env;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::oneshot;

const STATUS_TIMEOUT: Duration = Duration::from_secs(5);
/// A login waits for the user in the browser, and an install downloads, so both get a long time.
const JOB_TIMEOUT: Duration = Duration::from_secs(600);
const AGENTS: [&str; 3] = ["claude", "codex", "pi"];

/// The npm package each CLI comes from.
fn npm_package(command: &str) -> Option<&'static str> {
    match command {
        "claude" => Some("@anthropic-ai/claude-code"),
        "codex" => Some("@openai/codex"),
        "pi" => Some("@earendil-works/pi-coding-agent"),
        _ => None,
    }
}

/// Pi has no login of its own here: its models and keys are configured outside Tandem.
fn login_args(command: &str) -> Option<&'static [&'static str]> {
    match command {
        "claude" => Some(&["auth", "login"]),
        "codex" => Some(&["login"]),
        _ => None,
    }
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoginStatus {
    logged_in: bool,
    detail: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    command: &'static str,
    installed: bool,
    version: Option<String>,
    login: Option<LoginStatus>,
}

async fn run_for_output(program: &Path, args: &[&str], env: &HashMap<String, String>) -> Option<std::process::Output> {
    let run = Command::new(program)
        .args(args)
        .env_clear()
        .envs(env)
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .output();
    tokio::time::timeout(STATUS_TIMEOUT, run).await.ok()?.ok()
}

fn first_line(bytes: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(bytes);
    let line = text.lines().map(str::trim).find(|line| !line.is_empty())?;
    Some(line.to_owned())
}

/// CLIs add their own name around the number, such as `codex-cli 0.166.0`.
fn version_number(line: &str) -> String {
    let number = line.split_whitespace().find(|word| word.starts_with(|c: char| c.is_ascii_digit()));
    number.unwrap_or(line).to_owned()
}

fn claude_login(stdout: &[u8]) -> Option<LoginStatus> {
    let value: serde_json::Value = serde_json::from_slice(stdout).ok()?;
    Some(LoginStatus {
        logged_in: value.get("loggedIn")?.as_bool()?,
        detail: value.get("email").and_then(|email| email.as_str()).map(str::to_owned),
    })
}

async fn login_status(command: &str, program: &Path, env: &HashMap<String, String>) -> Option<LoginStatus> {
    match command {
        "claude" => {
            let output = run_for_output(program, &["auth", "status", "--json"], env).await?;
            claude_login(&output.stdout)
        }
        "codex" => {
            let output = run_for_output(program, &["login", "status"], env).await?;
            // It reports on stderr in some versions, and the exit code is what decides.
            let line = first_line(&output.stdout).or_else(|| first_line(&output.stderr));
            let detail = line.filter(|_| output.status.success()).map(|line| {
                line.strip_prefix("Logged in using ").map(str::to_owned).unwrap_or(line)
            });
            Some(LoginStatus { logged_in: output.status.success(), detail })
        }
        _ => None,
    }
}

pub async fn read() -> Vec<AgentStatus> {
    let env = login_env::login_env().await;
    let mut statuses = Vec::new();
    for command in AGENTS {
        let Some(program) = login_env::find_in_path(command, env.get("PATH")) else {
            statuses.push(AgentStatus { command, installed: false, version: None, login: None });
            continue;
        };
        let output = run_for_output(&program, &["--version"], env).await;
        let version = output.and_then(|output| first_line(&output.stdout).or_else(|| first_line(&output.stderr)));
        let version = version.map(|line| version_number(&line));
        let login = login_status(command, &program, env).await;
        statuses.push(AgentStatus { command, installed: true, version, login });
    }
    statuses
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum JobEvent {
    Line { text: String },
    Finished { ok: bool },
}

/// At most one install or login runs at a time, and the page can stop it.
#[derive(Default)]
pub struct Jobs(Mutex<Option<oneshot::Sender<()>>>);

impl Jobs {
    pub fn stop(&self) {
        if let Ok(mut job) = self.0.lock() {
            if let Some(stop) = job.take() {
                let _ = stop.send(());
            }
        }
    }

    fn begin(&self) -> Result<oneshot::Receiver<()>, String> {
        let mut job = self.0.lock().map_err(|error| error.to_string())?;
        if job.as_ref().is_some_and(|stop| !stop.is_closed()) {
            return Err("Another install or login is still running".into());
        }
        let (stop, stopped) = oneshot::channel();
        *job = Some(stop);
        Ok(stopped)
    }

    fn finish(&self) {
        if let Ok(mut job) = self.0.lock() {
            *job = None;
        }
    }
}

async fn program_for(name: &str) -> Result<(PathBuf, &'static HashMap<String, String>), String> {
    let env = login_env::login_env().await;
    let program = login_env::find_in_path(name, env.get("PATH"))
        .ok_or_else(|| format!("{name} was not found in the login shell PATH"))?;
    Ok((program, env))
}

async fn run_job(
    program: &Path,
    args: &[&str],
    env: &HashMap<String, String>,
    mut stopped: oneshot::Receiver<()>,
    on_event: &(impl Fn(JobEvent) + Sync),
) -> Result<bool, String> {
    let mut child = Command::new(program)
        .args(args)
        .env_clear()
        .envs(env)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| error.to_string())?;
    let mut stdout = BufReader::new(child.stdout.take().ok_or("no stdout")?).lines();
    let mut stderr = BufReader::new(child.stderr.take().ok_or("no stderr")?).lines();
    let forward = |line: String| {
        if !line.trim().is_empty() {
            on_event(JobEvent::Line { text: line });
        }
    };
    let pump = async {
        let (mut out_open, mut err_open) = (true, true);
        while out_open || err_open {
            tokio::select! {
                line = stdout.next_line(), if out_open => match line {
                    Ok(Some(line)) => forward(line),
                    _ => out_open = false,
                },
                line = stderr.next_line(), if err_open => match line {
                    Ok(Some(line)) => forward(line),
                    _ => err_open = false,
                },
            }
        }
    };
    tokio::select! {
        result = tokio::time::timeout(JOB_TIMEOUT, pump) => {
            if result.is_err() {
                return Ok(false);
            }
        }
        _ = &mut stopped => return Ok(false),
    }
    let status = child.wait().await.map_err(|error| error.to_string())?;
    Ok(status.success())
}

async fn finish_job(jobs: &Jobs, result: Result<bool, String>, on_event: Channel<JobEvent>) -> Result<(), String> {
    jobs.finish();
    let ok = match result {
        Ok(ok) => ok,
        Err(error) => {
            let _ = on_event.send(JobEvent::Line { text: error });
            false
        }
    };
    on_event.send(JobEvent::Finished { ok }).map_err(|error| error.to_string())
}

/// Only runs when the user clicks install, and only for a package on this list.
pub async fn install(jobs: &Jobs, command: &str, on_event: Channel<JobEvent>) -> Result<(), String> {
    let package = npm_package(command).ok_or("Unknown agent")?;
    let stopped = jobs.begin()?;
    let result = match program_for("npm").await {
        Ok((npm, env)) => {
            let send = |event| drop(on_event.send(event));
            run_job(&npm, &["install", "-g", package], env, stopped, &send).await
        }
        Err(error) => Err(error),
    };
    finish_job(jobs, result, on_event).await
}

/// The CLI runs its own login, which opens the browser and stores its own credentials.
pub async fn login(jobs: &Jobs, command: &str, on_event: Channel<JobEvent>) -> Result<(), String> {
    let args = login_args(command).ok_or("This agent has no login here")?;
    let stopped = jobs.begin()?;
    let result = match program_for(command).await {
        Ok((program, env)) => {
            let send = |event| drop(on_event.send(event));
            run_job(&program, args, env, stopped, &send).await
        }
        Err(error) => Err(error),
    };
    finish_job(jobs, result, on_event).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_the_first_line_with_text() {
        assert_eq!(first_line(b"\n 2.1.318 (Claude Code)\nmore").unwrap(), "2.1.318 (Claude Code)");
        assert!(first_line(b"\n  \n").is_none());
    }

    #[test]
    fn keeps_only_the_version_number() {
        assert_eq!(version_number("2.1.318 (Claude Code)"), "2.1.318");
        assert_eq!(version_number("codex-cli 0.166.0"), "0.166.0");
        assert_eq!(version_number("unknown"), "unknown");
    }

    #[test]
    fn only_known_agents_can_be_installed_or_logged_in() {
        assert_eq!(npm_package("codex"), Some("@openai/codex"));
        assert_eq!(npm_package("rm -rf /"), None);
        assert!(login_args("claude").is_some());
        assert!(login_args("pi").is_none());
    }

    #[test]
    fn reads_claude_login_status() {
        let status = claude_login(br#"{"loggedIn":true,"email":"a@b.c"}"#).unwrap();
        assert_eq!(status, LoginStatus { logged_in: true, detail: Some("a@b.c".into()) });
        assert!(!claude_login(br#"{"loggedIn":false}"#).unwrap().logged_in);
        assert!(claude_login(b"not json").is_none());
    }

    fn collect() -> (std::sync::Arc<Mutex<Vec<JobEvent>>>, impl Fn(JobEvent) + Sync) {
        let events = std::sync::Arc::new(Mutex::new(Vec::new()));
        let sink = std::sync::Arc::clone(&events);
        (events, move |event| sink.lock().unwrap().push(event))
    }

    #[tokio::test]
    async fn a_job_reports_both_streams_and_whether_it_worked() {
        let (events, send) = collect();
        let (_stop, stopped) = oneshot::channel();
        let ok = run_job(Path::new("/bin/sh"), &["-c", "echo out; echo err >&2; exit 3"], &HashMap::new(), stopped, &send).await.unwrap();
        assert!(!ok);
        let events = events.lock().unwrap();
        assert!(events.contains(&JobEvent::Line { text: "out".into() }));
        assert!(events.contains(&JobEvent::Line { text: "err".into() }));
    }

    #[tokio::test]
    async fn a_job_can_be_stopped() {
        let (_events, send) = collect();
        let (stop, stopped) = oneshot::channel();
        stop.send(()).unwrap();
        let ok = run_job(Path::new("/bin/sleep"), &["30"], &HashMap::new(), stopped, &send).await.unwrap();
        assert!(!ok);
    }

    #[test]
    fn one_job_at_a_time() {
        let jobs = Jobs::default();
        let first = jobs.begin().unwrap();
        assert!(jobs.begin().is_err());
        drop(first);
        assert!(jobs.begin().is_ok());
    }
}

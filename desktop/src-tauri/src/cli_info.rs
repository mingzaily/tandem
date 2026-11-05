//! Asks the CLI for its model list and plan usage. Neither starts a model request.

use crate::login_env;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{process::Stdio, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
};

const TIMEOUT: Duration = Duration::from_secs(20);
const INITIALIZE_ID: &str = "tandem-initialize";
const USAGE_ID: &str = "tandem-usage";

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ModelOption {
    pub value: String,
    pub display_name: String,
    pub description: String,
    pub resolved_model: String,
    pub supports_effort: bool,
    pub supported_effort_levels: Vec<String>,
    pub supports_auto_mode: bool,
}

/// `resets_at` is passed on as the CLI sent it: seconds in the stream, an ISO date from `get_usage`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub used_percent: f64,
    pub resets_at: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindows {
    pub five_hour: Option<UsageWindow>,
    pub seven_day: Option<UsageWindow>,
}

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInfo {
    pub models: Vec<ModelOption>,
    pub usage: Option<UsageWindows>,
}

/// Utilization is a percentage from `get_usage`, and a fraction in the stream.
fn usage_window(window: &Value, scale: f64, reset_key: &str) -> Option<UsageWindow> {
    Some(UsageWindow {
        used_percent: window.get("utilization")?.as_f64()? * scale,
        resets_at: window.get(reset_key)?.clone(),
    })
}

fn windows(limits: &Value, scale: f64, reset_key: &str) -> Option<UsageWindows> {
    let read = |key: &str| limits.get(key).and_then(|window| usage_window(window, scale, reset_key));
    let (five_hour, seven_day) = (read("five_hour"), read("seven_day"));
    (five_hour.is_some() || seven_day.is_some()).then_some(UsageWindows { five_hour, seven_day })
}

pub fn parse_stream_windows(limits: &Value) -> Option<UsageWindows> {
    windows(limits, 100.0, "resetsAt")
}

/// Applies one line of output. Returns true once both answers have arrived.
fn apply_line(line: &str, info: &mut CliInfo, seen: &mut (bool, bool)) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return seen.0 && seen.1;
    };
    if value.get("type").and_then(Value::as_str) != Some("control_response") {
        return seen.0 && seen.1;
    }
    let response = value.get("response").unwrap_or(&Value::Null);
    let body = response.get("response").unwrap_or(&Value::Null);
    match response.get("request_id").and_then(Value::as_str) {
        Some(INITIALIZE_ID) => {
            seen.0 = true;
            info.models = body
                .get("models")
                .cloned()
                .and_then(|models| serde_json::from_value(models).ok())
                .unwrap_or_default();
        }
        Some(USAGE_ID) => {
            seen.1 = true;
            // Accounts billed by API key have no plan limits to show.
            info.usage = body.get("rate_limits").and_then(|limits| windows(limits, 1.0, "resets_at"));
        }
        _ => {}
    }
    seen.0 && seen.1
}

pub async fn read() -> Result<CliInfo, String> {
    let env = login_env::login_env().await;
    let program = login_env::find_in_path("claude", env.get("PATH"))
        .ok_or("claude was not found in the login shell PATH")?;
    let home = env.get("HOME").cloned().ok_or("HOME is not set")?;
    let mut child = Command::new(program)
        .args([
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            // No session file, no project settings and no MCP servers for a question this small.
            "--no-session-persistence",
            "--strict-mcp-config",
            "--setting-sources",
            "user",
        ])
        .current_dir(home)
        .env_clear()
        .envs(env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("Failed to start claude: {error}"))?;

    let mut stdin = child.stdin.take().ok_or("claude has no stdin")?;
    let request = |id: &str, body: Value| {
        format!("{}\n", json!({"type": "control_request", "request_id": id, "request": body}))
    };
    let requests = request(INITIALIZE_ID, json!({"subtype": "initialize"}))
        + &request(USAGE_ID, json!({"subtype": "get_usage", "skip_behaviors": true}));
    stdin.write_all(requests.as_bytes()).await.map_err(|error| error.to_string())?;

    let stdout = child.stdout.take().ok_or("claude has no stdout")?;
    let mut lines = BufReader::new(stdout).lines();
    let mut info = CliInfo::default();
    let mut seen = (false, false);
    let reading = async {
        while let Ok(Some(line)) = lines.next_line().await {
            if apply_line(&line, &mut info, &mut seen) {
                break;
            }
        }
    };
    let finished = tokio::time::timeout(TIMEOUT, reading).await;
    drop(stdin);
    let _ = child.kill().await;
    finished.map_err(|_| "claude did not answer in time".to_owned())?;
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_models_and_usage_from_both_answers() {
        let mut info = CliInfo::default();
        let mut seen = (false, false);
        let init = r#"{"type":"control_response","response":{"subtype":"success","request_id":"tandem-initialize","response":{"models":[{"value":"opus","displayName":"Opus","supportsEffort":true,"supportedEffortLevels":["high"],"supportsAutoMode":true,"unknown":1}]}}}"#;
        assert!(!apply_line(init, &mut info, &mut seen));
        assert!(!apply_line(r#"{"type":"system"}"#, &mut info, &mut seen));
        let usage = r#"{"type":"control_response","response":{"subtype":"success","request_id":"tandem-usage","response":{"rate_limits":{"five_hour":{"utilization":50,"resets_at":"2026-11-04T12:00:00Z"},"seven_day":null}}}}"#;
        assert!(apply_line(usage, &mut info, &mut seen));
        assert_eq!(info.models[0].display_name, "Opus");
        assert_eq!(info.models[0].supported_effort_levels, ["high"]);
        let usage = info.usage.unwrap();
        assert_eq!(usage.five_hour.unwrap().used_percent, 50.0);
        assert_eq!(usage.seven_day, None);
    }

    #[test]
    fn accounts_without_plan_limits_show_no_usage() {
        let mut info = CliInfo::default();
        let mut seen = (true, false);
        let line = r#"{"type":"control_response","response":{"subtype":"success","request_id":"tandem-usage","response":{"rate_limits_available":false}}}"#;
        assert!(apply_line(line, &mut info, &mut seen));
        assert_eq!(info.usage, None);
    }

    #[test]
    fn stream_windows_report_fractions_as_percentages() {
        let limits = json!({"five_hour": {"utilization": 0.5, "resetsAt": 1793796600}});
        let windows = parse_stream_windows(&limits).unwrap();
        assert_eq!(windows.five_hour.unwrap().used_percent, 50.0);
    }
}

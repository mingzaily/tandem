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
const EFFORTS_TIMEOUT: Duration = Duration::from_secs(3);
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
    /// The level this model runs at when Tandem passes none.
    pub default_effort: Option<String>,
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
fn apply_line(line: &str, info: &mut CliInfo, seen: &mut (bool, bool)) -> Result<bool, String> {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return Ok(seen.0 && seen.1);
    };
    if value.get("type").and_then(Value::as_str) != Some("control_response") {
        return Ok(seen.0 && seen.1);
    }
    let response = value.get("response").unwrap_or(&Value::Null);
    let body = response.get("response").unwrap_or(&Value::Null);
    match response.get("request_id").and_then(Value::as_str) {
        Some(INITIALIZE_ID) => {
            if response.get("subtype").and_then(Value::as_str) != Some("success") {
                return Err(response.get("error").and_then(Value::as_str).unwrap_or("Claude 模型初始化失败").to_owned());
            }
            let models = body.get("models").ok_or("Claude 初始化响应缺少模型列表")?;
            info.models = serde_json::from_value(models.clone()).map_err(|error| format!("Claude 模型列表格式有误：{error}"))?;
            seen.0 = true;
        }
        Some(USAGE_ID) => {
            if response.get("subtype").and_then(Value::as_str) != Some("success") {
                return Err(response.get("error").and_then(Value::as_str).unwrap_or("Claude 额度读取失败").to_owned());
            }
            seen.1 = true;
            // Accounts billed by API key have no plan limits to show.
            info.usage = body.get("rate_limits").and_then(|limits| windows(limits, 1.0, "resets_at"));
        }
        _ => {}
    }
    Ok(seen.0 && seen.1)
}

async fn read_initial_info<R: tokio::io::AsyncBufRead + Unpin>(lines: &mut tokio::io::Lines<R>) -> Result<CliInfo, String> {
    let mut info = CliInfo::default();
    let mut seen = (false, false);
    while let Some(line) = lines.next_line().await.map_err(|error| error.to_string())? {
        if apply_line(&line, &mut info, &mut seen)? { return Ok(info); }
    }
    Err("Claude 在返回模型信息前退出".into())
}

/// Claude reports the effort it would use only for the current model, so this walks through them.
/// The change lasts as long as this process and is saved nowhere. Each answer is awaited, because
/// the next question would otherwise see the previous model.
async fn read_default_efforts<W, R>(stdin: &mut W, lines: &mut tokio::io::Lines<R>, info: &mut CliInfo)
where
    W: tokio::io::AsyncWrite + Unpin,
    R: tokio::io::AsyncBufRead + Unpin,
{
    'models: for model in info.models.iter_mut().filter(|model| model.supports_effort) {
        model.default_effort = None;
        let requests = [
            ("tandem-set-model", json!({"subtype": "set_model", "model": model.value})),
            ("tandem-get-settings", json!({"subtype": "get_settings"})),
        ];
        let mut settings = Value::Null;
        for (id, body) in requests {
            let line = format!("{}\n", json!({"type": "control_request", "request_id": id, "request": body}));
            if stdin.write_all(line.as_bytes()).await.is_err() {
                return;
            }
            loop {
                let Ok(Some(answer)) = lines.next_line().await else {
                    return;
                };
                let Ok(value) = serde_json::from_str::<Value>(&answer) else {
                    continue;
                };
                let response = value.get("response").unwrap_or(&Value::Null);
                if response.get("request_id").and_then(Value::as_str) == Some(id) {
                    // A rejected model switch leaves the prior model active in this process.
                    if response.get("subtype").and_then(Value::as_str) != Some("success") {
                        continue 'models;
                    }
                    settings = response.clone();
                    break;
                }
            }
        }
        model.default_effort = applied_effort(&settings).filter(|effort| model.supported_effort_levels.contains(effort));
    }
}

fn applied_effort(settings: &Value) -> Option<String> {
    settings.get("response")?.get("applied")?.get("effort")?.as_str().map(str::to_owned)
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
    let mut info = tokio::time::timeout(TIMEOUT, read_initial_info(&mut lines)).await
        .map_err(|_| "Claude 读取模型信息超过 20 秒".to_owned())??;
    // The model list remains usable when the CLI cannot report an applied default.
    let _ = tokio::time::timeout(EFFORTS_TIMEOUT, read_default_efforts(&mut stdin, &mut lines, &mut info)).await;
    drop(stdin);
    let _ = child.kill().await;
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_read_errors_keep_the_previous_limits() {
        let mut info = CliInfo { usage: Some(UsageWindows { five_hour: Some(UsageWindow {
            used_percent: 84.0, resets_at: json!("2026-11-07T00:00:00Z"),
        }), seven_day: None }), ..Default::default() };
        let previous = info.usage.clone();
        let mut seen = (true, false);
        let reply = json!({"type":"control_response","response":{
            "request_id": USAGE_ID, "subtype":"error", "error":"usage service unavailable"
        }});
        assert_eq!(apply_line(&reply.to_string(), &mut info, &mut seen), Err("usage service unavailable".into()));
        assert_eq!(info.usage, previous);
        assert!(!seen.1);
    }

    #[test]
    fn reads_the_effort_a_model_would_use() {
        let answer = json!({"subtype": "success", "response": {"applied": {"model": "m", "effort": "high"}}});
        assert_eq!(applied_effort(&answer).as_deref(), Some("high"));
        assert_eq!(applied_effort(&json!({"subtype": "error"})), None);
    }

    #[test]
    fn a_rejected_model_switch_never_borrows_the_previous_models_default() {
        tauri::async_runtime::block_on(async {
            let mut info = CliInfo { models: ["first", "rejected", "last"].into_iter().map(|value| ModelOption {
                value: value.into(), supports_effort: true, supported_effort_levels: vec!["low".into(), "max".into()], ..Default::default()
            }).collect(), usage: None };
            let reply = |id: &str, subtype: &str, effort: &str| json!({"type":"control_response", "response":{"request_id":id,"subtype":subtype,"response":{"applied":{"effort":effort}}}}).to_string();
            let replies = [
                reply("tandem-set-model", "success", ""), reply("tandem-get-settings", "success", "low"),
                reply("tandem-set-model", "error", ""),
                reply("tandem-set-model", "success", ""), reply("tandem-get-settings", "success", "max"),
            ].join("\n") + "\n";
            let mut lines = BufReader::new(replies.as_bytes()).lines();
            read_default_efforts(&mut tokio::io::sink(), &mut lines, &mut info).await;
            assert_eq!(info.models.iter().map(|model| model.default_effort.as_deref()).collect::<Vec<_>>(), [Some("low"), None, Some("max")]);
        });
    }

    #[test]
    fn collects_models_and_usage_from_both_answers() {
        let mut info = CliInfo::default();
        let mut seen = (false, false);
        let init = r#"{"type":"control_response","response":{"subtype":"success","request_id":"tandem-initialize","response":{"models":[{"value":"opus","displayName":"Opus","supportsEffort":true,"supportedEffortLevels":["high"],"supportsAutoMode":true,"unknown":1}]}}}"#;
        assert!(!apply_line(init, &mut info, &mut seen).unwrap());
        assert!(!apply_line(r#"{"type":"system"}"#, &mut info, &mut seen).unwrap());
        let usage = r#"{"type":"control_response","response":{"subtype":"success","request_id":"tandem-usage","response":{"rate_limits":{"five_hour":{"utilization":50,"resets_at":"2026-11-04T12:00:00Z"},"seven_day":null}}}}"#;
        assert!(apply_line(usage, &mut info, &mut seen).unwrap());
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
        assert!(apply_line(line, &mut info, &mut seen).unwrap());
        assert_eq!(info.usage, None);
    }

    #[test]
    fn model_initialization_errors_keep_their_reason() {
        let failed = json!({"type":"control_response", "response":{"subtype":"error", "request_id":INITIALIZE_ID, "error":"登录已过期"}}).to_string();
        assert_eq!(apply_line(&failed, &mut CliInfo::default(), &mut (false, false)).unwrap_err(), "登录已过期");
        let malformed = json!({"type":"control_response", "response":{"subtype":"success", "request_id":INITIALIZE_ID, "response":{"models":"invalid"}}}).to_string();
        assert!(apply_line(&malformed, &mut CliInfo::default(), &mut (false, false)).unwrap_err().contains("模型列表格式有误"));
    }

    #[test]
    fn early_process_exit_does_not_replace_cached_models_with_an_empty_list() {
        tauri::async_runtime::block_on(async {
            let mut lines = BufReader::new(b"{\"type\":\"system\"}\n".as_slice()).lines();
            assert_eq!(read_initial_info(&mut lines).await.unwrap_err(), "Claude 在返回模型信息前退出");
        });
    }

    #[test]
    fn stream_windows_report_fractions_as_percentages() {
        let limits = json!({"five_hour": {"utilization": 0.5, "resetsAt": 1793796600}});
        let windows = parse_stream_windows(&limits).unwrap();
        assert_eq!(windows.five_hour.unwrap().used_percent, 50.0);
    }
}

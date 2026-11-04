//! Runs one Claude Code turn per process, so the CLI holds a task only while a turn is running.

use crate::{login_env, sessions};
use serde::Serialize;
use serde_json::{json, Value};
use std::{collections::{HashMap, VecDeque}, path::Path, process::Stdio, sync::{Arc, Mutex}, time::Duration};
use tauri::ipc::Channel;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
    sync::oneshot,
};

const STDERR_TAIL_LINES: usize = 20;
const TERMINATE_GRACE: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum TurnEvent {
    Started { task_id: String },
    TextDelta { text: String },
    ThinkingDelta { text: String },
    ToolUse { id: String, name: String, input: String },
    ToolResult { tool_use_id: String, text: String, is_error: bool },
    Finished {
        is_error: bool,
        cancelled: bool,
        message: Option<String>,
        denied_tools: Vec<String>,
    },
}

#[derive(Default)]
pub struct Runs(Mutex<HashMap<String, oneshot::Sender<()>>>);

impl Runs {
    fn begin(&self, task_id: &str) -> Result<oneshot::Receiver<()>, String> {
        let mut runs = self.0.lock().map_err(|error| error.to_string())?;
        if runs.contains_key(task_id) {
            return Err("This task is already running".into());
        }
        let (sender, receiver) = oneshot::channel();
        runs.insert(task_id.to_owned(), sender);
        Ok(receiver)
    }

    fn finish(&self, task_id: &str) {
        if let Ok(mut runs) = self.0.lock() {
            runs.remove(task_id);
        }
    }

    pub fn cancel(&self, task_id: &str) {
        if let Ok(mut runs) = self.0.lock() {
            if let Some(sender) = runs.remove(task_id) {
                let _ = sender.send(());
            }
        }
    }
}

struct Target {
    task_id: String,
    cwd: String,
    is_new: bool,
}

fn resolve_target(task_id: Option<String>, cwd: Option<String>) -> Result<Target, String> {
    if let Some(task_id) = task_id {
        // A task resumes only from the directory recorded in its own file.
        let path = sessions::find_task_file(&sessions::claude_projects_dir()?, &task_id)?;
        let cwd = sessions::read_task_cwd(&path).ok_or("The task has no working directory")?;
        return Ok(Target { task_id, cwd, is_new: false });
    }
    let cwd = cwd.ok_or("A new task needs a working directory")?;
    Ok(Target {
        task_id: uuid::Uuid::new_v4().to_string(),
        cwd,
        is_new: true,
    })
}

pub async fn send_turn(
    runs: &Runs,
    task_id: Option<String>,
    cwd: Option<String>,
    prompt: String,
    on_event: Channel<TurnEvent>,
) -> Result<(), String> {
    let target = tauri::async_runtime::spawn_blocking(move || resolve_target(task_id, cwd))
        .await
        .map_err(|error| error.to_string())??;
    let cancel = runs.begin(&target.task_id)?;
    let emit = |event| on_event.send(event).map_err(|error| error.to_string());
    let result = async {
        emit(TurnEvent::Started { task_id: target.task_id.clone() })?;
        run_claude(&target, &prompt, cancel, &emit).await
    }
    .await;
    runs.finish(&target.task_id);
    if let Err(message) = &result {
        emit(finished_with_error(message.clone()))?;
    }
    Ok(())
}

async fn run_claude(
    target: &Target,
    prompt: &str,
    mut cancel: oneshot::Receiver<()>,
    emit: &impl Fn(TurnEvent) -> Result<(), String>,
) -> Result<(), String> {
    if !Path::new(&target.cwd).is_dir() {
        return Err(format!("Working directory not found: {}", target.cwd));
    }
    let env = login_env::login_env().await;
    let program = login_env::find_in_path("claude", env.get("PATH"))
        .ok_or("claude was not found in the login shell PATH")?;
    let mut child = Command::new(program)
        .args(claude_args(target))
        .current_dir(&target.cwd)
        .env_clear()
        .envs(env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("Failed to start claude: {error}"))?;

    let mut stdin = child.stdin.take().ok_or("claude has no stdin")?;
    stdin
        .write_all(format!("{}\n", user_input_line(prompt)).as_bytes())
        .await
        .map_err(|error| format!("Failed to send the prompt: {error}"))?;
    stdin.shutdown().await.map_err(|error| error.to_string())?;
    drop(stdin);

    let stderr = child.stderr.take().ok_or("claude has no stderr")?;
    let stderr_tail = Arc::new(Mutex::new(VecDeque::new()));
    let tail = Arc::clone(&stderr_tail);
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Ok(mut tail) = tail.lock() {
                tail.push_back(line);
                if tail.len() > STDERR_TAIL_LINES {
                    tail.pop_front();
                }
            }
        }
    });

    let stdout = child.stdout.take().ok_or("claude has no stdout")?;
    let mut lines = BufReader::new(stdout).lines();
    let mut finished = false;
    loop {
        tokio::select! {
            line = lines.next_line() => {
                let line = line.map_err(|error| error.to_string())?;
                let Some(line) = line else { break };
                for event in parse_stream_line(&line) {
                    finished |= matches!(event, TurnEvent::Finished { .. });
                    emit(event)?;
                }
            }
            _ = &mut cancel => {
                terminate(&mut child).await;
                return emit(TurnEvent::Finished {
                    is_error: false,
                    cancelled: true,
                    message: None,
                    denied_tools: Vec::new(),
                });
            }
        }
    }
    let status = child.wait().await.map_err(|error| error.to_string())?;
    if finished {
        return Ok(());
    }
    let tail = stderr_tail
        .lock()
        .map(|tail| tail.iter().cloned().collect::<Vec<_>>().join("\n"))
        .unwrap_or_default();
    Err(if tail.is_empty() {
        format!("claude exited without a result ({status})")
    } else {
        tail
    })
}

fn claude_args(target: &Target) -> Vec<String> {
    let mut args: Vec<String> = [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
    ]
    .map(str::to_owned)
    .to_vec();
    args.push(if target.is_new { "--session-id" } else { "--resume" }.to_owned());
    args.push(target.task_id.clone());
    args
}

fn user_input_line(prompt: &str) -> String {
    json!({
        "type": "user",
        "message": {"role": "user", "content": [{"type": "text", "text": prompt}]},
    })
    .to_string()
}

/// Lets the CLI finish writing its session file before forcing it to stop.
async fn terminate(child: &mut Child) {
    if let Some(pid) = child.id() {
        // SAFETY: `kill` takes plain integers, and this pid is a child that has not been reaped.
        unsafe { libc::kill(pid as i32, libc::SIGTERM) };
    }
    if tokio::time::timeout(TERMINATE_GRACE, child.wait()).await.is_err() {
        let _ = child.kill().await;
    }
}

fn finished_with_error(message: String) -> TurnEvent {
    TurnEvent::Finished {
        is_error: true,
        cancelled: false,
        message: Some(message),
        denied_tools: Vec::new(),
    }
}

fn parse_stream_line(line: &str) -> Vec<TurnEvent> {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return Vec::new();
    };
    // Subagent output is not part of the main conversation.
    if value.get("parent_tool_use_id").is_some_and(|id| !id.is_null()) {
        return Vec::new();
    }
    match value.get("type").and_then(Value::as_str) {
        Some("stream_event") => parse_delta(&value).into_iter().collect(),
        Some("assistant") => content_blocks(&value)
            .iter()
            .filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_use"))
            .map(|block| TurnEvent::ToolUse {
                id: string_field(block, "id"),
                name: string_field(block, "name"),
                input: sessions::tool_input_text(block.get("input")).0,
            })
            .collect(),
        Some("user") => content_blocks(&value)
            .iter()
            .filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_result"))
            .map(|block| TurnEvent::ToolResult {
                tool_use_id: string_field(block, "tool_use_id"),
                text: tool_result_text(block.get("content")),
                is_error: block.get("is_error").and_then(Value::as_bool).unwrap_or(false),
            })
            .collect(),
        Some("result") => vec![parse_result(&value)],
        _ => Vec::new(),
    }
}

fn parse_delta(value: &Value) -> Option<TurnEvent> {
    let event = value.get("event")?;
    if event.get("type")?.as_str()? != "content_block_delta" {
        return None;
    }
    let delta = event.get("delta")?;
    match delta.get("type")?.as_str()? {
        "text_delta" => Some(TurnEvent::TextDelta { text: delta.get("text")?.as_str()?.to_owned() }),
        "thinking_delta" => Some(TurnEvent::ThinkingDelta {
            text: delta.get("thinking")?.as_str()?.to_owned(),
        }),
        _ => None,
    }
}

fn parse_result(value: &Value) -> TurnEvent {
    let is_error = value.get("is_error").and_then(Value::as_bool).unwrap_or(false);
    let denied_tools = value
        .get("permission_denials")
        .and_then(Value::as_array)
        .map(|denials| denials.iter().map(|denial| string_field(denial, "tool_name")).collect())
        .unwrap_or_default();
    TurnEvent::Finished {
        is_error,
        cancelled: false,
        message: is_error.then(|| string_field(value, "result")).filter(|text| !text.is_empty()),
        denied_tools,
    }
}

fn content_blocks(value: &Value) -> &[Value] {
    value
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}

fn string_field(value: &Value, key: &str) -> String {
    value.get(key).and_then(Value::as_str).unwrap_or_default().to_owned()
}

fn tool_result_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_text_and_thinking_deltas() {
        let text = r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}}"#;
        assert_eq!(parse_stream_line(text), [TurnEvent::TextDelta { text: "ok".into() }]);
        let thinking = r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hm"}}}"#;
        assert_eq!(parse_stream_line(thinking), [TurnEvent::ThinkingDelta { text: "hm".into() }]);
    }

    #[test]
    fn parses_tool_use_and_tool_result() {
        let tool = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"x"},{"type":"tool_use","id":"t1","name":"Read","input":{"a":1}}]}}"#;
        assert_eq!(parse_stream_line(tool), [TurnEvent::ToolUse {
            id: "t1".into(),
            name: "Read".into(),
            input: "{\n  \"a\": 1\n}".into(),
        }]);
        let result = r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","is_error":true,"content":[{"type":"text","text":"no"}]}]}}"#;
        assert_eq!(parse_stream_line(result), [TurnEvent::ToolResult {
            tool_use_id: "t1".into(),
            text: "no".into(),
            is_error: true,
        }]);
    }

    #[test]
    fn reports_denied_tools_and_errors_from_the_result() {
        let denied = r#"{"type":"result","is_error":false,"result":"done","permission_denials":[{"tool_name":"Bash"}]}"#;
        assert_eq!(parse_stream_line(denied), [TurnEvent::Finished {
            is_error: false,
            cancelled: false,
            message: None,
            denied_tools: vec!["Bash".into()],
        }]);
        let failed = r#"{"type":"result","is_error":true,"result":"limit reached"}"#;
        assert_eq!(parse_stream_line(failed), [TurnEvent::Finished {
            is_error: true,
            cancelled: false,
            message: Some("limit reached".into()),
            denied_tools: Vec::new(),
        }]);
    }

    #[test]
    fn ignores_subagent_output_and_unknown_lines() {
        let subagent = r#"{"type":"assistant","parent_tool_use_id":"t1","message":{"content":[{"type":"tool_use","id":"t2","name":"Read","input":{}}]}}"#;
        assert!(parse_stream_line(subagent).is_empty());
        assert!(parse_stream_line(r#"{"type":"system","subtype":"init"}"#).is_empty());
        assert!(parse_stream_line("not json").is_empty());
    }

    #[test]
    fn new_tasks_use_a_session_id_and_existing_tasks_resume() {
        let target = |is_new| Target { task_id: "id".into(), cwd: "/".into(), is_new };
        assert!(claude_args(&target(true)).ends_with(&["--session-id".to_owned(), "id".to_owned()]));
        assert!(claude_args(&target(false)).ends_with(&["--resume".to_owned(), "id".to_owned()]));
    }

    #[test]
    fn a_task_cannot_run_twice_and_can_run_again_after_finishing() {
        let runs = Runs::default();
        let _first = runs.begin("a").unwrap();
        assert!(runs.begin("a").is_err());
        runs.finish("a");
        assert!(runs.begin("a").is_ok());
    }

    #[test]
    fn cancel_signals_the_running_turn() {
        let runs = Runs::default();
        let mut receiver = runs.begin("a").unwrap();
        runs.cancel("a");
        assert!(receiver.try_recv().is_ok());
        assert!(runs.begin("a").is_ok());
    }

    #[test]
    fn prompts_are_sent_as_escaped_json() {
        let line = user_input_line("--flag \"quoted\"\nnext");
        let value: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(value["message"]["content"][0]["text"], "--flag \"quoted\"\nnext");
        assert!(!line.contains('\n'));
    }
}

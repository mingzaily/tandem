//! Runs one Claude Code turn per process, so the CLI holds a task only while a turn is running.

use crate::attachments::Prepared;
use crate::{login_env, sessions};
use crate::cli_info::{self, UsageWindows};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::{HashMap, VecDeque}, path::Path, process::Stdio, sync::{Arc, Mutex}, time::Duration};
use tauri::ipc::Channel;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
    sync::{mpsc, oneshot},
};

const STDERR_TAIL_LINES: usize = 20;
const TERMINATE_GRACE: Duration = Duration::from_secs(3);
const QUESTION_TOOL: &str = "AskUserQuestion";
const EFFORT_LEVELS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];
/// The default mode is left out, so it stays whatever the user set for the CLI.
const PERMISSION_MODES: [&str; 3] = ["acceptEdits", "auto", "bypassPermissions"];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum TurnEvent {
    Started { task_id: String },
    TextDelta { text: String },
    ThinkingDelta { text: String },
    ToolUse { id: String, name: String, input: String },
    ToolResult { tool_use_id: String, text: String, is_error: bool },
    PermissionRequest {
        request_id: String,
        tool_name: String,
        input: String,
        description: Option<String>,
        /// What "always allow in this task" would cover. Empty when the CLI offers no rule.
        rules: Vec<String>,
    },
    Question { request_id: String, questions: Value },
    RequestSettled { request_id: String },
    OutputTokens { total: u64 },
    ContextUsage { used_tokens: u64, model: Option<String> },
    ContextWindow { model: String, tokens: u64 },
    RateLimits { windows: UsageWindows },
    Finished {
        is_error: bool,
        cancelled: bool,
        message: Option<String>,
    },
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnOptions {
    pub model: Option<String>,
    pub effort: Option<String>,
    pub permission_mode: Option<String>,
    /// Only a new task can start in a worktree. A resumed one stays where it is.
    #[serde(default)]
    pub worktree: bool,
}

impl TurnOptions {
    fn validate(&self) -> Result<(), String> {
        let model_is_valid = |model: &str| {
            !model.is_empty()
                && !model.starts_with('-')
                && model.chars().all(|c| c.is_ascii_alphanumeric() || "-_.:[]".contains(c))
        };
        if self.model.as_deref().is_some_and(|model| !model_is_valid(model)) {
            return Err("Invalid model".into());
        }
        if self.effort.as_deref().is_some_and(|effort| !EFFORT_LEVELS.contains(&effort)) {
            return Err("Invalid effort level".into());
        }
        if self.permission_mode.as_deref().is_some_and(|mode| !PERMISSION_MODES.contains(&mode)) {
            return Err("Invalid permission mode".into());
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Decision {
    Allow,
    AllowForTask,
    Deny,
    Answer { answers: serde_json::Map<String, Value> },
}

/// A request the CLI is waiting on. The input stays here, so the page answers a request and
/// cannot change what the tool will run.
#[derive(Debug)]
struct PendingRequest {
    tool_name: String,
    input: Value,
    rules: Vec<Value>,
}

struct Run {
    cancel: oneshot::Sender<()>,
    input: mpsc::UnboundedSender<String>,
    pending: HashMap<String, PendingRequest>,
}

struct RunChannels {
    cancel: oneshot::Receiver<()>,
    input: mpsc::UnboundedReceiver<String>,
}

#[derive(Default)]
pub struct Runs {
    runs: Mutex<HashMap<String, Run>>,
    /// Rules granted for a task. Each turn is a new process that forgets session permissions, so
    /// they are passed again on the next turn. Kept in memory, never in the user's CLI settings.
    task_rules: Mutex<HashMap<String, Vec<String>>>,
}

impl Runs {
    fn begin(&self, task_id: &str) -> Result<RunChannels, String> {
        let mut runs = self.runs.lock().map_err(|error| error.to_string())?;
        if runs.contains_key(task_id) {
            return Err("This task is already running".into());
        }
        let (cancel_sender, cancel) = oneshot::channel();
        let (input_sender, input) = mpsc::unbounded_channel();
        runs.insert(
            task_id.to_owned(),
            Run { cancel: cancel_sender, input: input_sender, pending: HashMap::new() },
        );
        Ok(RunChannels { cancel, input })
    }

    fn grant_rules(&self, task_id: &str, rules: Vec<String>) {
        if rules.is_empty() {
            return;
        }
        if let Ok(mut task_rules) = self.task_rules.lock() {
            let granted = task_rules.entry(task_id.to_owned()).or_default();
            for rule in rules {
                if !granted.contains(&rule) {
                    granted.push(rule);
                }
            }
        }
    }

    fn finish(&self, task_id: &str) {
        if let Ok(mut runs) = self.runs.lock() {
            runs.remove(task_id);
        }
    }

    pub fn cancel(&self, task_id: &str) {
        if let Ok(mut runs) = self.runs.lock() {
            if let Some(run) = runs.remove(task_id) {
                let _ = run.cancel.send(());
            }
        }
    }

    fn add_pending(&self, task_id: &str, request_id: String, request: PendingRequest) {
        if let Ok(mut runs) = self.runs.lock() {
            if let Some(run) = runs.get_mut(task_id) {
                run.pending.insert(request_id, request);
            }
        }
    }

    fn remove_pending(&self, task_id: &str, request_id: &str) {
        if let Ok(mut runs) = self.runs.lock() {
            if let Some(run) = runs.get_mut(task_id) {
                run.pending.remove(request_id);
            }
        }
    }

    fn rules_for(&self, task_id: &str) -> Vec<String> {
        self.task_rules
            .lock()
            .ok()
            .and_then(|rules| rules.get(task_id).cloned())
            .unwrap_or_default()
    }

    pub fn answer(&self, task_id: &str, request_id: &str, decision: Decision) -> Result<(), String> {
        let mut runs = self.runs.lock().map_err(|error| error.to_string())?;
        let run = runs.get_mut(task_id).ok_or("This task is not running")?;
        let request = run.pending.get(request_id).ok_or("This request has already ended")?;
        let response = decision_response(request, &decision)?;
        let line = control_success(request_id, response);
        if matches!(decision, Decision::AllowForTask) {
            let mut task_rules = self.task_rules.lock().map_err(|error| error.to_string())?;
            let granted = task_rules.entry(task_id.to_owned()).or_default();
            for rule in request.rules.iter().flat_map(rule_labels) {
                if !granted.contains(&rule) {
                    granted.push(rule);
                }
            }
        }
        run.input.send(line).map_err(|_| "This task is no longer running".to_owned())?;
        run.pending.remove(request_id);
        Ok(())
    }
}

fn decision_response(request: &PendingRequest, decision: &Decision) -> Result<Value, String> {
    let is_question = request.tool_name == QUESTION_TOOL;
    match decision {
        Decision::Deny => Ok(json!({"behavior": "deny", "message": "User denied"})),
        Decision::Allow if !is_question => {
            Ok(json!({"behavior": "allow", "updatedInput": request.input}))
        }
        Decision::AllowForTask if !is_question && !request.rules.is_empty() => Ok(json!({
            "behavior": "allow",
            "updatedInput": request.input,
            // The CLI suggests writing these to a settings file. Tandem keeps them to the session.
            "updatedPermissions": [{
                "type": "addRules",
                "rules": request.rules,
                "behavior": "allow",
                "destination": "session",
            }],
        })),
        Decision::Answer { answers } if is_question => {
            let mut input = request.input.clone();
            let object = input.as_object_mut().ok_or("The question has no input")?;
            object.insert("answers".to_owned(), Value::Object(answers.clone()));
            Ok(json!({"behavior": "allow", "updatedInput": input}))
        }
        _ => Err("This decision does not fit the request".into()),
    }
}

fn control_success(request_id: &str, response: Value) -> String {
    json!({
        "type": "control_response",
        "response": {"subtype": "success", "request_id": request_id, "response": response},
    })
    .to_string()
}

fn control_error(request_id: &str, error: &str) -> String {
    json!({
        "type": "control_response",
        "response": {"subtype": "error", "request_id": request_id, "error": error},
    })
    .to_string()
}

fn rule_labels(rule: &Value) -> Option<String> {
    let tool = rule.get("toolName")?.as_str()?;
    Some(match rule.get("ruleContent").and_then(Value::as_str) {
        Some(content) if !content.is_empty() => format!("{tool}({content})"),
        _ => tool.to_owned(),
    })
}

fn suggested_rules(request: &Value) -> Vec<Value> {
    request
        .get("permission_suggestions")
        .and_then(Value::as_array)
        .map(|suggestions| {
            suggestions
                .iter()
                .filter(|item| {
                    item.get("type").and_then(Value::as_str) == Some("addRules")
                        && item.get("behavior").and_then(Value::as_str) == Some("allow")
                })
                .filter_map(|item| item.get("rules").and_then(Value::as_array))
                .flatten()
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

enum ControlAction {
    Ask { request_id: String, request: PendingRequest, event: TurnEvent },
    Reply(String),
    Settled(String),
}

/// Every request needs exactly one response, or the CLI waits on it forever.
fn parse_control(value: &Value) -> Option<ControlAction> {
    let kind = value.get("type")?.as_str()?;
    if kind == "control_cancel_request" {
        return Some(ControlAction::Settled(value.get("request_id")?.as_str()?.to_owned()));
    }
    if kind != "control_request" {
        return None;
    }
    let request_id = value.get("request_id")?.as_str()?.to_owned();
    let request = value.get("request")?;
    match request.get("subtype").and_then(Value::as_str) {
        Some("can_use_tool") => {
            let tool_name = string_field(request, "tool_name");
            let input = request.get("input").cloned().unwrap_or_else(|| json!({}));
            let event = if tool_name == QUESTION_TOOL {
                TurnEvent::Question {
                    request_id: request_id.clone(),
                    questions: input.get("questions").cloned().unwrap_or_else(|| json!([])),
                }
            } else {
                TurnEvent::PermissionRequest {
                    request_id: request_id.clone(),
                    tool_name: tool_name.clone(),
                    input: sessions::tool_input_text(Some(&input)).0,
                    description: request
                        .get("description")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    rules: suggested_rules(request).iter().filter_map(rule_labels).collect(),
                }
            };
            let rules = suggested_rules(request);
            Some(ControlAction::Ask {
                request_id,
                request: PendingRequest { tool_name, input, rules },
                event,
            })
        }
        // An MCP server asking for form input. Tandem has no form for it yet.
        Some("elicitation") => {
            Some(ControlAction::Reply(control_success(&request_id, json!({"action": "decline"}))))
        }
        _ => Some(ControlAction::Reply(control_error(&request_id, "Not supported by Tandem"))),
    }
}

/// Adds up output tokens across a turn's messages. A message reports its own running total.
#[derive(Default)]
struct TokenMeter {
    finished_messages: u64,
    current_message: u64,
}

impl TokenMeter {
    fn observe(&mut self, value: &Value) -> Option<TurnEvent> {
        if value.get("type")?.as_str()? != "stream_event"
            || value.get("parent_tool_use_id").is_some_and(|id| !id.is_null())
        {
            return None;
        }
        let event = value.get("event")?;
        match event.get("type")?.as_str()? {
            "message_start" => {
                self.finished_messages += self.current_message;
                self.current_message = 0;
                None
            }
            "message_delta" => {
                self.current_message = event.get("usage")?.get("output_tokens")?.as_u64()?;
                Some(TurnEvent::OutputTokens { total: self.finished_messages + self.current_message })
            }
            _ => None,
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
    attachments: Prepared,
    options: TurnOptions,
    on_event: Channel<TurnEvent>,
) -> Result<(), String> {
    options.validate()?;
    let target = tauri::async_runtime::spawn_blocking(move || resolve_target(task_id, cwd))
        .await
        .map_err(|error| error.to_string())??;
    let channels = runs.begin(&target.task_id)?;
    runs.grant_rules(&target.task_id, attachments.read_rules());
    let emit = |event| on_event.send(event).map_err(|error| error.to_string());
    let result = async {
        emit(TurnEvent::Started { task_id: target.task_id.clone() })?;
        run_claude(runs, &target, &prompt, &attachments, &options, channels, &emit).await
    }
    .await;
    runs.finish(&target.task_id);
    if let Err(message) = &result {
        emit(finished_with_error(message.clone()))?;
    }
    Ok(())
}

async fn run_claude(
    runs: &Runs,
    target: &Target,
    prompt: &str,
    attachments: &Prepared,
    options: &TurnOptions,
    channels: RunChannels,
    emit: &impl Fn(TurnEvent) -> Result<(), String>,
) -> Result<(), String> {
    let RunChannels { mut cancel, mut input } = channels;
    if !Path::new(&target.cwd).is_dir() {
        return Err(format!("Working directory not found: {}", target.cwd));
    }
    let env = login_env::login_env().await;
    let program = login_env::find_in_path("claude", env.get("PATH"))
        .ok_or("claude was not found in the login shell PATH")?;
    let mut child = Command::new(program)
        .args(claude_args(target, options, &runs.rules_for(&target.task_id)))
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
        .write_all(format!("{}\n", user_input_line(prompt, attachments)).as_bytes())
        .await
        .map_err(|error| format!("Failed to send the prompt: {error}"))?;
    // Stays open during the turn to answer requests. Closing it after the result ends the process.
    let mut stdin = Some(stdin);

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
    let mut meter = TokenMeter::default();
    loop {
        tokio::select! {
            line = lines.next_line() => {
                let line = line.map_err(|error| error.to_string())?;
                let Some(line) = line else { break };
                let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
                match parse_control(&value) {
                    Some(ControlAction::Ask { request_id, request, event }) => {
                        runs.add_pending(&target.task_id, request_id, request);
                        emit(event)?;
                    }
                    Some(ControlAction::Reply(reply)) => write_line(&mut stdin, &reply).await,
                    Some(ControlAction::Settled(request_id)) => {
                        runs.remove_pending(&target.task_id, &request_id);
                        emit(TurnEvent::RequestSettled { request_id })?;
                    }
                    None => {}
                }
                if let Some(event) = meter.observe(&value) {
                    emit(event)?;
                }
                for event in parse_stream_value(&value) {
                    if matches!(event, TurnEvent::Finished { .. }) {
                        finished = true;
                        stdin = None;
                    }
                    emit(event)?;
                }
            }
            Some(reply) = input.recv(), if stdin.is_some() => write_line(&mut stdin, &reply).await,
            _ = &mut cancel => {
                terminate(&mut child).await;
                return emit(TurnEvent::Finished {
                    is_error: false,
                    cancelled: true,
                    message: None,
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

/// A failed write means the process has died, which the stdout loop reports when it ends.
async fn write_line(stdin: &mut Option<tokio::process::ChildStdin>, line: &str) {
    if let Some(stdin) = stdin {
        let _ = stdin.write_all(format!("{line}\n").as_bytes()).await;
    }
}

fn claude_args(target: &Target, options: &TurnOptions, task_rules: &[String]) -> Vec<String> {
    let mut args: Vec<String> = [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        // Permission requests and AskUserQuestion arrive as control requests on stdout.
        "--permission-prompt-tool",
        "stdio",
    ]
    .map(str::to_owned)
    .to_vec();
    let mut flag = |name: &str, value: &Option<String>| {
        if let Some(value) = value {
            args.push(name.to_owned());
            args.push(value.clone());
        }
    };
    flag("--model", &options.model);
    flag("--effort", &options.effort);
    flag("--permission-mode", &options.permission_mode);
    if !task_rules.is_empty() {
        args.push("--allowedTools".to_owned());
        args.extend(task_rules.iter().cloned());
    }
    if target.is_new && options.worktree {
        args.push("--worktree".to_owned());
    }
    args.push(if target.is_new { "--session-id" } else { "--resume" }.to_owned());
    args.push(target.task_id.clone());
    args
}

fn user_input_line(prompt: &str, attachments: &Prepared) -> String {
    json!({
        "type": "user",
        "message": {"role": "user", "content": attachments.content(prompt)},
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
    }
}

fn parse_stream_value(value: &Value) -> Vec<TurnEvent> {
    // Subagent output is not part of the main conversation.
    if value.get("parent_tool_use_id").is_some_and(|id| !id.is_null()) {
        return Vec::new();
    }
    match value.get("type").and_then(Value::as_str) {
        Some("stream_event") => parse_delta(value).into_iter().collect(),
        Some("assistant") => {
            let tools = content_blocks(value)
                .iter()
                .filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_use"))
                .map(|block| TurnEvent::ToolUse {
                    id: string_field(block, "id"),
                    name: string_field(block, "name"),
                    input: sessions::tool_input_text(block.get("input")).0,
                });
            parse_context_usage(value).into_iter().chain(tools).collect()
        }
        Some("user") => content_blocks(value)
            .iter()
            .filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_result"))
            .map(|block| TurnEvent::ToolResult {
                tool_use_id: string_field(block, "tool_use_id"),
                text: tool_result_text(block.get("content")),
                is_error: block.get("is_error").and_then(Value::as_bool).unwrap_or(false),
            })
            .collect(),
        Some("rate_limit_event") => value
            .get("rate_limit_info")
            .and_then(|info| info.get("unifiedWindows"))
            .and_then(cli_info::parse_stream_windows)
            .map(|windows| TurnEvent::RateLimits { windows })
            .into_iter()
            .collect(),
        Some("result") => parse_context_window(value).into_iter().chain([parse_result(value)]).collect(),
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
    TurnEvent::Finished {
        is_error,
        cancelled: false,
        message: is_error.then(|| string_field(value, "result")).filter(|text| !text.is_empty()),
    }
}

fn parse_context_usage(value: &Value) -> Option<TurnEvent> {
    let message = value.get("message")?;
    Some(TurnEvent::ContextUsage {
        used_tokens: sessions::context_tokens(message.get("usage")?)?,
        model: message.get("model").and_then(Value::as_str).map(str::to_owned),
    })
}

/// The result lists every model used in the turn. The busiest one is the one that ran the turn.
fn parse_context_window(value: &Value) -> Option<TurnEvent> {
    let tokens_of = |usage: &Value| -> u64 {
        ["inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens"]
            .iter()
            .filter_map(|key| usage.get(*key).and_then(Value::as_u64))
            .sum()
    };
    let (model, usage) = value
        .get("modelUsage")?
        .as_object()?
        .iter()
        .max_by_key(|(_, usage)| tokens_of(usage))?;
    Some(TurnEvent::ContextWindow {
        model: model.clone(),
        tokens: usage.get("contextWindow")?.as_u64().filter(|tokens| *tokens > 0)?,
    })
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

    fn parse_stream_line(line: &str) -> Vec<TurnEvent> {
        serde_json::from_str::<Value>(line).map_or(Vec::new(), |value| parse_stream_value(&value))
    }

    fn sent_line(channels: &mut RunChannels) -> Value {
        serde_json::from_str(&channels.input.try_recv().unwrap()).unwrap()
    }

    fn ask(subtype_body: &str) -> Value {
        serde_json::from_str(&format!(
            r#"{{"type":"control_request","request_id":"r1","request":{subtype_body}}}"#
        ))
        .unwrap()
    }

    const BASH_REQUEST: &str = r#"{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"ls"},"description":"List","permission_suggestions":[{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"ls:*"}],"behavior":"allow","destination":"localSettings"},{"type":"setMode","mode":"acceptEdits","destination":"session"}]}"#;
    const QUESTION_REQUEST: &str = r#"{"subtype":"can_use_tool","tool_name":"AskUserQuestion","input":{"questions":[{"question":"Color?","options":[]}]}}"#;

    fn begin_with(runs: &Runs, body: &str) -> RunChannels {
        let channels = runs.begin("a").unwrap();
        let Some(ControlAction::Ask { request_id, request, .. }) = parse_control(&ask(body)) else {
            panic!("expected a request");
        };
        runs.add_pending("a", request_id, request);
        channels
    }

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
    fn reports_errors_and_the_context_window_from_the_result() {
        let done = r#"{"type":"result","is_error":false,"result":"done","modelUsage":{"small":{"inputTokens":1,"contextWindow":100},"big":{"inputTokens":9,"contextWindow":200}}}"#;
        assert_eq!(parse_stream_line(done), [
            TurnEvent::ContextWindow { model: "big".into(), tokens: 200 },
            TurnEvent::Finished { is_error: false, cancelled: false, message: None },
        ]);
        let failed = r#"{"type":"result","is_error":true,"result":"limit reached"}"#;
        assert_eq!(parse_stream_line(failed), [TurnEvent::Finished {
            is_error: true,
            cancelled: false,
            message: Some("limit reached".into()),
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
        let args = |is_new| claude_args(&target(is_new), &TurnOptions::default(), &[]);
        assert!(args(true).ends_with(&["--session-id".to_owned(), "id".to_owned()]));
        assert!(args(false).ends_with(&["--resume".to_owned(), "id".to_owned()]));
    }

    #[test]
    fn options_and_task_rules_become_flags_and_the_default_mode_adds_none() {
        let target = Target { task_id: "id".into(), cwd: "/".into(), is_new: false };
        let plain = claude_args(&target, &TurnOptions::default(), &[]);
        assert!(!plain.iter().any(|arg| arg == "--permission-mode" || arg == "--model"));
        let options = TurnOptions {
            model: Some("opus".into()),
            effort: Some("high".into()),
            permission_mode: Some("acceptEdits".into()),
            worktree: false,
        };
        let args = claude_args(&target, &options, &["Bash(ls:*)".into()]).join(" ");
        assert!(args.contains("--model opus --effort high --permission-mode acceptEdits"));
        assert!(args.contains("--allowedTools Bash(ls:*) --resume id"));
    }

    #[test]
    fn rejects_options_that_could_become_other_flags() {
        let with = |model: &str, effort: &str, mode: &str| TurnOptions {
            model: Some(model.into()),
            effort: Some(effort.into()),
            permission_mode: Some(mode.into()),
            worktree: false,
        };
        assert!(with("claude-opus-5-5[1m]", "max", "auto").validate().is_ok());
        assert!(with("--dangerously-skip-permissions", "max", "auto").validate().is_err());
        assert!(with("opus", "extreme", "auto").validate().is_err());
        assert!(with("opus", "max", "dontAsk").validate().is_err());
    }

    #[test]
    fn a_tool_request_reaches_the_page_and_allowing_returns_the_original_input() {
        let Some(ControlAction::Ask { event, .. }) = parse_control(&ask(BASH_REQUEST)) else {
            panic!("expected a request");
        };
        assert_eq!(event, TurnEvent::PermissionRequest {
            request_id: "r1".into(),
            tool_name: "Bash".into(),
            input: "{\n  \"command\": \"ls\"\n}".into(),
            description: Some("List".into()),
            rules: vec!["Bash(ls:*)".into()],
        });
        let runs = Runs::default();
        let mut channels = begin_with(&runs, BASH_REQUEST);
        runs.answer("a", "r1", Decision::Allow).unwrap();
        let sent = sent_line(&mut channels);
        assert_eq!(sent["response"]["request_id"], "r1");
        assert_eq!(sent["response"]["response"]["behavior"], "allow");
        assert_eq!(sent["response"]["response"]["updatedInput"]["command"], "ls");
        assert!(runs.rules_for("a").is_empty());
    }

    #[test]
    fn a_request_can_only_be_answered_once() {
        let runs = Runs::default();
        let _channels = begin_with(&runs, BASH_REQUEST);
        runs.answer("a", "r1", Decision::Deny).unwrap();
        assert!(runs.answer("a", "r1", Decision::Allow).is_err());
        assert!(runs.answer("other", "r1", Decision::Allow).is_err());
    }

    #[test]
    fn allowing_for_the_task_stays_in_the_session_and_carries_to_later_turns() {
        let runs = Runs::default();
        let mut channels = begin_with(&runs, BASH_REQUEST);
        runs.answer("a", "r1", Decision::AllowForTask).unwrap();
        let sent = sent_line(&mut channels);
        let update = &sent["response"]["response"]["updatedPermissions"][0];
        assert_eq!(update["destination"], "session");
        assert_eq!(update["rules"][0]["ruleContent"], "ls:*");
        assert_eq!(runs.rules_for("a"), ["Bash(ls:*)"]);
    }

    #[test]
    fn allowing_for_the_task_needs_a_rule_from_the_cli() {
        let runs = Runs::default();
        let _channels = begin_with(&runs, r#"{"subtype":"can_use_tool","tool_name":"Write","input":{}}"#);
        assert!(runs.answer("a", "r1", Decision::AllowForTask).is_err());
        assert!(runs.rules_for("a").is_empty());
    }

    #[test]
    fn a_question_is_answered_with_the_original_input_and_the_answers() {
        let Some(ControlAction::Ask { event, .. }) = parse_control(&ask(QUESTION_REQUEST)) else {
            panic!("expected a request");
        };
        assert!(matches!(event, TurnEvent::Question { .. }));
        let runs = Runs::default();
        let mut channels = begin_with(&runs, QUESTION_REQUEST);
        assert!(runs.answer("a", "r1", Decision::Allow).is_err());
        let answers = json!({"Color?": "Red"}).as_object().unwrap().clone();
        runs.answer("a", "r1", Decision::Answer { answers }).unwrap();
        let sent = sent_line(&mut channels);
        let input = &sent["response"]["response"]["updatedInput"];
        assert_eq!(input["answers"]["Color?"], "Red");
        assert_eq!(input["questions"][0]["question"], "Color?");
    }

    #[test]
    fn requests_tandem_cannot_handle_are_still_answered() {
        let reply = |body: &str| match parse_control(&ask(body)) {
            Some(ControlAction::Reply(line)) => serde_json::from_str::<Value>(&line).unwrap(),
            _ => panic!("expected a reply"),
        };
        assert_eq!(reply(r#"{"subtype":"elicitation"}"#)["response"]["response"]["action"], "decline");
        assert_eq!(reply(r#"{"subtype":"something_new"}"#)["response"]["subtype"], "error");
        let cancel: Value = serde_json::from_str(r#"{"type":"control_cancel_request","request_id":"r1"}"#).unwrap();
        assert!(matches!(parse_control(&cancel), Some(ControlAction::Settled(id)) if id == "r1"));
    }

    #[test]
    fn output_tokens_add_up_across_messages() {
        let event = |body: &str| -> Value {
            serde_json::from_str(&format!(r#"{{"type":"stream_event","event":{body}}}"#)).unwrap()
        };
        let delta = |tokens: u64| event(&format!(r#"{{"type":"message_delta","usage":{{"output_tokens":{tokens}}}}}"#));
        let mut meter = TokenMeter::default();
        assert_eq!(meter.observe(&event(r#"{"type":"message_start"}"#)), None);
        assert_eq!(meter.observe(&delta(10)), Some(TurnEvent::OutputTokens { total: 10 }));
        assert_eq!(meter.observe(&delta(15)), Some(TurnEvent::OutputTokens { total: 15 }));
        meter.observe(&event(r#"{"type":"message_start"}"#));
        assert_eq!(meter.observe(&delta(5)), Some(TurnEvent::OutputTokens { total: 20 }));
    }

    #[test]
    fn reads_context_usage_from_assistant_lines() {
        let line = r#"{"type":"assistant","message":{"model":"m","usage":{"input_tokens":1,"cache_read_input_tokens":2,"cache_creation_input_tokens":3,"output_tokens":9},"content":[]}}"#;
        assert_eq!(parse_stream_line(line), [TurnEvent::ContextUsage { used_tokens: 6, model: Some("m".into()) }]);
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
        let mut channels = runs.begin("a").unwrap();
        runs.cancel("a");
        assert!(channels.cancel.try_recv().is_ok());
        assert!(runs.begin("a").is_ok());
    }

    #[test]
    fn prompts_are_sent_as_escaped_json() {
        let line = user_input_line("--flag \"quoted\"\nnext", &Prepared::default());
        let value: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(value["message"]["content"][0]["text"], "--flag \"quoted\"\nnext");
        assert!(!line.contains('\n'));
    }

    #[test]
    fn only_a_new_task_starts_a_worktree() {
        let options = TurnOptions { worktree: true, ..TurnOptions::default() };
        let new_task = Target { task_id: "a".into(), cwd: "/x".into(), is_new: true };
        let resumed = Target { task_id: "a".into(), cwd: "/x".into(), is_new: false };
        assert!(claude_args(&new_task, &options, &[]).contains(&"--worktree".to_owned()));
        assert!(!claude_args(&resumed, &options, &[]).contains(&"--worktree".to_owned()));
    }
}

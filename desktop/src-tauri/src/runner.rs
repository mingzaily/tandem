//! Runs one Claude Code turn per process, so the CLI holds a task only while a turn is running.

use crate::attachments::Prepared;
use crate::{codex, login_env, pi, sessions, writers};
use crate::cli_info::{self, UsageWindows};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::{HashMap, VecDeque}, path::Path, process::Stdio, sync::{atomic::{AtomicBool, AtomicUsize, Ordering}, Arc, Mutex}, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
    sync::{mpsc, oneshot},
};

const STDERR_TAIL_LINES: usize = 20;
const TERMINATE_GRACE: Duration = Duration::from_secs(3);
pub const QUESTION_TOOL: &str = "AskUserQuestion";
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
    GenerationSpeed { speed: crate::token_speed::Snapshot },
    ContextUsage { used_tokens: u64, model: Option<String> },
    ContextWindow { model: String, tokens: u64 },
    RateLimits { windows: UsageWindows },
    /// A message added to the running turn that the CLI refused; the page queues it instead.
    SteerRefused { prompt: String },
    /// Claude's background tasks. With `idle`, the agent has answered and only waits for them:
    /// the process stays, so new messages go straight to it and its follow-up reply shows live.
    Background { tasks: usize, idle: bool },
    Finished {
        is_error: bool,
        cancelled: bool,
        message: Option<String>,
    },
}

/// Codex and Pi can only fork a message into a new task, which is not an edit.
const EDIT_UNSUPPORTED: &str = "这个 CLI 不支持编辑后重发";

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnOptions {
    pub model: Option<String>,
    pub effort: Option<String>,
    pub permission_mode: Option<String>,
    /// Only a new task can start in a worktree. A resumed one stays where it is.
    #[serde(default)]
    pub worktree: bool,
    /// The user chose to send although another process has this task open.
    #[serde(default, skip_serializing)]
    pub ignore_external_writer: bool,
    /// Internal one-shot requests use the CLI without creating a native task.
    #[serde(skip)]
    pub(crate) ephemeral: bool,
    /// Replaces the task's last prompt, given by its message id. Claude only, and never queued.
    #[serde(default, skip_serializing)]
    pub edit_last: Option<String>,
}

impl TurnOptions {
    pub fn validate_for(&self, agent: sessions::Agent) -> Result<(), String> {
        match agent {
            sessions::Agent::Claude => self.validate(),
            sessions::Agent::Codex => self.validate_codex(),
            sessions::Agent::Pi => self.validate_pi(),
        }
    }
    /// Pi's models are named `provider/id`, and it has no permission modes.
    pub fn validate_pi(&self) -> Result<(), String> {
        if self.edit_last.is_some() {
            return Err(EDIT_UNSUPPORTED.into());
        }
        let is_valid_model = |model: &str| {
            !model.is_empty()
                && !model.starts_with('-')
                && model.chars().all(|c| c.is_ascii_alphanumeric() || "-_.:[]/".contains(c))
        };
        if self.model.as_deref().is_some_and(|model| !is_valid_model(model)) {
            return Err("Invalid model".into());
        }
        let is_word = |effort: &str| !effort.is_empty() && effort.chars().all(|c| c.is_ascii_lowercase());
        if self.effort.as_deref().is_some_and(|effort| !is_word(effort)) {
            return Err("Invalid effort level".into());
        }
        Ok(())
    }

    /// Codex has its own effort levels, and they change with its models.
    pub fn validate_codex(&self) -> Result<(), String> {
        if self.edit_last.is_some() {
            return Err(EDIT_UNSUPPORTED.into());
        }
        let is_word = |effort: &str| !effort.is_empty() && effort.chars().all(|c| c.is_ascii_lowercase());
        if self.effort.as_deref().is_some_and(|effort| !is_word(effort)) {
            return Err("Invalid effort level".into());
        }
        if self.permission_mode.as_deref().is_some_and(|mode| !PERMISSION_MODES.contains(&mode)) {
            return Err("Invalid permission mode".into());
        }
        Ok(())
    }

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
    Answer { answers: serde_json::Map<String, Value>, #[serde(default)] custom: bool },
}

/// Where a turn's events go. The page, phones or both, so the turn itself does not care.
#[derive(Clone)]
pub struct TurnSink {
    send: Arc<dyn Fn(TurnEvent) -> Result<(), String> + Send + Sync>,
    acceptance: Option<Arc<Mutex<Option<AcceptanceHandler>>>>,
    speed: Option<Arc<Mutex<crate::token_speed::Meter>>>,
}

type AcceptanceHandler = Box<dyn FnOnce(String) -> Result<(), String> + Send>;

impl TurnSink {
    pub fn new(send: impl Fn(TurnEvent) -> Result<(), String> + Send + Sync + 'static) -> Self {
        Self { send: Arc::new(send), acceptance: None, speed: None }
    }

    pub fn send(&self, event: TurnEvent) -> Result<(), String> {
        let snapshot = match &self.speed {
            Some(speed) => {
                let mut meter = speed.lock().map_err(|error| error.to_string())?;
                let now = meter.now();
                match &event {
                    TurnEvent::TextDelta { text } => meter.delta(text, now),
                    TurnEvent::ThinkingDelta { text } => meter.thinking_delta(text, now),
                    TurnEvent::ToolUse { .. } | TurnEvent::PermissionRequest { .. } | TurnEvent::Question { .. } | TurnEvent::Finished { .. } => meter.pause(now),
                    TurnEvent::OutputTokens { total } => Some(meter.settle(*total, now)),
                    _ => None,
                }
            }
            None => None,
        };
        // A terminal frame closes the UI's event consumer, so publish its pause first.
        if matches!(event, TurnEvent::Finished { .. }) {
            if let Some(speed) = snapshot { (self.send)(TurnEvent::GenerationSpeed { speed })?; }
            return (self.send)(event);
        }
        (self.send)(event)?;
        if let Some(speed) = snapshot { (self.send)(TurnEvent::GenerationSpeed { speed })?; }
        Ok(())
    }

    pub fn with_token_speed(mut self) -> Self {
        self.speed = Some(Arc::new(Mutex::new(crate::token_speed::Meter::default())));
        self
    }

    pub fn generation_tool_delta(&self, text: &str) -> Result<(), String> {
        let snapshot = match &self.speed {
            Some(speed) => {
                let mut meter = speed.lock().map_err(|error| error.to_string())?;
                let now = meter.now();
                meter.tool_delta(text, now)
            }
            None => None,
        };
        if let Some(speed) = snapshot { (self.send)(TurnEvent::GenerationSpeed { speed })?; }
        Ok(())
    }

    pub fn generation_reasoning_output(&self, tokens: Option<u64>) -> Result<(), String> {
        if let Some(speed) = &self.speed {
            speed.lock().map_err(|error| error.to_string())?.reasoning_output(tokens);
        }
        Ok(())
    }

    pub fn generation_tool_input(&self, input: &str) -> Result<(), String> {
        if let Some(speed) = &self.speed {
            speed.lock().map_err(|error| error.to_string())?.unstreamed_tool(input);
        }
        Ok(())
    }

    pub fn generation_request(&self) -> Result<(), String> {
        let snapshot = match &self.speed {
            Some(speed) => {
                let mut meter = speed.lock().map_err(|error| error.to_string())?;
                let now = meter.now();
                meter.begin_request(now)
            }
            None => None,
        };
        if let Some(speed) = snapshot { (self.send)(TurnEvent::GenerationSpeed { speed })?; }
        Ok(())
    }

    pub fn generation_start(&self) -> Result<(), String> {
        self.generation_phase(true)
    }

    pub fn generation_pause(&self) -> Result<(), String> {
        self.generation_phase(false)
    }

    fn generation_phase(&self, generating: bool) -> Result<(), String> {
        let snapshot = match &self.speed {
            Some(speed) => {
                let mut meter = speed.lock().map_err(|error| error.to_string())?;
                let now = meter.now();
                if generating { meter.start(now) } else { meter.pause(now) }
            }
            None => None,
        };
        if let Some(speed) = snapshot { (self.send)(TurnEvent::GenerationSpeed { speed })?; }
        Ok(())
    }

    pub fn with_acceptance(mut self, accepted: impl FnOnce(String) -> Result<(), String> + Send + 'static) -> Self {
        self.acceptance = Some(Arc::new(Mutex::new(Some(Box::new(accepted)))));
        self
    }

    /// CLI acknowledgments are internal: queue persistence stays off the wire and async runtime.
    pub async fn accepted(&self, task_id: &str) -> Result<(), String> {
        let handler = match &self.acceptance {
            Some(handler) => handler.lock().map_err(|error| error.to_string())?.take(),
            None => None,
        };
        if let Some(handler) = handler {
            let id = task_id.to_owned();
            tauri::async_runtime::spawn_blocking(move || handler(id)).await.map_err(|error| error.to_string())??;
        }
        Ok(())
    }
}

pub(crate) const EXTERNAL_WRITER_ERROR: &str = "This task is open in another process";

/// A request the CLI is waiting on. The input stays here, so the page answers a request and
/// cannot change what the tool will run.
#[derive(Debug)]
pub struct PendingRequest {
    pub tool_name: String,
    pub input: Value,
    rules: Vec<Value>,
    /// Codex answers by JSON-RPC id, unlike Claude's control responses.
    codex_rpc_id: Option<String>,
    /// Pi's dialogs answer differently by kind, so the kind stays with the request.
    pi_method: Option<String>,
}

impl PendingRequest {
    pub fn for_codex(tool_name: &str, input: Value) -> Self {
        Self { tool_name: tool_name.to_owned(), input, rules: Vec::new(), codex_rpc_id: None, pi_method: None }
    }

    pub fn for_pi(tool_name: &str, input: Value, method: &str) -> Self {
        Self { pi_method: Some(method.to_owned()), ..Self::for_codex(tool_name, input) }
    }
}

struct Run {
    cancel: oneshot::Sender<()>,
    input: mpsc::UnboundedSender<String>,
    pending: HashMap<String, PendingRequest>,
    operations: HashMap<String, oneshot::Sender<Result<(), String>>>,
    steer: Steer,
}

/// Messages added to the running turn. The runner closes it once the turn can no longer take
/// one, and Claude counts the ones it has not yet echoed back so the turn waits for them.
#[derive(Clone, Default)]
pub struct Steer {
    pub open: Arc<AtomicBool>,
    pub unconfirmed: Arc<AtomicUsize>,
}

impl Steer {
    pub fn close(&self) { self.open.store(false, Ordering::SeqCst); }
    pub fn confirm_one(&self) {
        let _ = self.unconfirmed.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |count| count.checked_sub(1));
    }
    pub fn has_unconfirmed(&self) -> bool { self.unconfirmed.load(Ordering::SeqCst) > 0 }
}

/// What the page sends when a running turn cannot take its message any more.
pub const NO_ACTIVE_TURN: &str = "No active turn to add a message to";

pub struct RunChannels {
    pub cancel: oneshot::Receiver<()>,
    pub input: mpsc::UnboundedReceiver<String>,
    pub steer: Steer,
}

#[derive(Default)]
pub struct Runs {
    runs: Mutex<HashMap<String, Run>>,
    /// Rules granted for a task. Each turn is a new process that forgets session permissions, so
    /// they are passed again on the next turn. Kept in memory, never in the user's CLI settings.
    task_rules: Mutex<HashMap<String, Vec<String>>>,
    /// Short-lived native metadata processes are owned by Tandem, separate from conversation turns.
    metadata_writers: Mutex<std::collections::HashSet<u32>>,
}

pub struct MetadataWriter<'a> {
    runs: &'a Runs,
    pid: u32,
}

impl Drop for MetadataWriter<'_> {
    fn drop(&mut self) {
        if let Ok(mut owned) = self.runs.metadata_writers.lock() { owned.remove(&self.pid); }
    }
}

#[derive(Debug, Serialize)]
pub struct AnswerError {
    pub code: &'static str,
    pub message: String,
}

impl AnswerError {
    fn settled(message: &str) -> Self { Self { code: "requestSettled", message: message.into() } }
}
impl From<String> for AnswerError {
    fn from(message: String) -> Self { Self { code: "answerFailed", message } }
}

impl Runs {
    pub fn begin(&self, task_id: &str) -> Result<RunChannels, String> {
        let mut runs = self.runs.lock().map_err(|error| error.to_string())?;
        if runs.contains_key(task_id) {
            return Err("This task is already running".into());
        }
        let (cancel_sender, cancel) = oneshot::channel();
        let (input_sender, input) = mpsc::unbounded_channel();
        let steer = Steer { open: Arc::new(AtomicBool::new(true)), unconfirmed: Arc::default() };
        runs.insert(
            task_id.to_owned(),
            Run { cancel: cancel_sender, input: input_sender, pending: HashMap::new(), operations: HashMap::new(), steer: steer.clone() },
        );
        Ok(RunChannels { cancel, input, steer })
    }

    /// Hands a message to the running turn: a line the runner turns into the CLI's own steering call.
    pub fn steer(&self, task_id: &str, line: String) -> Result<(), String> {
        let runs = self.runs.lock().map_err(|error| error.to_string())?;
        let run = runs.get(task_id).filter(|run| run.steer.open.load(Ordering::SeqCst)).ok_or(NO_ACTIVE_TURN)?;
        run.steer.unconfirmed.fetch_add(1, Ordering::SeqCst);
        run.input.send(line).map_err(|_| {
            run.steer.confirm_one();
            NO_ACTIVE_TURN.to_owned()
        })
    }

    /// Whether the running turn still takes added messages, checked before attachments are taken.
    pub fn can_steer(&self, task_id: &str) -> bool {
        self.runs.lock().is_ok_and(|runs| runs.get(task_id).is_some_and(|run| run.steer.open.load(Ordering::SeqCst)))
    }

    pub fn is_running(&self, task_id: &str) -> bool {
        self.runs.lock().is_ok_and(|runs| runs.contains_key(task_id))
    }

    pub fn own_metadata_writer(&self, pid: u32) -> Result<MetadataWriter<'_>, String> {
        self.metadata_writers.lock().map_err(|error| error.to_string())?.insert(pid);
        Ok(MetadataWriter { runs: self, pid })
    }

    pub fn owns_writer(&self, writer: &writers::ExternalWriter) -> bool {
        self.is_running(&writer.task_id) || self.metadata_writers.lock().is_ok_and(|owned| owned.contains(&(writer.pid as u32)))
    }

    pub fn metadata_request(&self, task_id: &str, request_id: String, line: String) -> Result<Option<oneshot::Receiver<Result<(), String>>>, String> {
        let mut runs = self.runs.lock().map_err(|error| error.to_string())?;
        let Some(run) = runs.get_mut(task_id) else { return Ok(None) };
        let (sender, receiver) = oneshot::channel();
        run.input.send(line).map_err(|_| "任务进程已经结束".to_owned())?;
        run.operations.insert(request_id, sender);
        Ok(Some(receiver))
    }

    pub fn settle_metadata(&self, task_id: &str, request_id: &str, result: Result<(), String>) {
        if let Ok(mut runs) = self.runs.lock() {
            if let Some(sender) = runs.get_mut(task_id).and_then(|run| run.operations.remove(request_id)) {
                let _ = sender.send(result);
            }
        }
    }

    pub fn forget_metadata(&self, task_id: &str, request_id: &str) {
        if let Ok(mut runs) = self.runs.lock() {
            if let Some(run) = runs.get_mut(task_id) { run.operations.remove(request_id); }
        }
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

    pub fn finish(&self, task_id: &str) {
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

    pub fn add_pending_request(&self, task_id: &str, id: String, request: PendingRequest) {
        self.add_pending(task_id, id, request);
    }

    pub fn add_codex_pending(&self, task_id: &str, shown_id: String, rpc_id: String, mut request: PendingRequest) {
        request.codex_rpc_id = Some(rpc_id);
        self.add_pending(task_id, shown_id, request);
    }

    pub fn remove_pending(&self, task_id: &str, request_id: &str) {
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
        self.answer_checked(task_id, request_id, decision).map_err(|error| error.message)
    }

    pub fn answer_checked(&self, task_id: &str, request_id: &str, decision: Decision) -> Result<(), AnswerError> {
        let mut runs = self.runs.lock().map_err(|error| error.to_string())?;
        let run = runs.get_mut(task_id).ok_or_else(|| AnswerError::settled("This task is not running"))?;
        let request = run.pending.get(request_id).ok_or_else(|| AnswerError::settled("This request has already ended"))?;
        let line = match (&request.codex_rpc_id, &request.pi_method) {
            (Some(rpc_id), _) => codex::rpc_reply(rpc_id, codex::decision_result(request, &decision)?),
            (None, Some(method)) => pi::ui_reply(request_id, request, method, &decision)?,
            (None, None) => control_success(request_id, decision_response(request, &decision)?),
        };
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
        Decision::Answer { answers, .. } if is_question => {
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
    Ask { request_id: String, request: Box<PendingRequest>, event: TurnEvent },
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
                request: Box::new(PendingRequest { tool_name, input, rules, codex_rpc_id: None, pi_method: None }),
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
    /// Where to truncate when the turn replaces the last prompt.
    edit: Option<sessions::EditAnchor>,
}

fn resolve_target(task_id: Option<String>, cwd: Option<String>, edit_last: Option<&str>) -> Result<Target, String> {
    if let Some(task_id) = task_id {
        // A task resumes only from the directory recorded in its own file.
        let path = sessions::find_task_file(&sessions::claude_projects_dir()?, &task_id)?;
        let cwd = sessions::read_task_cwd(&path).ok_or("The task has no working directory")?;
        let edit = edit_last.map(|message_id| sessions::edit_anchor(&path, message_id)).transpose()?;
        return Ok(Target { task_id, cwd, is_new: false, edit });
    }
    if edit_last.is_some() {
        return Err("新任务没有可以编辑的消息".into());
    }
    let cwd = cwd.ok_or("A new task needs a working directory")?;
    Ok(Target {
        task_id: uuid::Uuid::new_v4().to_string(),
        cwd,
        is_new: true,
        edit: None,
    })
}

pub fn external_writers() -> Result<Vec<writers::ExternalWriter>, String> {
    let projects = sessions::claude_projects_dir()?;
    let sessions_dir = projects.parent().ok_or("The CLI config folder was not found")?.join("sessions");
    let mut writers = writers::read_writers(&sessions_dir);
    writers.extend(writers::read_codex_writers(&codex::codex_home()?.join("thread-writer-locks")));
    writers.extend(writers::read_pi_writers(&pi::sessions_dir()?));
    Ok(writers)
}

pub async fn send_turn(
    runs: &Runs,
    task_id: Option<String>,
    cwd: Option<String>,
    prompt: String,
    attachments: Prepared,
    options: TurnOptions,
    on_event: TurnSink,
) -> Result<(), String> {
    options.validate()?;
    let edit_last = options.edit_last.clone();
    let target = tauri::async_runtime::spawn_blocking(move || resolve_target(task_id, cwd, edit_last.as_deref()))
        .await
        .map_err(|error| error.to_string())??;
    // The page warns from what it last saw. This covers a terminal that opened since then.
    if !target.is_new && !options.ignore_external_writer {
        let is_open_elsewhere = external_writers()?.iter().any(|writer| writer.task_id == target.task_id);
        if is_open_elsewhere {
            return Err(EXTERNAL_WRITER_ERROR.to_owned());
        }
    }
    let channels = runs.begin(&target.task_id)?;
    runs.grant_rules(&target.task_id, attachments.read_rules());
    let emit = |event| on_event.send(event);
    let result = async {
        emit(TurnEvent::Started { task_id: target.task_id.clone() })?;
        run_claude(runs, &target, &prompt, &attachments, &options, channels, &on_event).await
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
    sink: &TurnSink,
) -> Result<(), String> {
    let emit = |event| sink.send(event);
    let RunChannels { mut cancel, mut input, steer } = channels;
    if !Path::new(&target.cwd).is_dir() {
        return Err(format!("Working directory not found: {}", target.cwd));
    }
    let env = login_env::login_env().await;
    let program = login_env::find_in_path("claude", env.get("PATH"))
        .ok_or("claude was not found in the login shell PATH")?;
    let args = claude_args(target, options, &runs.rules_for(&target.task_id));
    crate::diagnostics::debug("claude", || format!("starting {} {}", program.display(), crate::diagnostics::flag_names(&args)));
    let mut child = Command::new(&program)
        .args(&args)
        .current_dir(&target.cwd)
        .env_clear()
        .envs(env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("Failed to start claude: {error}"))?;
    crate::diagnostics::debug("claude", || format!("pid {}", child.id().unwrap_or_default()));

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
    let mut accepted = false;
    // A result that arrived while an added message was still unread: Claude runs that message
    // as a further turn and reports again, or exits, which then ends the turn with this one.
    let mut deferred: Option<TurnEvent> = None;
    // A result with background tasks still running is not the end: Claude keeps the process and
    // runs another turn when they report. `idle` is the stretch between that result and new work.
    let mut background = 0usize;
    let mut idle = false;
    let mut meter = TokenMeter::default();
    loop {
        tokio::select! {
            line = lines.next_line() => {
                let line = line.map_err(|error| error.to_string())?;
                let Some(line) = line else { break };
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    crate::diagnostics::debug("claude", || format!("skipped a non-JSON output line ({} bytes)", line.len()));
                    continue;
                };
                if let Some(tasks) = background_tasks(&value) {
                    background = tasks;
                    crate::diagnostics::debug("claude", || format!("{tasks} background task(s), idle={idle}"));
                    if background == 0 && deferred.is_some() && !steer.has_unconfirmed() {
                        // The follow-up turn, if any, needs no input; closing lets the CLI exit after it.
                        stdin = None;
                        steer.close();
                        idle = false;
                    }
                    emit(TurnEvent::Background { tasks, idle })?;
                    continue;
                }
                let starts_work = idle
                    && (value.get("type").and_then(Value::as_str) == Some("assistant")
                        || value.pointer("/event/type").and_then(Value::as_str) == Some("message_start"));
                if starts_work {
                    idle = false;
                    emit(TurnEvent::Background { tasks: background, idle })?;
                }
                if value.get("type").and_then(Value::as_str) == Some("user")
                    && value.get("isReplay").and_then(Value::as_bool) == Some(true)
                    && value.get("parent_tool_use_id").is_none_or(Value::is_null)
                {
                    if accepted { steer.confirm_one(); } else { accepted = true; }
                    sink.accepted(&target.task_id).await?;
                    continue;
                }
                if let Some((id, result)) = crate::titles::name_response(crate::titles::NameProtocol::Claude, &value) {
                    runs.settle_metadata(&target.task_id, &id, result);
                    continue;
                }
                match parse_control(&value) {
                    Some(ControlAction::Ask { request_id, request, event }) => {
                        runs.add_pending(&target.task_id, request_id, *request);
                        emit(event)?;
                    }
                    Some(ControlAction::Reply(reply)) => write_line(&mut stdin, &reply).await,
                    Some(ControlAction::Settled(request_id)) => {
                        runs.remove_pending(&target.task_id, &request_id);
                        emit(TurnEvent::RequestSettled { request_id })?;
                    }
                    None => {}
                }
                if value.get("type").and_then(Value::as_str) == Some("stream_event")
                    && value.get("parent_tool_use_id").is_none_or(Value::is_null)
                {
                    match value.pointer("/event/type").and_then(Value::as_str) {
                        Some("message_start") => sink.generation_request()?,
                        Some("content_block_start") => sink.generation_start()?,
                        Some("content_block_delta") => {
                            if let Some(input) = value.pointer("/event/delta/partial_json").and_then(Value::as_str) {
                                sink.generation_tool_delta(input)?;
                            }
                        }
                        Some("message_delta") => sink.generation_reasoning_output(value.pointer("/event/usage/reasoning_tokens").and_then(Value::as_u64))?,
                        Some("message_stop") => sink.generation_pause()?,
                        _ => {}
                    }
                }
                if value.get("type").and_then(Value::as_str) == Some("assistant")
                    && value.get("parent_tool_use_id").is_none_or(Value::is_null)
                {
                    for block in content_blocks(&value).iter().filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_use")) {
                        if let Some(input) = block.get("input") { sink.generation_tool_input(&input.to_string())?; }
                    }
                }
                if let Some(event) = meter.observe(&value) {
                    emit(event)?;
                }
                for event in parse_stream_value(&value) {
                    if let TurnEvent::Finished { is_error, .. } = &event {
                        if background > 0 {
                            // Input stays open: the agent is idle until its tasks report back.
                            deferred = Some(event);
                            idle = true;
                            emit(TurnEvent::Background { tasks: background, idle })?;
                            continue;
                        }
                        stdin = None;
                        steer.close();
                        if !*is_error && steer.has_unconfirmed() {
                            deferred = Some(event);
                            continue;
                        }
                        finished = true;
                        deferred = None;
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
    let tail = stderr_tail
        .lock()
        .map(|tail| tail.iter().cloned().collect::<Vec<_>>().join("\n"))
        .unwrap_or_default();
    crate::diagnostics::debug("claude", || match (status.success(), tail.is_empty()) {
        (false, false) => format!("exited ({status}), stderr:\n{tail}"),
        _ => format!("exited ({status})"),
    });
    if finished {
        return Ok(());
    }
    if let Some(event) = deferred {
        return emit(event);
    }
    Err(if tail.is_empty() {
        format!("claude exited without a result ({status})")
    } else {
        tail
    })
}

/// `background_tasks_changed` lists the main conversation's running background tasks.
fn background_tasks(value: &Value) -> Option<usize> {
    if value.get("type").and_then(Value::as_str) != Some("system")
        || value.get("subtype").and_then(Value::as_str) != Some("background_tasks_changed")
    {
        return None;
    }
    Some(value.get("tasks").and_then(Value::as_array).map_or(0, Vec::len))
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
        // The echoed user message is the CLI's receipt, independent of process startup.
        "--replay-user-messages",
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
    if options.ephemeral {
        args.extend([
            "--no-session-persistence", "--tools", "", "--strict-mcp-config",
            "--setting-sources", "user", "--settings", "{\"disableAllHooks\":true}",
            "--system-prompt", crate::titles::SYSTEM_PROMPT,
        ].map(str::to_owned));
        return args;
    }
    if !task_rules.is_empty() {
        args.push("--allowedTools".to_owned());
        args.extend(task_rules.iter().cloned());
    }
    if target.is_new && options.worktree {
        args.push("--worktree".to_owned());
    }
    args.push(if target.is_new { "--session-id" } else { "--resume" }.to_owned());
    args.push(target.task_id.clone());
    if let Some(edit) = &target.edit {
        // The CLI refuses the truncation when the discarded part holds more than that prompt's turn.
        args.extend(["--resume-session-at".to_owned(), edit.assistant.clone(), "--resume-drops-turn".to_owned(), edit.prompt.clone()]);
    }
    args
}

pub(crate) fn user_input_line(prompt: &str, attachments: &Prepared) -> String {
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
#[path = "runner_background_tests.rs"]
mod background_tests;

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

    #[test]
    fn added_messages_reach_a_running_turn_until_it_closes() {
        let runs = Runs::default();
        assert_eq!(runs.steer("a", "x".into()), Err(NO_ACTIVE_TURN.to_owned()));
        let mut channels = runs.begin("a").unwrap();
        assert!(runs.can_steer("a"));
        runs.steer("a", "added".into()).unwrap();
        assert_eq!(channels.input.try_recv().unwrap(), "added");
        assert!(channels.steer.has_unconfirmed());
        channels.steer.confirm_one();
        assert!(!channels.steer.has_unconfirmed());
        channels.steer.close();
        assert!(!runs.can_steer("a"));
        assert_eq!(runs.steer("a", "late".into()), Err(NO_ACTIVE_TURN.to_owned()));
    }

    fn begin_with(runs: &Runs, body: &str) -> RunChannels {
        let channels = runs.begin("a").unwrap();
        let Some(ControlAction::Ask { request_id, request, .. }) = parse_control(&ask(body)) else {
            panic!("expected a request");
        };
        runs.add_pending("a", request_id, *request);
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
        let target = |is_new| Target { task_id: "id".into(), cwd: "/".into(), is_new, edit: None };
        let args = |is_new| claude_args(&target(is_new), &TurnOptions::default(), &[]);
        assert!(args(true).ends_with(&["--session-id".to_owned(), "id".to_owned()]));
        assert!(args(false).ends_with(&["--resume".to_owned(), "id".to_owned()]));
    }

    #[test]
    fn metadata_writer_ownership_hides_only_our_process_without_marking_the_task_running() {
        let runs = Runs::default();
        let writer = |pid| writers::ExternalWriter { task_id: "task".into(), pid, is_busy: false, from_terminal: false, can_override: true };
        let guard = runs.own_metadata_writer(100).unwrap();
        assert!(runs.owns_writer(&writer(100)));
        assert!(!runs.owns_writer(&writer(200)));
        assert!(!runs.is_running("task"));
        drop(guard);
        assert!(!runs.owns_writer(&writer(100)));
    }

    #[test]
    fn speed_pause_reaches_the_page_before_the_terminal_event_closes_its_consumer() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let output = events.clone();
        let sink = TurnSink::new(move |event| { output.lock().unwrap().push(event); Ok(()) }).with_token_speed();
        sink.send(TurnEvent::Started { task_id: "task".into() }).unwrap();
        sink.send(TurnEvent::TextDelta { text: "first output".into() }).unwrap();
        sink.send(TurnEvent::Finished { is_error: false, cancelled: true, message: None }).unwrap();
        let events = events.lock().unwrap();
        assert!(matches!(events[2], TurnEvent::GenerationSpeed { ref speed } if speed.streaming));
        assert!(matches!(events[3], TurnEvent::GenerationSpeed { ref speed } if !speed.streaming));
        assert!(matches!(events[4], TurnEvent::Finished { .. }));
    }

    #[test]
    fn title_requests_are_ephemeral_and_disable_tools_and_hooks() {
        let target = Target { task_id: "title".into(), cwd: "/tmp".into(), is_new: true, edit: None };
        let options = TurnOptions { ephemeral: true, ..Default::default() };
        let args = claude_args(&target, &options, &[]);
        assert!(args.contains(&"--no-session-persistence".into()));
        assert!(args.windows(2).any(|pair| pair == ["--tools", ""]));
        assert!(args.contains(&"{\"disableAllHooks\":true}".into()));
        assert!(!args.iter().any(|arg| arg == "--session-id" || arg == "--resume"));
        let from_page: TurnOptions = serde_json::from_value(json!({"ephemeral": true})).unwrap();
        assert!(!from_page.ephemeral);
    }

    #[test]
    fn metadata_requests_use_the_running_process_without_a_user_message() {
        let runs = Runs::default();
        let mut channels = runs.begin("task").unwrap();
        let request = json!({"type": "set_session_name", "id": "tandem-title-test", "name": "title"}).to_string();
        let mut reply = runs.metadata_request("task", "tandem-title-test".into(), request.clone()).unwrap().unwrap();
        assert_eq!(channels.input.try_recv().unwrap(), request);
        runs.settle_metadata("task", "tandem-title-test", Ok(()));
        assert!(reply.try_recv().unwrap().is_ok());
        assert!(runs.metadata_request("other", "operation".into(), "request".into()).unwrap().is_none());
    }

    #[test]
    fn ending_a_turn_releases_waiting_metadata_requests() {
        let runs = Runs::default();
        let _channels = runs.begin("task").unwrap();
        let mut reply = runs.metadata_request("task", "operation".into(), "request".into()).unwrap().unwrap();
        runs.finish("task");
        assert_eq!(reply.try_recv(), Err(oneshot::error::TryRecvError::Closed));
    }

    #[test]
    fn options_and_task_rules_become_flags_and_the_default_mode_adds_none() {
        let target = Target { task_id: "id".into(), cwd: "/".into(), is_new: false, edit: None };
        let plain = claude_args(&target, &TurnOptions::default(), &[]);
        assert!(!plain.iter().any(|arg| arg == "--permission-mode" || arg == "--model"));
        let options = TurnOptions {
            model: Some("opus".into()),
            effort: Some("high".into()),
            permission_mode: Some("acceptEdits".into()),
            worktree: false,
            ignore_external_writer: false,
            ..Default::default()
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
            ignore_external_writer: false,
            ..Default::default()
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
    fn answer_errors_distinguish_settlement_from_a_failed_answer() {
        let runs = Runs::default();
        let _channels = begin_with(&runs, r#"{"subtype":"can_use_tool","tool_name":"Write","input":{}}"#);
        let error = runs.answer_checked("a", "r1", Decision::AllowForTask).unwrap_err();
        assert_eq!(error.code, "answerFailed");
        runs.answer_checked("a", "r1", Decision::Deny).unwrap();
        assert_eq!(runs.answer_checked("a", "r1", Decision::Allow).unwrap_err().code, "requestSettled");
        assert_eq!(runs.answer_checked("ended", "r1", Decision::Deny).unwrap_err().code, "requestSettled");
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
        runs.answer("a", "r1", Decision::Answer { answers, custom: false }).unwrap();
        let sent = sent_line(&mut channels);
        let input = &sent["response"]["response"]["updatedInput"];
        assert_eq!(input["answers"]["Color?"], "Red");
        assert_eq!(input["questions"][0]["question"], "Color?");
    }

    #[test]
    fn a_claude_question_keeps_its_options_and_returns_a_custom_answer_as_text() {
        let body = serde_json::json!({"subtype": "can_use_tool", "tool_name": "AskUserQuestion", "input": {"questions": [{"question": "Pick", "options": [{"label": "A"}, {"label": "B"}]}]}}).to_string();
        let Some(ControlAction::Ask { event: TurnEvent::Question { questions, .. }, .. }) = parse_control(&ask(&body)) else { panic!("Expected Claude question"); };
        assert_eq!(questions[0]["options"].as_array().unwrap().len(), 2);
        let runs = Runs::default();
        let mut channels = begin_with(&runs, &body);
        let answers = json!({"Pick": "Use my own approach"}).as_object().unwrap().clone();
        runs.answer("a", "r1", Decision::Answer { answers, custom: true }).unwrap();
        let sent = sent_line(&mut channels);
        assert_eq!(sent["response"]["response"]["updatedInput"]["answers"]["Pick"], "Use my own approach");
        assert_eq!(sent["response"]["response"]["updatedInput"]["questions"][0]["options"].as_array().unwrap().len(), 2);
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
    fn an_edit_truncates_the_resumed_task_and_only_claude_accepts_it() {
        let edit = Some(sessions::EditAnchor { assistant: "a1".into(), prompt: "u2".into() });
        let target = Target { task_id: "id".into(), cwd: "/".into(), is_new: false, edit };
        let args = claude_args(&target, &TurnOptions::default(), &[]);
        assert!(args.ends_with(&["--resume", "id", "--resume-session-at", "a1", "--resume-drops-turn", "u2"].map(str::to_owned)));
        let options = TurnOptions { edit_last: Some("u2:0".into()), ..Default::default() };
        assert!(options.validate_for(sessions::Agent::Codex).is_err());
        assert!(options.validate_for(sessions::Agent::Pi).is_err());
        assert!(options.validate_for(sessions::Agent::Claude).is_ok());
        assert!(resolve_target(None, Some("/".into()), Some("u2:0")).is_err());
    }

    #[test]
    fn only_a_new_task_starts_a_worktree() {
        let options = TurnOptions { worktree: true, ..TurnOptions::default() };
        let new_task = Target { task_id: "a".into(), cwd: "/x".into(), is_new: true, edit: None };
        let resumed = Target { task_id: "a".into(), cwd: "/x".into(), is_new: false, edit: None };
        assert!(claude_args(&new_task, &options, &[]).contains(&"--worktree".to_owned()));
        assert!(!claude_args(&resumed, &options, &[]).contains(&"--worktree".to_owned()));
    }
}

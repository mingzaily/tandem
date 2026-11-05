//! Pi through its own session files and `pi --mode rpc`, one process per turn.
//!
//! Sessions live in `<agent dir>/sessions/--<cwd>--/<time>_<uuid>.jsonl`, and a nested folder holds
//! subagent runs, which stay out of the list. The file is a tree: each entry names its parent, and
//! the last entry is where the session stands now.
//!
//! Pi has no permission prompts of its own. An extension can still ask through its UI requests,
//! and those become the same cards as the other agents'.

use crate::attachments::Prepared;
use crate::cli_info::{CliInfo, ModelOption};
use crate::codex::TurnRequest;
use crate::login_env;
use crate::runner::{Decision, PendingRequest, RunChannels, Runs, TurnEvent, QUESTION_TOOL, TurnSink};
use crate::sessions::{is_under, Agent, DiscoveredProject, Message, MessageKind, TaskContent, TaskSummary};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, UNIX_EPOCH};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader as AsyncBufReader};
use tokio::process::Command;

const TITLE_CHARS: usize = 80;
const TITLE_TAIL_BYTES: u64 = 256 * 1024;
const MAX_TEXT_BYTES: usize = 20 * 1024;
const MAX_TASKS: usize = 500;
const INFO_TIMEOUT: Duration = Duration::from_secs(20);
const INTERRUPT_TIMEOUT: Duration = Duration::from_secs(5);
const EXIT_TIMEOUT: Duration = Duration::from_secs(3);
const DEFAULT_MODEL: &str = "default";
const FILE_TOOLS: [(&str, &str); 3] = [("read", "Read"), ("edit", "Edit"), ("write", "Write")];

pub fn sessions_dir() -> Result<PathBuf, String> {
    let agent_dir = match std::env::var_os("PI_CODING_AGENT_DIR") {
        Some(dir) => PathBuf::from(dir),
        None => PathBuf::from(std::env::var_os("HOME").ok_or("HOME is not set")?).join(".pi").join("agent"),
    };
    Ok(agent_dir.join("sessions"))
}

/// The task id is the uuid at the end of the file name.
fn task_id_of(path: &Path) -> Option<String> {
    if path.extension()? != "jsonl" {
        return None;
    }
    let stem = path.file_stem()?.to_str()?;
    let id = stem.rsplit('_').next()?;
    uuid::Uuid::parse_str(id).ok()?;
    Some(id.to_owned())
}

/// Top-level session files only. Some are symlinks to the same file, so they are counted once.
fn session_files(project: &Path, seen: &mut HashSet<PathBuf>) -> Vec<(u64, PathBuf)> {
    let Ok(entries) = fs::read_dir(project) else {
        return Vec::new();
    };
    let mut files = Vec::new();
    for path in entries.flatten().map(|entry| entry.path()) {
        if task_id_of(&path).is_none() {
            continue;
        }
        let Ok(real) = fs::canonicalize(&path) else { continue };
        let Ok(metadata) = fs::metadata(&real) else { continue };
        if !metadata.is_file() || !seen.insert(real) {
            continue;
        }
        let Some(modified) = metadata.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()) else {
            continue;
        };
        files.push((modified.as_millis() as u64, path));
    }
    files.sort_by(|a, b| b.0.cmp(&a.0));
    files
}

fn read_cwd(path: &Path) -> Option<String> {
    let file = File::open(path).ok()?;
    BufReader::new(file).lines().map_while(Result::ok).take(5).find_map(|line| {
        let value: Value = serde_json::from_str(&line).ok()?;
        if value.get("type")?.as_str()? != "session" {
            return None;
        }
        value.get("cwd")?.as_str().map(str::to_owned)
    })
}

fn user_text(message: &Value) -> Option<String> {
    let content = message.get("content")?;
    if let Some(text) = content.as_str() {
        return Some(text.to_owned());
    }
    content.as_array()?.iter().find_map(|block| {
        (block.get("type")?.as_str()? == "text").then(|| block.get("text")?.as_str().map(str::to_owned))?
    })
}

fn first_prompt(path: &Path) -> Option<String> {
    let file = File::open(path).ok()?;
    BufReader::new(file).lines().map_while(Result::ok).find_map(|line| {
        let value: Value = serde_json::from_str(&line).ok()?;
        let message = value.get("message")?;
        (message.get("role")?.as_str()? == "user").then(|| user_text(message))?
    })
}

fn session_name(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let length = file.metadata().ok()?.len();
    file.seek(SeekFrom::Start(length.saturating_sub(TITLE_TAIL_BYTES))).ok()?;
    let mut tail = Vec::new();
    file.read_to_end(&mut tail).ok()?;
    String::from_utf8_lossy(&tail)
        .lines()
        .rev()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .find(|value| value.get("type").and_then(Value::as_str) == Some("session_info"))
        .and_then(|value| value.get("name")?.as_str().map(str::to_owned))
}

fn shorten(text: &str) -> String {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.chars().count() <= TITLE_CHARS {
        return line;
    }
    line.chars().take(TITLE_CHARS).collect::<String>() + "…"
}

pub fn list_tasks(sessions: &Path, roots: &[String]) -> Vec<TaskSummary> {
    let Ok(projects) = fs::read_dir(sessions) else {
        return Vec::new();
    };
    let belongs = |cwd: &str| roots.iter().any(|root| is_under(cwd, root));
    let mut seen = HashSet::new();
    let mut files = Vec::new();
    for project in projects.flatten() {
        let project_files = session_files(&project.path(), &mut seen);
        if project_files.iter().find_map(|(_, path)| read_cwd(path)).is_some_and(|cwd| belongs(&cwd)) {
            files.extend(project_files);
        }
    }
    files.sort_by(|a, b| b.0.cmp(&a.0));
    files
        .into_iter()
        .filter_map(|(updated_at_ms, path)| {
            let cwd = read_cwd(&path).filter(|cwd| belongs(cwd))?;
            let title = session_name(&path).or_else(|| first_prompt(&path)).unwrap_or_default();
            Some(TaskSummary {
                id: task_id_of(&path)?,
                title: shorten(&title),
                cwd,
                updated_at_ms,
                agent: Agent::Pi,
            })
        })
        .take(MAX_TASKS)
        .collect()
}

pub fn discover_projects(sessions: &Path) -> Vec<DiscoveredProject> {
    let Ok(projects) = fs::read_dir(sessions) else {
        return Vec::new();
    };
    let mut seen = HashSet::new();
    projects
        .flatten()
        .filter_map(|project| {
            let files = session_files(&project.path(), &mut seen);
            let last_active_ms = files.first()?.0;
            let cwd = files.iter().find_map(|(_, path)| read_cwd(path))?;
            Some(DiscoveredProject { cwd, last_active_ms })
        })
        .collect()
}

/// Looks the id up on disk, so a caller cannot make Tandem read outside the sessions folder.
pub fn find_task_file(sessions: &Path, id: &str) -> Result<PathBuf, String> {
    uuid::Uuid::parse_str(id).map_err(|_| format!("Invalid task id: {id}"))?;
    let projects = fs::read_dir(sessions).map_err(|error| error.to_string())?;
    projects
        .flatten()
        .filter_map(|project| fs::read_dir(project.path()).ok())
        .flat_map(|entries| entries.flatten())
        .map(|entry| entry.path())
        .find(|path| task_id_of(path).as_deref() == Some(id))
        .ok_or_else(|| "Task not found".to_owned())
}

fn clip(text: &str) -> (String, bool) {
    if text.len() <= MAX_TEXT_BYTES {
        return (text.to_owned(), false);
    }
    let mut end = MAX_TEXT_BYTES;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (text[..end].to_owned(), true)
}

fn message(id: String, kind: MessageKind, text: String, timestamp: Option<String>) -> Message {
    Message { id, kind, text, tool_name: None, tool_use_id: None, is_error: false, truncated: false, timestamp, image: None }
}

/// Names and fields the page already knows from Claude's tools.
fn page_tool(name: &str, arguments: &Value) -> (String, String) {
    if name == "bash" {
        let command = arguments.get("command").cloned().unwrap_or(Value::Null);
        return ("Bash".to_owned(), json!({"command": command}).to_string());
    }
    if let Some((_, page_name)) = FILE_TOOLS.iter().find(|(tool, _)| *tool == name) {
        let path = arguments.get("path").or_else(|| arguments.get("file_path")).cloned().unwrap_or(Value::Null);
        return ((*page_name).to_owned(), json!({"file_path": path}).to_string());
    }
    (name.to_owned(), arguments.to_string())
}

fn text_of(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(blocks)) => blocks
            .iter()
            .filter_map(|block| block.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn entry_messages(entry: &Value) -> Vec<Message> {
    let id = entry.get("id").and_then(Value::as_str).unwrap_or_default();
    let timestamp = entry.get("timestamp").and_then(Value::as_str).map(str::to_owned);
    if entry.get("type").and_then(Value::as_str) == Some("compaction") {
        return vec![message(id.to_owned(), MessageKind::Compaction, String::new(), timestamp)];
    }
    let Some(inner) = entry.get("message") else {
        return Vec::new();
    };
    match inner.get("role").and_then(Value::as_str) {
        Some("user") => user_messages(inner, id, timestamp),
        Some("assistant") => assistant_messages(inner, id, timestamp),
        Some("toolResult") => {
            let (text, truncated) = clip(&text_of(inner.get("content")));
            let mut result = message(id.to_owned(), MessageKind::ToolResult, text, timestamp);
            result.tool_use_id = inner.get("toolCallId").and_then(Value::as_str).map(str::to_owned);
            result.is_error = inner.get("isError").and_then(Value::as_bool).unwrap_or(false);
            result.truncated = truncated;
            vec![result]
        }
        _ => Vec::new(),
    }
}

fn user_messages(inner: &Value, id: &str, timestamp: Option<String>) -> Vec<Message> {
    let mut messages = Vec::new();
    if let Some(blocks) = inner.get("content").and_then(Value::as_array) {
        for (index, block) in blocks.iter().enumerate() {
            if block.get("type").and_then(Value::as_str) != Some("image") {
                continue;
            }
            let media_type = block.get("mimeType").and_then(Value::as_str).unwrap_or_default();
            let Some(data) = block.get("data").and_then(Value::as_str) else { continue };
            if crate::attachments::is_inline_media_type(media_type) {
                messages.push(Message {
                    image: Some(format!("data:{media_type};base64,{data}")),
                    ..message(format!("{id}:{index}"), MessageKind::User, String::new(), timestamp.clone())
                });
            }
        }
    }
    let text = text_of(inner.get("content"));
    if !text.trim().is_empty() {
        messages.push(message(id.to_owned(), MessageKind::User, text, timestamp));
    }
    messages
}

fn assistant_messages(inner: &Value, id: &str, timestamp: Option<String>) -> Vec<Message> {
    let Some(blocks) = inner.get("content").and_then(Value::as_array) else {
        return Vec::new();
    };
    blocks
        .iter()
        .enumerate()
        .filter_map(|(index, block)| {
            let block_id = format!("{id}:{index}");
            match block.get("type").and_then(Value::as_str) {
                Some("text") => {
                    let text = block.get("text")?.as_str()?;
                    (!text.trim().is_empty()).then(|| message(block_id, MessageKind::Assistant, text.to_owned(), timestamp.clone()))
                }
                Some("thinking") => {
                    let text = block.get("thinking")?.as_str()?;
                    (!text.trim().is_empty()).then(|| message(block_id, MessageKind::Thinking, text.to_owned(), timestamp.clone()))
                }
                Some("toolCall") => {
                    let name = block.get("name")?.as_str()?;
                    let (page_name, input) = page_tool(name, block.get("arguments").unwrap_or(&Value::Null));
                    let mut call = message(block_id, MessageKind::ToolUse, input, timestamp.clone());
                    call.tool_name = Some(page_name);
                    call.tool_use_id = block.get("id").and_then(Value::as_str).map(str::to_owned);
                    Some(call)
                }
                _ => None,
            }
        })
        .collect()
}

/// Walks from the last entry back through its parents, which skips abandoned branches.
fn active_path(entries: &[Value]) -> Vec<&Value> {
    let by_id: HashMap<&str, &Value> =
        entries.iter().filter_map(|entry| Some((entry.get("id")?.as_str()?, entry))).collect();
    let mut path = Vec::new();
    let mut current = entries.iter().rev().find(|entry| entry.get("id").is_some());
    let mut visited = HashSet::new();
    while let Some(entry) = current {
        let id = entry.get("id").and_then(Value::as_str).unwrap_or_default();
        if !visited.insert(id) {
            break;
        }
        path.push(entry);
        current = entry.get("parentId").and_then(Value::as_str).and_then(|parent| by_id.get(parent).copied());
    }
    path.reverse();
    path
}

pub fn read_task(path: &Path) -> Result<TaskContent, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let entries: Vec<Value> = BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str(&line).ok())
        .filter(|value: &Value| value.get("type").and_then(Value::as_str) != Some("session"))
        .collect();
    let messages = active_path(&entries).into_iter().flat_map(entry_messages).collect();
    Ok(TaskContent { messages, context: None })
}

pub fn task_cwd(id: &str) -> Result<String, String> {
    let path = find_task_file(&sessions_dir()?, id)?;
    read_cwd(&path).ok_or_else(|| "The task has no working directory".to_owned())
}

fn model_option(model: &Value, value: Option<&str>, thinking: Option<&str>) -> Option<ModelOption> {
    let provider = model.get("provider")?.as_str()?;
    let id = model.get("id")?.as_str()?;
    let full = format!("{provider}/{id}");
    let levels: Vec<String> = if model.get("reasoning").and_then(Value::as_bool) == Some(true) {
        let map = model.get("thinkingLevelMap").and_then(Value::as_object);
        ["minimal", "low", "medium", "high", "xhigh", "max"]
            .iter()
            .filter(|level| map.is_none_or(|map| !map.get(**level).is_some_and(Value::is_null)))
            .map(|level| (*level).to_owned())
            .collect()
    } else {
        Vec::new()
    };
    Some(ModelOption {
        value: value.unwrap_or(&full).to_owned(),
        display_name: model.get("name").and_then(Value::as_str).unwrap_or(id).to_owned(),
        description: id.to_owned(),
        resolved_model: full,
        supports_effort: !levels.is_empty(),
        default_effort: thinking.filter(|level| levels.iter().any(|known| known == level)).map(str::to_owned),
        supported_effort_levels: levels,
        supports_auto_mode: false,
    })
}

fn model_options(models: &[Value], current: Option<&Value>, thinking: Option<&str>) -> Vec<ModelOption> {
    let mut options: Vec<ModelOption> = current.and_then(|model| model_option(model, Some(DEFAULT_MODEL), thinking)).into_iter().collect();
    options.extend(models.iter().filter_map(|model| model_option(model, None, thinking)));
    options
}

/// Skips extensions, which would connect the user's MCP servers just to list models.
pub async fn info() -> Result<CliInfo, String> {
    let env = login_env::login_env().await;
    let Some(program) = login_env::find_in_path("pi", env.get("PATH")) else {
        return Ok(CliInfo { models: Vec::new(), usage: None });
    };
    let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
    let mut child = Command::new(program)
        .args(["--mode", "rpc", "--no-session", "--no-extensions"])
        .current_dir(home)
        .env_clear()
        .envs(env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("Failed to start pi: {error}"))?;
    let mut stdin = child.stdin.take().ok_or("pi has no stdin")?;
    let stdout = child.stdout.take().ok_or("pi has no stdout")?;
    let request = format!("{}\n{}\n", json!({"id": "models", "type": "get_available_models"}), json!({"id": "state", "type": "get_state"}));
    stdin.write_all(request.as_bytes()).await.map_err(|error| error.to_string())?;
    let read = async {
        let mut lines = AsyncBufReader::new(stdout).lines();
        let (mut models, mut current, mut thinking) = (None, None, None);
        while models.is_none() || current.is_none() {
            let Some(line) = lines.next_line().await.map_err(|error| error.to_string())? else { break };
            let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
            match value.get("id").and_then(Value::as_str) {
                Some("models") => models = value.pointer("/data/models").and_then(Value::as_array).cloned(),
                Some("state") => {
                    current = Some(value.pointer("/data/model").cloned().unwrap_or(Value::Null));
                    thinking = value.pointer("/data/thinkingLevel").and_then(Value::as_str).map(str::to_owned);
                }
                _ => {}
            }
        }
        Ok::<_, String>((models.unwrap_or_default(), current, thinking))
    };
    let (models, current, thinking) = tokio::time::timeout(INFO_TIMEOUT, read).await.map_err(|_| "pi did not answer in time".to_owned())??;
    drop(stdin);
    Ok(CliInfo { models: model_options(&models, current.as_ref(), thinking.as_deref()), usage: None })
}

#[derive(Default)]
struct TurnState {
    output_tokens: u64,
    model: Option<String>,
    window_sent: bool,
    error: Option<String>,
}

fn usage_events(usage: &Value, state: &mut TurnState) -> Vec<TurnEvent> {
    let number = |field: &str| usage.get(field).and_then(Value::as_u64).unwrap_or_default();
    state.output_tokens += number("output");
    vec![
        TurnEvent::OutputTokens { total: state.output_tokens },
        TurnEvent::ContextUsage {
            used_tokens: number("input") + number("cacheRead") + number("cacheWrite"),
            model: state.model.clone(),
        },
    ]
}

fn stream_events(value: &Value, state: &mut TurnState) -> Vec<TurnEvent> {
    match value.get("type").and_then(Value::as_str) {
        Some("message_update") => {
            let Some(event) = value.get("assistantMessageEvent") else {
                return Vec::new();
            };
            let delta = || event.get("delta").and_then(Value::as_str).unwrap_or_default().to_owned();
            match event.get("type").and_then(Value::as_str) {
                Some("text_delta") => vec![TurnEvent::TextDelta { text: delta() }],
                Some("thinking_delta") => vec![TurnEvent::ThinkingDelta { text: delta() }],
                _ => Vec::new(),
            }
        }
        Some("message_end") => {
            let Some(inner) = value.get("message").filter(|inner| inner.get("role").and_then(Value::as_str) == Some("assistant")) else {
                return Vec::new();
            };
            if inner.get("stopReason").and_then(Value::as_str) == Some("error") {
                state.error = Some(inner.get("errorMessage").and_then(Value::as_str).unwrap_or("Pi reported a failure").to_owned());
            }
            inner.get("usage").map(|usage| usage_events(usage, state)).unwrap_or_default()
        }
        Some("tool_execution_start") => {
            let name = value.get("toolName").and_then(Value::as_str).unwrap_or("tool");
            let (page_name, input) = page_tool(name, value.get("args").unwrap_or(&Value::Null));
            let id = value.get("toolCallId").and_then(Value::as_str).unwrap_or_default().to_owned();
            vec![TurnEvent::ToolUse { id, name: page_name, input }]
        }
        Some("tool_execution_end") => {
            let text = text_of(value.get("result").and_then(|result| result.get("content")));
            vec![TurnEvent::ToolResult {
                tool_use_id: value.get("toolCallId").and_then(Value::as_str).unwrap_or_default().to_owned(),
                text: clip(&text).0,
                is_error: value.get("isError").and_then(Value::as_bool).unwrap_or(false),
            }]
        }
        _ => Vec::new(),
    }
}

/// An extension's dialog as a card, or None for the requests that only change its own display.
fn ui_request(value: &Value) -> Option<(String, TurnEvent, PendingRequest)> {
    let id = value.get("id")?.as_str()?.to_owned();
    let method = value.get("method")?.as_str()?;
    let title = value.get("title").and_then(Value::as_str).unwrap_or_default().to_owned();
    match method {
        "confirm" => {
            let text = value.get("message").and_then(Value::as_str).map(str::to_owned);
            let input = json!({"command": title});
            Some((
                id.clone(),
                TurnEvent::PermissionRequest {
                    request_id: id,
                    tool_name: "Extension".to_owned(),
                    input: input.to_string(),
                    description: text,
                    rules: Vec::new(),
                },
                PendingRequest::for_pi("Extension", input, method),
            ))
        }
        "select" | "input" | "editor" => {
            let options: Vec<Value> = value
                .get("options")
                .and_then(Value::as_array)
                .map(|options| options.iter().filter_map(Value::as_str).map(|label| json!({"label": label})).collect())
                .unwrap_or_default();
            let question = json!({"question": title, "header": "", "options": options});
            Some((
                id.clone(),
                TurnEvent::Question { request_id: id, questions: json!([question]) },
                PendingRequest::for_pi(QUESTION_TOOL, json!({"question": title}), method),
            ))
        }
        _ => None,
    }
}

pub fn ui_reply(id: &str, request: &PendingRequest, method: &str, decision: &Decision) -> Result<String, String> {
    let reply = match (method, decision) {
        (_, Decision::Deny) => json!({"type": "extension_ui_response", "id": id, "cancelled": true}),
        ("confirm", Decision::Allow) => json!({"type": "extension_ui_response", "id": id, "confirmed": true}),
        (_, Decision::Answer { answers }) => {
            let question = request.input.get("question").and_then(Value::as_str).unwrap_or_default();
            let value = answers.get(question).cloned().unwrap_or(Value::Null);
            json!({"type": "extension_ui_response", "id": id, "value": value})
        }
        _ => return Err("This decision does not fit the request".into()),
    };
    Ok(reply.to_string())
}

fn prompt_line(prompt: &str, attachments: &Prepared) -> String {
    let content = attachments.content(prompt);
    let text = content.iter().find_map(|block| block.get("text").and_then(Value::as_str)).unwrap_or_default();
    let images: Vec<Value> = content
        .iter()
        .filter_map(|block| {
            let source = block.get("source")?;
            Some(json!({"type": "image", "data": source.get("data")?, "mimeType": source.get("media_type")?}))
        })
        .collect();
    let mut command = json!({"id": "prompt", "type": "prompt", "message": text});
    if !images.is_empty() {
        command["images"] = Value::Array(images);
    }
    command.to_string()
}

pub async fn send_turn(runs: &Runs, request: TurnRequest, on_event: TurnSink) -> Result<(), String> {
    request.options.validate_pi()?;
    let emit = |event| on_event.send(event);
    let (task_id, cwd, session_args) = match &request.task_id {
        Some(id) => {
            let path = find_task_file(&sessions_dir()?, id)?;
            let cwd = read_cwd(&path).ok_or("The task has no working directory")?;
            (id.clone(), cwd, vec!["--session".to_owned(), path.to_string_lossy().into_owned()])
        }
        None => {
            let cwd = request.cwd.clone().ok_or("A new task needs a working directory")?;
            let id = uuid::Uuid::new_v4().to_string();
            (id.clone(), cwd, vec!["--session-id".to_owned(), id])
        }
    };
    if !Path::new(&cwd).is_dir() {
        return Err(format!("Working directory not found: {cwd}"));
    }
    let channels = runs.begin(&task_id)?;
    let result = async {
        emit(TurnEvent::Started { task_id: task_id.clone() })?;
        run_turn(runs, &task_id, &cwd, &session_args, &request, channels, &emit).await
    }
    .await;
    runs.finish(&task_id);
    if let Err(message) = result {
        emit(TurnEvent::Finished { is_error: true, cancelled: false, message: Some(message) })?;
    }
    Ok(())
}

async fn run_turn(
    runs: &Runs,
    task_id: &str,
    cwd: &str,
    session_args: &[String],
    request: &TurnRequest,
    channels: RunChannels,
    emit: &impl Fn(TurnEvent) -> Result<(), String>,
) -> Result<(), String> {
    let RunChannels { mut cancel, mut input } = channels;
    let env = login_env::login_env().await;
    let program = login_env::find_in_path("pi", env.get("PATH")).ok_or("pi was not found in the login shell PATH")?;
    let mut args: Vec<String> = vec!["--mode".to_owned(), "rpc".to_owned()];
    args.extend_from_slice(session_args);
    if let Some(model) = &request.options.model {
        args.extend(["--model".to_owned(), model.clone()]);
    }
    if let Some(effort) = &request.options.effort {
        args.extend(["--thinking".to_owned(), effort.clone()]);
    }
    let mut child = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .env_clear()
        .envs(env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("Failed to start pi: {error}"))?;
    let mut stdin = child.stdin.take().ok_or("pi has no stdin")?;
    let stdout = child.stdout.take().ok_or("pi has no stdout")?;
    let mut lines = AsyncBufReader::new(stdout).lines();
    let start = format!(
        "{}\n{}\n",
        json!({"id": "state", "type": "get_state"}),
        prompt_line(&request.prompt, &request.attachments)
    );
    stdin.write_all(start.as_bytes()).await.map_err(|error| format!("Failed to send the prompt: {error}"))?;

    let mut state = TurnState { model: request.options.model.clone(), ..TurnState::default() };
    let mut finished = None::<TurnEvent>;
    let mut abort_deadline = None::<tokio::time::Instant>;
    while finished.is_none() {
        let deadline = async {
            match abort_deadline {
                Some(at) => tokio::time::sleep_until(at).await,
                None => std::future::pending().await,
            }
        };
        tokio::select! {
            line = lines.next_line() => {
                let Some(line) = line.map_err(|error| error.to_string())? else {
                    return Err("pi exited before the turn finished".to_owned());
                };
                let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
                match value.get("type").and_then(Value::as_str) {
                    Some("response") => {
                        let is_prompt = value.get("id").and_then(Value::as_str) == Some("prompt");
                        if is_prompt && value.get("success").and_then(Value::as_bool) == Some(false) {
                            return Err(value.get("error").and_then(Value::as_str).unwrap_or("pi refused the prompt").to_owned());
                        }
                        if is_prompt && value.pointer("/data/disposition").and_then(Value::as_str) == Some("handled") {
                            finished = Some(TurnEvent::Finished { is_error: false, cancelled: false, message: None });
                        }
                        if value.get("id").and_then(Value::as_str) == Some("state") {
                            let model = value.pointer("/data/model");
                            if state.model.is_none() {
                                state.model = model.and_then(|model| Some(format!("{}/{}", model.get("provider")?.as_str()?, model.get("id")?.as_str()?)));
                            }
                            if let (Some(name), Some(tokens)) = (&state.model, model.and_then(|model| model.get("contextWindow")).and_then(Value::as_u64)) {
                                if !state.window_sent {
                                    state.window_sent = true;
                                    emit(TurnEvent::ContextWindow { model: name.clone(), tokens })?;
                                }
                            }
                        }
                    }
                    Some("extension_ui_request") => {
                        if let Some((id, event, pending)) = ui_request(&value) {
                            runs.add_pending_request(task_id, id, pending);
                            emit(event)?;
                        }
                    }
                    Some("agent_settled") => {
                        let aborted = value.get("aborted").and_then(Value::as_bool).unwrap_or(false);
                        finished = Some(TurnEvent::Finished {
                            is_error: state.error.is_some() && !aborted,
                            cancelled: aborted,
                            message: state.error.take().filter(|_| !aborted),
                        });
                    }
                    _ => {
                        for event in stream_events(&value, &mut state) {
                            emit(event)?;
                        }
                    }
                }
            }
            Some(reply) = input.recv() => {
                stdin.write_all(format!("{reply}\n").as_bytes()).await.map_err(|error| error.to_string())?;
            }
            _ = &mut cancel, if abort_deadline.is_none() => {
                stdin.write_all(format!("{}\n", json!({"type": "abort"})).as_bytes()).await.map_err(|error| error.to_string())?;
                abort_deadline = Some(tokio::time::Instant::now() + INTERRUPT_TIMEOUT);
            }
            _ = deadline => {
                finished = Some(TurnEvent::Finished { is_error: false, cancelled: true, message: None });
            }
        }
    }
    // Closing stdin is how Pi is asked to finish writing and exit.
    drop(stdin);
    if tokio::time::timeout(EXIT_TIMEOUT, child.wait()).await.is_err() {
        let _ = child.kill().await;
    }
    match finished {
        Some(event) => emit(event),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(lines: &[Value]) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("--code-app--");
        fs::create_dir(&project).unwrap();
        let path = project.join("2026-11-05T04-14-12-391Z_5d029ae1-6937-4a9e-bcf0-70a9cbcd6d9d.jsonl");
        let text: Vec<String> = lines.iter().map(Value::to_string).collect();
        fs::write(&path, text.join("\n")).unwrap();
        (dir, path)
    }

    fn sample() -> Vec<Value> {
        vec![
            json!({"type": "session", "version": 3, "id": "5d029ae1", "cwd": "/code/app"}),
            json!({"type": "message", "id": "a", "parentId": null, "message": {"role": "user", "content": [{"type": "text", "text": "fix it"}]}}),
            json!({"type": "message", "id": "b", "parentId": "a", "message": {"role": "assistant", "content": [
                {"type": "thinking", "thinking": "hm"},
                {"type": "toolCall", "id": "t1", "name": "read", "arguments": {"path": "/a.rs"}},
            ]}}),
            json!({"type": "message", "id": "c", "parentId": "b", "message": {"role": "toolResult", "toolCallId": "t1", "toolName": "read", "content": [{"type": "text", "text": "body"}], "isError": false}}),
            json!({"type": "message", "id": "dead", "parentId": "c", "message": {"role": "assistant", "content": [{"type": "text", "text": "abandoned"}]}}),
            json!({"type": "message", "id": "d", "parentId": "c", "message": {"role": "assistant", "content": [{"type": "text", "text": "done"}]}}),
        ]
    }

    #[test]
    fn reads_the_branch_ending_at_the_last_entry() {
        let (_dir, path) = session(&sample());
        let messages = read_task(&path).unwrap().messages;
        let kinds: Vec<&str> = messages.iter().map(|message| message.text.as_str()).collect();
        assert_eq!(kinds, ["fix it", "hm", r#"{"file_path":"/a.rs"}"#, "body", "done"]);
        assert_eq!(messages[2].tool_name.as_deref(), Some("Read"));
    }

    #[test]
    fn lists_only_tasks_under_the_roots_and_skips_nested_runs() {
        let (dir, path) = session(&sample());
        let nested = path.parent().unwrap().join(path.file_stem().unwrap()).join("run");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("11111111-1111-4111-8111-111111111111.jsonl"), sample()[0].to_string()).unwrap();
        let tasks = list_tasks(dir.path(), &["/code/app".to_owned()]);
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].title, "fix it");
        assert_eq!(tasks[0].id, "5d029ae1-6937-4a9e-bcf0-70a9cbcd6d9d");
        assert!(list_tasks(dir.path(), &["/other".to_owned()]).is_empty());
    }

    #[test]
    fn a_session_name_outranks_the_first_prompt() {
        let mut lines = sample();
        lines.push(json!({"type": "session_info", "id": "e", "parentId": "d", "name": "Named"}));
        let marker = entry_messages(&json!({"type": "compaction", "id": "k", "parentId": "d", "summary": "for the model", "firstKeptEntryId": "c", "tokensBefore": 9}));
        assert_eq!((marker[0].kind, marker[0].text.as_str()), (MessageKind::Compaction, ""));
        let (dir, _path) = session(&lines);
        assert_eq!(list_tasks(dir.path(), &["/code/app".to_owned()])[0].title, "Named");
    }

    #[test]
    fn finds_a_task_only_by_a_real_id() {
        let (dir, path) = session(&sample());
        assert_eq!(find_task_file(dir.path(), "5d029ae1-6937-4a9e-bcf0-70a9cbcd6d9d").unwrap(), path);
        assert!(find_task_file(dir.path(), "../secret").is_err());
    }

    #[test]
    fn stream_events_become_the_shared_turn_events() {
        let mut state = TurnState { model: Some("m".into()), ..TurnState::default() };
        let text = json!({"type": "message_update", "assistantMessageEvent": {"type": "text_delta", "delta": "hi"}});
        assert_eq!(stream_events(&text, &mut state), vec![TurnEvent::TextDelta { text: "hi".into() }]);
        let start = json!({"type": "tool_execution_start", "toolCallId": "t", "toolName": "bash", "args": {"command": "ls", "timeout": 10}});
        assert_eq!(stream_events(&start, &mut state), vec![TurnEvent::ToolUse { id: "t".into(), name: "Bash".into(), input: r#"{"command":"ls"}"#.into() }]);
        let end = json!({"type": "tool_execution_end", "toolCallId": "t", "result": {"content": [{"type": "text", "text": "out"}]}, "isError": true});
        assert_eq!(stream_events(&end, &mut state), vec![TurnEvent::ToolResult { tool_use_id: "t".into(), text: "out".into(), is_error: true }]);
        let usage = json!({"type": "message_end", "message": {"role": "assistant", "stopReason": "error", "errorMessage": "boom", "usage": {"input": 1, "cacheRead": 2, "cacheWrite": 3, "output": 4}}});
        let events = stream_events(&usage, &mut state);
        assert!(events.contains(&TurnEvent::ContextUsage { used_tokens: 6, model: Some("m".into()) }));
        assert_eq!(state.error.as_deref(), Some("boom"));
    }

    #[test]
    fn extension_dialogs_become_cards_and_their_replies_match() {
        let confirm = json!({"type": "extension_ui_request", "id": "1", "method": "confirm", "title": "Delete?", "message": "really"});
        let (id, event, pending) = ui_request(&confirm).unwrap();
        assert!(matches!(event, TurnEvent::PermissionRequest { .. }));
        let reply: Value = serde_json::from_str(&ui_reply(&id, &pending, "confirm", &Decision::Allow).unwrap()).unwrap();
        assert_eq!(reply["confirmed"], true);
        let reply: Value = serde_json::from_str(&ui_reply(&id, &pending, "confirm", &Decision::Deny).unwrap()).unwrap();
        assert_eq!(reply["cancelled"], true);

        let select = json!({"type": "extension_ui_request", "id": "2", "method": "select", "title": "Pick", "options": ["A", "B"]});
        let (id, _, pending) = ui_request(&select).unwrap();
        let mut answers = serde_json::Map::new();
        answers.insert("Pick".to_owned(), json!("B"));
        let reply: Value = serde_json::from_str(&ui_reply(&id, &pending, "select", &Decision::Answer { answers }).unwrap()).unwrap();
        assert_eq!(reply["value"], "B");

        assert!(ui_request(&json!({"id": "3", "method": "setStatus"})).is_none());
    }

    #[test]
    fn lists_models_with_their_thinking_levels() {
        let model = json!({"provider": "p", "id": "m", "name": "Model", "reasoning": true, "thinkingLevelMap": {"minimal": null, "low": "low", "high": "high"}});
        let options = model_options(std::slice::from_ref(&model), Some(&model), Some("high"));
        assert_eq!(options[1].default_effort.as_deref(), Some("high"));
        assert_eq!(options[0].value, "default");
        assert_eq!(options[0].resolved_model, "p/m");
        assert_eq!(options[1].value, "p/m");
        assert!(!options[1].supported_effort_levels.contains(&"minimal".to_owned()));
        assert!(options[1].supported_effort_levels.contains(&"high".to_owned()));
        let plain = json!({"provider": "p", "id": "n", "reasoning": false});
        assert!(!model_option(&plain, None, None).unwrap().supports_effort);
    }
}

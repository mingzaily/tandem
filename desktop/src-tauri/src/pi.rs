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
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, UNIX_EPOCH};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader as AsyncBufReader};
use tokio::process::Command;

mod questions;
use questions::DialogReplies;

const TITLE_CHARS: usize = 80;
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
    let text = user_message_text(message);
    (!text.trim().is_empty()).then_some(text)
}

fn first_prompt(path: &Path) -> Option<String> {
    let file = File::open(path).ok()?;
    BufReader::new(file).lines().map_while(Result::ok).find_map(|line| {
        let value: Value = serde_json::from_str(&line).ok()?;
        let message = value.get("message")?;
        (message.get("role")?.as_str()? == "user").then(|| user_text(message))?
    })
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
            let title = crate::session_titles::pi(&path).or_else(|| first_prompt(&path)).unwrap_or_default();
            Some(TaskSummary {
                id: task_id_of(&path)?,
                title: shorten(&title),
                cwd,
                updated_at_ms,
                agent: Agent::Pi,
                archived: None,
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
    Message { id, kind, text, tool_name: None, tool_use_id: None, is_error: false, truncated: false, timestamp, image: None, image_error: None }
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
            let (text, truncated) = clip(&questions::result_text(inner, inner.get("toolName").and_then(Value::as_str)));
            let mut result = message(id.to_owned(), MessageKind::ToolResult, text, timestamp);
            result.tool_use_id = inner.get("toolCallId").and_then(Value::as_str).map(str::to_owned);
            result.is_error = inner.get("isError").and_then(Value::as_bool).unwrap_or(false);
            result.truncated = truncated;
            vec![result]
        }
        _ => Vec::new(),
    }
}

fn image_hint(line: &str) -> bool {
    let Some(body) = line.strip_prefix("[Image: original ").and_then(|line| line.strip_suffix(" to map to original image.]")) else {
        return false;
    };
    let Some((sizes, scale)) = body.split_once(". Multiply coordinates by ") else { return false };
    let Some((original, displayed)) = sizes.split_once(", displayed at ") else { return false };
    let dimensions = |value: &str| value.split_once(['x', '×']).is_some_and(|(width, height)| {
        width.parse::<u32>().is_ok_and(|value| value > 0) && height.parse::<u32>().is_ok_and(|value| value > 0)
    });
    dimensions(original) && dimensions(displayed) && scale.parse::<f64>().is_ok_and(|value| value.is_finite() && value > 0.0)
}

/// Pi appends image-resize coordinates for the model after the user's prompt.
fn user_message_text(inner: &Value) -> String {
    let text = text_of(inner.get("content"));
    let has_image = inner.get("content").and_then(Value::as_array)
        .is_some_and(|blocks| blocks.iter().any(|block| block.get("type").and_then(Value::as_str) == Some("image")));
    if !has_image { return text; }
    let mut body = text.as_str();
    let mut removed = false;
    loop {
        let (before, line) = body.rsplit_once('\n').unwrap_or(("", body));
        if !image_hint(line) { break; }
        body = before;
        removed = true;
    }
    // Pi joins the original prompt and hint lines with exactly two newlines.
    // Removing only that separator preserves the user's own trailing whitespace and CRLF.
    if removed {
        if let Some(original) = body.strip_suffix('\n') { return original.to_owned(); }
    }
    text
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
    let text = user_message_text(inner);
    if !text.trim().is_empty() {
        messages.push(message(id.to_owned(), MessageKind::User, text, timestamp));
    }
    messages
}

fn assistant_messages(inner: &Value, id: &str, timestamp: Option<String>) -> Vec<Message> {
    let blocks = inner.get("content").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
    let mut messages: Vec<Message> = blocks
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
        .collect();
    if inner.get("stopReason").and_then(Value::as_str) == Some("error") {
        let text = inner.get("errorMessage").and_then(Value::as_str).unwrap_or_default();
        let mut error = message(format!("{id}:error"), MessageKind::Assistant, text.to_owned(), timestamp);
        error.is_error = true;
        messages.push(error);
    }
    messages
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

fn task_model(entries: &[&Value]) -> Option<crate::sessions::TaskModel> {
    let mut model = None;
    let mut effort = None;
    for entry in entries {
        match entry.get("type").and_then(Value::as_str) {
            Some("model_change") => {
                if let (Some(provider), Some(id)) = (entry.get("provider").and_then(Value::as_str), entry.get("modelId").and_then(Value::as_str)) {
                    model = Some(format!("{provider}/{id}"));
                }
            }
            Some("thinking_level_change") => effort = entry.get("thinkingLevel").and_then(Value::as_str).map(str::to_owned),
            Some("message") => {
                if let Some(message) = entry.get("message").filter(|message| message.get("role").and_then(Value::as_str) == Some("assistant")) {
                    if let (Some(provider), Some(id)) = (message.get("provider").and_then(Value::as_str), message.get("model").and_then(Value::as_str)) {
                        model = Some(format!("{provider}/{id}"));
                    }
                }
            }
            _ => {}
        }
    }
    model.map(|model| crate::sessions::TaskModel { model, effort })
}

pub fn read_task(path: &Path) -> Result<TaskContent, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let entries: Vec<Value> = BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str(&line).ok())
        .filter(|value: &Value| value.get("type").and_then(Value::as_str) != Some("session"))
        .collect();
    let active = active_path(&entries);
    let model_selection = task_model(&active);
    let messages = crate::sessions::terminal_reply_errors(active.into_iter().flat_map(entry_messages).collect());
    Ok(TaskContent { messages, context: None, model_selection, permission_mode: None })
}

pub fn task_cwd(id: &str) -> Result<String, String> {
    let path = find_task_file(&sessions_dir()?, id)?;
    read_cwd(&path).ok_or_else(|| "The task has no working directory".to_owned())
}

fn model_option(model: &Value, value: Option<&str>, levels: Value, thinking: Option<&str>) -> Result<ModelOption, String> {
    let provider = model.get("provider").and_then(Value::as_str).ok_or("Pi 模型缺少 provider")?;
    let id = model.get("id").and_then(Value::as_str).ok_or("Pi 模型缺少 id")?;
    let full = format!("{provider}/{id}");
    let levels: Vec<String> = serde_json::from_value(levels).map_err(|error| format!("Pi 推理档位格式有误：{error}"))?;
    let levels = if model.get("reasoning").and_then(Value::as_bool) == Some(true) { levels } else { Vec::new() };
    Ok(ModelOption {
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

async fn info_call<W, R>(stdin: &mut W, lines: &mut tokio::io::Lines<R>, id: &str, mut request: Value) -> Result<Value, String>
where
    W: tokio::io::AsyncWrite + Unpin,
    R: tokio::io::AsyncBufRead + Unpin,
{
    request["id"] = json!(id);
    stdin.write_all(format!("{request}\n").as_bytes()).await.map_err(|error| error.to_string())?;
    while let Some(line) = lines.next_line().await.map_err(|error| error.to_string())? {
        let Ok(reply) = serde_json::from_str::<Value>(&line) else { continue };
        if reply.get("id").and_then(Value::as_str) != Some(id) { continue; }
        return match reply.get("success").and_then(Value::as_bool) {
            Some(true) => Ok(reply.get("data").cloned().unwrap_or(Value::Null)),
            Some(false) => Err(reply.get("error").and_then(Value::as_str).unwrap_or("Pi 读取模型信息失败").to_owned()),
            None => Err("Pi 模型信息响应缺少 success".into()),
        };
    }
    Err("Pi 在返回模型信息前退出".into())
}

async fn read_model_options<W, R>(stdin: &mut W, lines: &mut tokio::io::Lines<R>) -> Result<Vec<ModelOption>, String>
where
    W: tokio::io::AsyncWrite + Unpin,
    R: tokio::io::AsyncBufRead + Unpin,
{
    let available = info_call(stdin, lines, "models", json!({"type": "get_available_models"})).await?;
    let models = available.get("models").and_then(Value::as_array).ok_or("Pi 响应缺少模型列表")?;
    let state = info_call(stdin, lines, "state", json!({"type": "get_state"})).await?;
    let mut options = Vec::new();
    if let Some(current) = state.get("model").filter(|model| !model.is_null()) {
        let levels = info_call(stdin, lines, "levels", json!({"type": "get_available_thinking_levels"})).await?;
        options.push(model_option(current, Some(DEFAULT_MODEL), levels["levels"].clone(), state.get("thinkingLevel").and_then(Value::as_str))?);
    }
    // Pi applies per-model defaults and provider-specific capability maps in memory.
    // RPC set_model uses persist=false; --no-session keeps these probes out of task files.
    for model in models {
        info_call(stdin, lines, "set-model", json!({"type": "set_model", "provider": model.get("provider"), "modelId": model.get("id")})).await?;
        let state = info_call(stdin, lines, "state", json!({"type": "get_state"})).await?;
        let levels = info_call(stdin, lines, "levels", json!({"type": "get_available_thinking_levels"})).await?;
        options.push(model_option(model, None, levels["levels"].clone(), state.get("thinkingLevel").and_then(Value::as_str))?);
    }
    Ok(options)
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
    let mut lines = AsyncBufReader::new(stdout).lines();
    let models = tokio::time::timeout(INFO_TIMEOUT, read_model_options(&mut stdin, &mut lines)).await
        .map_err(|_| "Pi 读取模型信息超过 20 秒".to_owned())??;
    drop(stdin);
    Ok(CliInfo { models, usage: None })
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
            match inner.get("stopReason").and_then(Value::as_str) {
                Some("error") => state.error = Some(inner.get("errorMessage").and_then(Value::as_str).unwrap_or("Pi reported a failure").to_owned()),
                Some("stop" | "toolUse" | "length") => state.error = None,
                _ => {}
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
            let text = questions::result_text(value.get("result").unwrap_or(&Value::Null), value.get("toolName").and_then(Value::as_str));
            vec![TurnEvent::ToolResult {
                tool_use_id: value.get("toolCallId").and_then(Value::as_str).unwrap_or_default().to_owned(),
                text: clip(&text).0,
                is_error: value.get("isError").and_then(Value::as_bool).unwrap_or(false),
            }]
        }
        _ => Vec::new(),
    }
}

/// The known pi-ask-user RPC entry; presentation translates it while wire values stay native.
const ASK_USER_CUSTOM_OPTION: &str = "✏️ Type custom response...";
const CUSTOM_ANSWER_COMMAND: &str = "tandem_custom_answer";

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
            let native_options: Vec<&str> = value.get("options").and_then(Value::as_array)
                .map(|options| options.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
            let custom = method == "select" && native_options.contains(&ASK_USER_CUSTOM_OPTION);
            let options: Vec<Value> = native_options.into_iter().filter(|label| !custom || *label != ASK_USER_CUSTOM_OPTION)
                .map(|label| json!({"label": label})).collect();
            let mut question = json!({"question": title, "header": "", "options": options, "allowCustom": method != "select" || custom});
            // pi-ask-user joins the question and its background for the native RPC dialog.
            if let Some((main, context)) = title.split_once("\n\nContext:\n")
                .filter(|(main, context)| !main.trim().is_empty() && !context.trim().is_empty())
            {
                question["displayQuestion"] = json!(main);
                question["context"] = json!(context);
            }
            Some((
                id.clone(),
                TurnEvent::Question { request_id: id, questions: json!([question]) },
                PendingRequest::for_pi(QUESTION_TOOL, json!({"question": title, "customOption": custom}), method),
            ))
        }
        _ => None,
    }
}

pub fn ui_reply(id: &str, request: &PendingRequest, method: &str, decision: &Decision) -> Result<String, String> {
    let reply = match (method, decision) {
        (_, Decision::Deny) => json!({"type": "extension_ui_response", "id": id, "cancelled": true}),
        ("confirm", Decision::Allow) => json!({"type": "extension_ui_response", "id": id, "confirmed": true}),
        ("select", Decision::Answer { answers, custom: true, .. }) => {
            if request.input.get("customOption").and_then(Value::as_bool) != Some(true) {
                return Err("当前选项没有自定义回答入口".into());
            }
            let question = request.input.get("question").and_then(Value::as_str).unwrap_or_default();
            let answer = answers.get(question).and_then(Value::as_str).filter(|answer| !answer.trim().is_empty()).ok_or("请填写自定义回答")?;
            // The runner sends select -> input only after the user submits the local draft.
            json!({"type": CUSTOM_ANSWER_COMMAND, "id": id, "question": question, "answer": answer})
        }
        (_, Decision::Answer { answers, comment, .. }) if request.input.get("allowComment").and_then(Value::as_bool) == Some(true) => {
            let question = request.input.get("question").and_then(Value::as_str).unwrap_or_default();
            let answer = answers.get(question).and_then(Value::as_str).filter(|answer| !answer.trim().is_empty()).ok_or("请选择回答")?;
            json!({"type":questions::SELECTION_COMMAND, "id":id, "question":question, "prompt":request.input.get("prompt"), "multiSelect":request.input.get("multiSelect"), "answer":answer, "comment":comment.as_deref().unwrap_or_default()})
        }
        (_, Decision::Answer { answers, .. }) => {
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

/// Pi's RPC `steer`: delivered to the running agent after its current step. The id carries the
/// prompt back if Pi refuses it.
pub fn steer_line(prompt: &str, attachments: &Prepared) -> String {
    let mut command: Value = serde_json::from_str(&prompt_line(prompt, attachments)).unwrap_or_default();
    command["type"] = json!("steer");
    command["id"] = json!(format!("{STEER_ID_PREFIX}{}", serde_json::to_string(prompt).unwrap_or_default()));
    command.to_string()
}
const STEER_ID_PREFIX: &str = "steer:";

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
    if request.task_id.is_some() && !request.options.ignore_external_writer {
        let sessions = sessions_dir()?;
        let writers = tauri::async_runtime::spawn_blocking(move || crate::writers::read_pi_writers(&sessions)).await.map_err(|error| error.to_string())?;
        if writers.iter().any(|writer| writer.task_id == task_id && !runs.owns_writer(writer)) {
            return Err(crate::runner::EXTERNAL_WRITER_ERROR.into());
        }
    }
    let channels = runs.begin(&task_id)?;
    let result = async {
        emit(TurnEvent::Started { task_id: task_id.clone() })?;
        run_turn(runs, &task_id, &cwd, &session_args, &request, channels, &on_event).await
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
    sink: &TurnSink,
) -> Result<(), String> {
    let emit = |event| sink.send(event);
    let RunChannels { mut cancel, mut input, steer } = channels;
    let env = login_env::login_env().await;
    let program = login_env::find_in_path("pi", env.get("PATH")).ok_or("pi was not found in the login shell PATH")?;
    let mut args: Vec<String> = vec!["--mode".to_owned(), "rpc".to_owned()];
    if request.options.ephemeral {
        args.extend([
            "--no-session", "--no-tools", "--no-extensions", "--no-skills", "--no-prompt-templates",
            "--system-prompt", crate::titles::SYSTEM_PROMPT,
        ].map(str::to_owned));
    } else {
        args.extend_from_slice(session_args);
    }
    if let Some(model) = &request.options.model {
        args.extend(["--model".to_owned(), model.clone()]);
    }
    if let Some(effort) = &request.options.effort {
        args.extend(["--thinking".to_owned(), effort.clone()]);
    }
    crate::diagnostics::debug("pi", || format!("starting {} {}", program.display(), crate::diagnostics::flag_names(&args)));
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
    crate::diagnostics::debug("pi", || format!("pid {}", child.id().unwrap_or_default()));
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
    let mut dialogs = DialogReplies::default();
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
                if let Some((id, result)) = crate::titles::name_response(crate::titles::NameProtocol::Pi, &value) {
                    runs.settle_metadata(task_id, &id, result);
                    continue;
                }
                match value.get("type").and_then(Value::as_str) {
                    Some("response") if value.get("id").and_then(Value::as_str).is_some_and(|id| id.starts_with(STEER_ID_PREFIX)) => {
                        steer.confirm_one();
                        if value.get("success").and_then(Value::as_bool) == Some(false) {
                            let prompt = value.get("id").and_then(Value::as_str).and_then(|id| serde_json::from_str(&id[STEER_ID_PREFIX.len()..]).ok()).unwrap_or_default();
                            emit(TurnEvent::SteerRefused { prompt })?;
                        }
                    }
                    Some("response") => {
                        let is_prompt = value.get("id").and_then(Value::as_str) == Some("prompt");
                        if is_prompt && value.get("success").and_then(Value::as_bool) == Some(false) {
                            return Err(value.get("error").and_then(Value::as_str).unwrap_or("pi refused the prompt").to_owned());
                        }
                        if is_prompt && value.get("success").and_then(Value::as_bool) == Some(true) {
                            sink.accepted(task_id).await?;
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
                        if let Some(reply) = dialogs.follow_up(&value) {
                            stdin.write_all(format!("{reply}\n").as_bytes()).await.map_err(|error| error.to_string())?;
                            continue;
                        }
                        if let Some((id, event, pending)) = dialogs.present(&value) {
                            runs.add_pending_request(task_id, id, pending);
                            emit(event)?;
                        }
                    }
                    Some("agent_settled") => {
                        steer.close();
                        let aborted = value.get("aborted").and_then(Value::as_bool).unwrap_or(false);
                        finished = Some(TurnEvent::Finished {
                            is_error: state.error.is_some() && !aborted,
                            cancelled: aborted,
                            message: state.error.take().filter(|_| !aborted),
                        });
                    }
                    _ => {
                        let ask_start = value.get("type").and_then(Value::as_str) == Some("tool_execution_start") && value.get("toolName").and_then(Value::as_str) == Some("ask_user");
                        let default_comment = if ask_start { questions::comment_default(env).await } else { false };
                        dialogs.observe(&value, default_comment);
                        let assistant_message = value.pointer("/message/role").and_then(Value::as_str) == Some("assistant");
                        if assistant_message && value.get("type").and_then(Value::as_str) == Some("message_start") {
                            sink.generation_request()?;
                        }
                        if assistant_message && value.get("type").and_then(Value::as_str) == Some("message_end") {
                            sink.generation_reasoning_output(value.pointer("/message/usage/reasoning").and_then(Value::as_u64))?;
                            sink.generation_pause()?;
                            if let Some(content) = value.pointer("/message/content").and_then(Value::as_array) {
                                for block in content.iter().filter(|block| block.get("type").and_then(Value::as_str) == Some("toolCall")) {
                                    if let Some(input) = block.get("arguments") { sink.generation_tool_input(&input.to_string())?; }
                                }
                            }
                        }
                        if value.get("type").and_then(Value::as_str) == Some("message_update") {
                            match value.pointer("/assistantMessageEvent/type").and_then(Value::as_str) {
                                Some("text_start" | "thinking_start" | "toolcall_start") => sink.generation_start()?,
                                Some("toolcall_delta") => sink.generation_tool_delta(value.pointer("/assistantMessageEvent/delta").and_then(Value::as_str).unwrap_or_default())?,
                                _ => {}
                            }
                        }
                        for event in stream_events(&value, &mut state) {
                            emit(event)?;
                        }
                    }
                }
            }
            Some(reply) = input.recv() => {
                let reply = dialogs.outbound(&reply)?;
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
    match tokio::time::timeout(EXIT_TIMEOUT, child.wait()).await {
        Ok(status) => crate::diagnostics::debug("pi", || format!("exited ({})", status.map_or_else(|error| error.to_string(), |status| status.to_string()))),
        Err(_) => {
            crate::diagnostics::debug("pi", || "did not exit in time, killed".to_owned());
            let _ = child.kill().await;
        }
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
    fn terminal_reply_errors_survive_history_reading_but_successful_retries_clear_them() {
        for recovered in [false, true] {
            let mut lines = vec![
                json!({"type":"session", "cwd":"/code/app"}),
                json!({"type":"message", "id":"u", "parentId":null, "message":{"role":"user", "content":"first"}}),
                json!({"type":"message", "id":"e", "parentId":"u", "message":{"role":"assistant", "content":[], "stopReason":"error", "errorMessage":"provider rejected the request"}}),
            ];
            if recovered {
                lines.push(json!({"type":"message", "id":"a", "parentId":"e", "message":{"role":"assistant", "stopReason":"stop", "content":[{"type":"text", "text":"recovered"}]}}));
            } else {
                lines.push(json!({"type":"message", "id":"next", "parentId":"e", "message":{"role":"user", "content":"try again"}}));
            }
            let (_dir, path) = session(&lines);
            let messages = read_task(&path).unwrap().messages;
            let errors: Vec<_> = messages.iter().filter(|message| message.kind == MessageKind::Assistant && message.is_error).collect();
            assert_eq!(errors.len(), usize::from(!recovered));
            if !recovered {
                assert_eq!(messages[1].text, "provider rejected the request");
                assert_eq!(messages[2].text, "try again");
            }
        }
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
    fn restores_model_and_thinking_from_the_active_branch_including_changes_after_a_reply() {
        let lines = vec![
            json!({"type":"session", "id":"root", "cwd":"/code/app"}),
            json!({"type":"model_change", "id":"m1", "parentId":null, "provider":"p", "modelId":"a"}),
            json!({"type":"thinking_level_change", "id":"e1", "parentId":"m1", "thinkingLevel":"high"}),
            json!({"type":"message", "id":"u", "parentId":"e1", "message":{"role":"user", "content":"hi"}}),
            json!({"type":"message", "id":"a", "parentId":"u", "message":{"role":"assistant", "provider":"p", "model":"a", "content":[]}}),
            json!({"type":"model_change", "id":"abandoned", "parentId":"a", "provider":"p", "modelId":"wrong"}),
            json!({"type":"model_change", "id":"m2", "parentId":"a", "provider":"p", "modelId":"b"}),
            json!({"type":"thinking_level_change", "id":"e2", "parentId":"m2", "thinkingLevel":"off"}),
        ];
        let (_dir, path) = session(&lines);
        let content = read_task(&path).unwrap();
        assert_eq!(content.model_selection, Some(crate::sessions::TaskModel { model:"p/b".into(), effort:Some("off".into()) }));
    }

    #[test]
    fn recovers_the_pi_model_from_assistant_metadata_when_change_entries_are_missing() {
        let lines = [
            json!({"type":"session", "cwd":"/code/app"}),
            json!({"type":"message", "id":"a", "parentId":null, "message":{"role":"assistant", "provider":"p", "model":"a", "content":[]}}),
        ];
        let (_dir, path) = session(&lines);
        assert_eq!(read_task(&path).unwrap().model_selection, Some(crate::sessions::TaskModel { model:"p/a".into(), effort:None }));
    }

    #[test]
    fn image_coordinates_stay_out_of_visible_user_text_without_removing_the_image() {
        let note = "[Image: original 2072x586, displayed at 2000x566. Multiply coordinates by 1.04 to map to original image.]";
        let inner = json!({"role":"user", "content":[
            {"type":"text", "text":format!("请看图片\n\n{note}")},
            {"type":"image", "mimeType":"image/png", "data":"AA"},
        ]});
        let messages = user_messages(&inner, "user", None);
        assert_eq!(messages.len(), 2);
        assert!(messages[0].image.is_some());
        assert_eq!(messages[1].text, "请看图片");
        assert_eq!(user_text(&inner).as_deref(), Some("请看图片"));
        let literal = json!({"content":[{"type":"text","text":note}]});
        assert_eq!(user_message_text(&literal), note);
        let quoted = json!({"content":[{"type":"text","text":format!("说明如下：\n{note}\n这是原文")},{"type":"image"}]});
        assert!(user_message_text(&quoted).contains(note));
        let multiple = json!({"content":[{"type":"text","text":format!("原文\n\n{note}\n{note}")},{"type":"image"}]});
        assert_eq!(user_message_text(&multiple), "原文");
        let original = "Windows 粘贴\r\n保留原始换行  \n\n";
        let spaced = json!({"content":[{"type":"text","text":format!("{original}\n\n{note}")},{"type":"image"}]});
        assert_eq!(user_message_text(&spaced), original);
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
    fn a_saved_name_survives_a_long_follow_up_and_a_fresh_task_list() {
        let mut lines = sample();
        lines.push(json!({"type":"session_info", "name":"Earlier title"}));
        lines.push(json!({"type":"session_info", "name":"调整消息对齐并添加时间显示"}));
        lines.push(json!({"type":"message", "message":{"role":"assistant", "content":[{"type":"text", "text":"x".repeat(512 * 1024)}]}}));
        let (dir, _path) = session(&lines);
        for _ in 0..2 {
            let tasks = list_tasks(dir.path(), &["/code/app".to_owned()]);
            assert_eq!(tasks[0].title, "调整消息对齐并添加时间显示");
        }
    }

    #[test]
    fn clearing_a_saved_name_uses_the_first_prompt_instead_of_an_older_name() {
        let mut lines = sample();
        lines.push(json!({"type":"session_info", "name":"Earlier title"}));
        lines.push(json!({"type":"session_info", "name":"   "}));
        let (dir, _path) = session(&lines);
        assert_eq!(list_tasks(dir.path(), &["/code/app".to_owned()])[0].title, "fix it");
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
    fn a_successful_retry_clears_the_previous_pi_request_error() {
        for reason in ["stop", "toolUse", "length"] {
            let mut state = TurnState::default();
            let failed = json!({"type":"message_end", "message":{"role":"assistant", "stopReason":"error", "errorMessage":"input_image image_url must be valid base64"}});
            stream_events(&failed, &mut state);
            assert!(state.error.is_some());
            let retry = json!({"type":"message_end", "message":{"role":"assistant", "stopReason":reason, "usage":{"output":5}}});
            stream_events(&retry, &mut state);
            assert_eq!(state.error, None, "successful retry ended with {reason}");
            assert_eq!(state.output_tokens, 5);
        }
    }

    #[test]
    fn pi_keeps_the_latest_terminal_failure_until_a_request_succeeds() {
        let mut state = TurnState::default();
        for error in ["first failure", "last failure"] {
            stream_events(&json!({"type":"message_end", "message":{"role":"assistant", "stopReason":"error", "errorMessage":error}}), &mut state);
        }
        stream_events(&json!({"type":"tool_execution_end", "toolCallId":"t", "result":{"content":[]}}), &mut state);
        assert_eq!(state.error.as_deref(), Some("last failure"));
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
        let (id, event, pending) = ui_request(&select).unwrap();
        let TurnEvent::Question { questions, .. } = event else { panic!("Expected select question"); };
        assert_eq!(questions[0]["allowCustom"], false);
        assert_eq!(questions[0]["options"].as_array().unwrap().len(), 2);
        let mut answers = serde_json::Map::new();
        answers.insert("Pick".to_owned(), json!("B"));
        let reply: Value = serde_json::from_str(&ui_reply(&id, &pending, "select", &Decision::Answer { answers, custom: false, comment: None }).unwrap()).unwrap();
        assert_eq!(reply["value"], "B");

        for method in ["input", "editor"] {
            let (id, event, pending) = ui_request(&json!({"id": "text", "method": method, "title": "Your answer"})).unwrap();
            let TurnEvent::Question { questions, .. } = event else { panic!("Expected text question"); };
            assert_eq!(questions[0]["allowCustom"], true);
            assert!(questions[0]["options"].as_array().unwrap().is_empty());
            let answers = json!({"Your answer": "我的自定义回答"}).as_object().unwrap().clone();
            let reply: Value = serde_json::from_str(&ui_reply(&id, &pending, method, &Decision::Answer { answers, custom: true, comment: None }).unwrap()).unwrap();
            assert_eq!(reply["value"], "我的自定义回答");
        }
        let native_custom = "✏️ Type custom response...";
        let (id, event, pending) = ui_request(&json!({"id": "custom", "method": "select", "title": "Pick", "options": ["A", "B", native_custom]})).unwrap();
        let TurnEvent::Question { questions, .. } = event else { panic!("Expected select question"); };
        assert_eq!(questions[0]["options"].as_array().unwrap().len(), 2);
        assert_eq!(questions[0]["allowCustom"], true);
        let answers = json!({"Pick": "B"}).as_object().unwrap().clone();
        let reply: Value = serde_json::from_str(&ui_reply(&id, &pending, "select", &Decision::Answer { answers, custom: false, comment: None }).unwrap()).unwrap();
        assert_eq!(reply["value"], "B");

        assert!(ui_request(&json!({"id": "3", "method": "setStatus"})).is_none());
    }

    #[test]
    fn pi_context_presentation_keeps_the_native_question_and_reply_keys() {
        let title = "选择下一步？\n\nContext:\n当前改动已保存。\n接下来选择验证范围。";
        for method in ["select", "input", "editor"] {
            let (id, event, pending) = ui_request(&json!({"id":"context", "method":method, "title":title, "options":["继续", ASK_USER_CUSTOM_OPTION]})).unwrap();
            let TurnEvent::Question { questions, .. } = event else { panic!("Expected a question"); };
            assert_eq!(questions[0]["question"], title);
            assert_eq!(questions[0]["displayQuestion"], "选择下一步？");
            assert_eq!(questions[0]["context"], "当前改动已保存。\n接下来选择验证范围。");
            assert_eq!(pending.input["question"], title);
            let answers = [(title.to_owned(), json!("继续"))].into_iter().collect();
            let reply: Value = serde_json::from_str(&ui_reply(&id, &pending, method, &Decision::Answer { answers, custom: false, comment: None }).unwrap()).unwrap();
            assert_eq!(reply["value"], "继续");
            if method == "select" {
                let answers = [(title.to_owned(), json!("自定义下一步"))].into_iter().collect();
                let command = ui_reply(&id, &pending, method, &Decision::Answer { answers, custom: true, comment: None }).unwrap();
                let mut dialogs = DialogReplies::default();
                dialogs.outbound(&command).unwrap();
                let follow_up = dialogs.follow_up(&json!({"id":"input", "method":"input", "title":title, "placeholder":"Type your answer..."})).unwrap();
                assert_eq!(serde_json::from_str::<Value>(&follow_up).unwrap()["value"], "自定义下一步");
            }
        }
    }

    #[test]
    fn ordinary_question_text_and_empty_context_keep_their_native_presentation() {
        for title in ["解释 Context: 的含义", "Context:\n这是问题正文", "问题\n\nContext:\n  ", "\n\nContext:\n只有背景"] {
            let (_, event, _) = ui_request(&json!({"id":"plain", "method":"input", "title":title})).unwrap();
            let TurnEvent::Question { questions, .. } = event else { panic!("Expected a question"); };
            assert_eq!(questions[0]["question"], title);
            assert!(questions[0].get("displayQuestion").is_none());
            assert!(questions[0].get("context").is_none());
        }
    }

    #[test]
    fn pi_custom_draft_submits_through_the_native_select_then_input_without_a_second_page() {
        let (_, event, pending) = ui_request(&json!({"id":"select", "method":"select", "title":"选一个", "options":["原选项", ASK_USER_CUSTOM_OPTION]})).unwrap();
        let TurnEvent::Question { questions, .. } = event else { panic!("Expected a question"); };
        assert_eq!(questions[0]["options"], json!([{"label":"原选项"}]));
        assert_eq!(questions[0]["allowCustom"], true);
        let answers = json!({"选一个":"我的中文回答"}).as_object().unwrap().clone();
        let command = ui_reply("select", &pending, "select", &Decision::Answer { answers, custom: true, comment: None }).unwrap();
        let mut dialogs = DialogReplies::default();
        let sent: Value = serde_json::from_str(&dialogs.outbound(&command).unwrap()).unwrap();
        assert_eq!(sent, json!({"type":"extension_ui_response", "id":"select", "value":ASK_USER_CUSTOM_OPTION}));
        assert!(dialogs.follow_up(&json!({"id":"other", "method":"input", "title":"其他问题", "placeholder":"Type your answer..."})).is_none());
        assert!(dialogs.follow_up(&json!({"id":"comment", "method":"input", "title":"选一个", "placeholder":"Optional comment (press Enter to skip)..."})).is_none());
        let input = json!({"id":"input", "method":"input", "title":"选一个", "placeholder":"Type your answer..."});
        let reply: Value = serde_json::from_str(&dialogs.follow_up(&input).unwrap()).unwrap();
        assert_eq!(reply, json!({"type":"extension_ui_response", "id":"input", "value":"我的中文回答"}));
        assert!(dialogs.follow_up(&input).is_none());
    }

    #[test]
    fn ordinary_selects_and_cancelled_drafts_keep_their_native_values() {
        let (_, _, pending) = ui_request(&json!({"id":"select", "method":"select", "title":"选择", "options":["A", "B"]})).unwrap();
        let answers = json!({"选择":"自定义"}).as_object().unwrap().clone();
        assert!(ui_reply("select", &pending, "select", &Decision::Answer { answers, custom: true, comment: None }).is_err());
        let mut dialogs = DialogReplies::default();
        let cancel = ui_reply("select", &pending, "select", &Decision::Deny).unwrap();
        let wire: Value = serde_json::from_str(&dialogs.outbound(&cancel).unwrap()).unwrap();
        assert_eq!(wire["cancelled"], true);
        assert!(dialogs.custom.is_empty());
    }

    #[test]
    fn uses_pi_capabilities_including_off_and_keeps_fixed_models_without_a_slider() {
        let model = json!({"provider": "p", "id": "m", "name": "Model", "reasoning": true});
        let option = model_option(&model, Some(DEFAULT_MODEL), json!(["off", "low", "high", "max"]), Some("high")).unwrap();
        assert_eq!(option.value, "default");
        assert_eq!(option.resolved_model, "p/m");
        assert_eq!(option.supported_effort_levels, ["off", "low", "high", "max"]);
        assert_eq!(option.default_effort.as_deref(), Some("high"));
        let plain = json!({"provider": "p", "id": "n", "reasoning": false});
        let plain = model_option(&plain, None, json!(["off"]), Some("off")).unwrap();
        assert!(!plain.supports_effort);
        assert!(plain.supported_effort_levels.is_empty());
    }

    #[test]
    fn reads_each_models_own_defaults_and_available_levels_without_a_prompt() {
        tauri::async_runtime::block_on(async {
            let (client, server) = tokio::io::duplex(8192);
            let (read, mut input) = tokio::io::split(client);
            let mut lines = AsyncBufReader::new(read).lines();
            let model_a = json!({"provider":"p", "id":"a", "reasoning":true});
            let model_b = json!({"provider":"p", "id":"b", "reasoning":true});
            let mock = tokio::spawn(async move {
                let (read, mut output) = tokio::io::split(server);
                let mut lines = AsyncBufReader::new(read).lines();
                let mut current = model_b.clone();
                let mut methods = Vec::new();
                while let Some(line) = lines.next_line().await.unwrap() {
                    let request: Value = serde_json::from_str(&line).unwrap();
                    let method = request["type"].as_str().unwrap();
                    methods.push(method.to_owned());
                    let is_a = current["id"] == "a";
                    let data = match method {
                        "get_available_models" => json!({"models":[model_a, model_b]}),
                        "get_state" => json!({"model":current,"thinkingLevel":if is_a {"low"} else {"max"}}),
                        "get_available_thinking_levels" => json!({"levels":if is_a {vec!["off","low","high"]} else {vec!["medium","high","max"]}}),
                        "set_model" => { current = if request["modelId"] == "a" {model_a.clone()} else {model_b.clone()}; current.clone() },
                        other => panic!("metadata probe sent {other}"),
                    };
                    let response = json!({"id":request["id"],"type":"response","command":method,"success":true,"data":data});
                    output.write_all(format!("{response}\n").as_bytes()).await.unwrap();
                }
                methods
            });
            let options = read_model_options(&mut input, &mut lines).await.unwrap();
            assert_eq!(options.iter().map(|option| option.value.as_str()).collect::<Vec<_>>(), ["default","p/a","p/b"]);
            assert_eq!(options[0].default_effort.as_deref(), Some("max"));
            assert_eq!(options[1].default_effort.as_deref(), Some("low"));
            assert_eq!(options[1].supported_effort_levels, ["off","low","high"]);
            assert_eq!(options[2].default_effort.as_deref(), Some("max"));
            assert_eq!(options[2].supported_effort_levels, ["medium","high","max"]);
            drop(input); drop(lines);
            assert_eq!(mock.await.unwrap().iter().filter(|method| method.as_str() == "set_model").count(), 2);
        });
    }

    #[test]
    fn metadata_errors_reach_the_page() {
        tauri::async_runtime::block_on(async {
            let mut input = tokio::io::sink();
            let mut lines = AsyncBufReader::new(b"{\"type\":\"response\",\"id\":\"models\",\"success\":false,\"error\":\"invalid provider configuration\"}\n".as_slice()).lines();
            let error = read_model_options(&mut input, &mut lines).await.unwrap_err();
            assert_eq!(error, "invalid provider configuration");
        });
    }
}

//! Read-only access to Claude Code's native session files. Tandem keeps no copy of task content.

use serde::{Deserialize, Serialize};
use serde_json::{value::RawValue, Value};
use crate::attachments::ATTACHED_FILE_PREFIX;
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

const MAX_TASKS: usize = 300;
/// Claude records a stopped turn as a user message starting with this.
const INTERRUPTION_PREFIX: &str = "[Request interrupted by user";
const MAX_TEXT_BYTES: usize = 20 * 1024;
/// A 5 MB image, the most the API takes, is about this long as base64.
const MAX_IMAGE_DATA_BYTES: usize = 7 * 1024 * 1024;
const MAX_INPUT_BYTES: usize = 4 * 1024;
const MAX_TITLE_CHARS: usize = 80;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummary {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub updated_at_ms: u64,
    pub agent: Agent,
    /// Native list state is provided by Codex; other CLIs use Tandem view metadata.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archived: Option<bool>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum Agent {
    #[default]
    Claude,
    Codex,
    Pi,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MessageKind {
    User,
    Assistant,
    Thinking,
    ToolUse,
    ToolResult,
    /// The CLI summarised the conversation so far. The text the CLI wrote is for the model.
    Compaction,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub kind: MessageKind,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
    pub is_error: bool,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    /// A data URL for an image the user sent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_error: Option<String>,
}

/// What the context ring needs: the tokens the last request carried, and for which model.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskContext {
    pub used_tokens: u64,
    pub model: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct TaskModel {
    pub model: String,
    pub effort: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskContent {
    pub messages: Vec<Message>,
    pub context: Option<TaskContext>,
    pub model_selection: Option<TaskModel>,
    /// The permission mode the CLI last ran this task in; Claude records it on each prompt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Line {
    #[serde(rename = "type")]
    kind: Option<String>,
    uuid: Option<String>,
    parent_uuid: Option<String>,
    logical_parent_uuid: Option<String>,
    #[serde(default)]
    is_sidechain: bool,
    #[serde(default)]
    is_meta: bool,
    #[serde(default)]
    is_compact_summary: bool,
    #[serde(default)]
    is_api_error_message: bool,
    timestamp: Option<String>,
    message: Option<Box<RawValue>>,
    attachment: Option<Box<RawValue>>,
    permission_mode: Option<String>,
}

struct Entry {
    uuid: String,
    is_user: bool,
    is_meta: bool,
    is_compact_summary: bool,
    is_api_error_message: bool,
    timestamp: Option<String>,
    message: Box<RawValue>,
    permission_mode: Option<String>,
}

#[derive(Deserialize)]
struct RawMessage {
    id: Option<String>,
    content: Option<Value>,
}

#[derive(Deserialize)]
struct RawUsage {
    model: Option<String>,
    usage: Option<Value>,
}

/// A request's size in the context window. Output tokens are not part of it yet.
pub fn context_tokens(usage: &Value) -> Option<u64> {
    let tokens: Vec<u64> = ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"]
        .iter()
        .filter_map(|key| usage.get(*key).and_then(Value::as_u64))
        .collect();
    (!tokens.is_empty()).then(|| tokens.iter().sum())
}

pub fn claude_projects_dir() -> Result<PathBuf, String> {
    let config = match std::env::var_os("CLAUDE_CONFIG_DIR") {
        Some(dir) => PathBuf::from(dir),
        None => PathBuf::from(std::env::var_os("HOME").ok_or("HOME is not set")?).join(".claude"),
    };
    Ok(config.join("projects"))
}

/// Whether a working directory is a root or anywhere inside it.
pub fn is_under(cwd: &str, root: &str) -> bool {
    let root = root.trim_end_matches('/');
    cwd == root || cwd.strip_prefix(root).is_some_and(|rest| rest.starts_with('/'))
}

fn session_files(project: &Path) -> Vec<(u64, PathBuf)> {
    let Ok(entries) = std::fs::read_dir(project) else {
        return Vec::new();
    };
    let mut files: Vec<(u64, PathBuf)> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| is_session_file(path))
        .filter_map(|path| Some((modified_ms(&path)?, path)))
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0));
    files
}

/// Only opens files in folders that belong to `roots`, so unrelated projects cost nothing.
pub fn list_tasks(projects_dir: &Path, roots: &[String]) -> Result<Vec<TaskSummary>, String> {
    let projects = match std::fs::read_dir(projects_dir) {
        Ok(projects) => projects,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let belongs = |cwd: &str| roots.iter().any(|root| is_under(cwd, root));
    let mut files = Vec::new();
    for project in projects.flatten() {
        let project_files = session_files(&project.path());
        let project_cwd = project_files.iter().find_map(|(_, path)| read_task_cwd(path));
        if project_cwd.is_some_and(|cwd| belongs(&cwd)) {
            files.extend(project_files);
        }
    }
    files.sort_by(|a, b| b.0.cmp(&a.0));

    let mut tasks = Vec::new();
    for (updated_at_ms, path) in files {
        if tasks.len() == MAX_TASKS {
            break;
        }
        if let Some(task) = summarize(&path, updated_at_ms).filter(|task| belongs(&task.cwd)) {
            tasks.push(task);
        }
    }
    Ok(tasks)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredProject {
    pub cwd: String,
    pub last_active_ms: u64,
}

/// Folders Claude has run in, for the user to choose from. Reads one file from each.
pub fn discover_projects(projects_dir: &Path) -> Vec<DiscoveredProject> {
    let Ok(projects) = std::fs::read_dir(projects_dir) else {
        return Vec::new();
    };
    projects
        .flatten()
        .filter_map(|project| {
            let files = session_files(&project.path());
            let last_active_ms = files.first()?.0;
            let cwd = files.iter().find_map(|(_, path)| read_task_cwd(path))?;
            Some(DiscoveredProject { cwd, last_active_ms })
        })
        .collect()
}

/// Looks the id up on disk, so a caller cannot make Tandem read outside the projects directory.
pub fn find_task_file(projects_dir: &Path, id: &str) -> Result<PathBuf, String> {
    uuid::Uuid::parse_str(id).map_err(|_| format!("Invalid task id: {id}"))?;
    let file_name = format!("{id}.jsonl");
    let projects = std::fs::read_dir(projects_dir).map_err(|error| error.to_string())?;
    let mut matches: Vec<PathBuf> = projects
        .flatten()
        .map(|project| project.path().join(&file_name))
        .filter(|path| path.is_file())
        .collect();
    matches.sort_by_key(|path| std::cmp::Reverse(modified_ms(path)));
    matches
        .into_iter()
        .next()
        .ok_or_else(|| format!("Task not found: {id}"))
}

pub fn read_task_cwd(path: &Path) -> Option<String> {
    read_cwd_and_first_prompt(path).0
}

pub fn read_task(path: &Path) -> Result<TaskContent, String> {
    let (entries, parents) = read_entries(path)?;
    let included = active_branch(&entries, &parents);
    let mut messages = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        if included.contains(&index) {
            append_messages(entry, &mut messages);
        }
    }
    let context = entries
        .iter()
        .enumerate()
        .rev()
        .filter(|(index, entry)| !entry.is_user && included.contains(index))
        .find_map(|(_, entry)| {
            let raw: RawUsage = serde_json::from_str(entry.message.get()).ok()?;
            Some(TaskContext { used_tokens: context_tokens(&raw.usage?)?, model: raw.model })
        });
    let permission_mode = entries
        .iter()
        .enumerate()
        .rev()
        .filter(|(index, _)| included.contains(index))
        .find_map(|(_, entry)| entry.permission_mode.clone());
    let model_selection = entries.iter().enumerate().rev()
        .filter(|(index, entry)| !entry.is_user && !entry.is_meta && included.contains(index))
        .find_map(|(_, entry)| {
            let raw: RawUsage = serde_json::from_str(entry.message.get()).ok()?;
            let model = raw.model.filter(|model| !model.is_empty() && model != "<synthetic>")?;
            Some(TaskModel { model, effort: None })
        });
    Ok(TaskContent { messages: terminal_reply_errors(messages), context, model_selection, permission_mode })
}

/// A request recovered within the same turn leaves no terminal error; a new prompt keeps it.
pub fn terminal_reply_errors(messages: Vec<Message>) -> Vec<Message> {
    let mut pending = Vec::new();
    let mut recovered = HashSet::new();
    for (index, message) in messages.iter().enumerate() {
        match message.kind {
            MessageKind::User => pending.clear(),
            MessageKind::Assistant if message.is_error => {
                recovered.extend(pending.drain(..));
                pending.push(index);
            },
            MessageKind::Assistant | MessageKind::ToolUse => recovered.extend(pending.drain(..)),
            _ => {}
        }
    }
    messages.into_iter().enumerate().filter_map(|(index, message)| (!recovered.contains(&index)).then_some(message)).collect()
}

/// What `--resume-session-at` needs to replace the last prompt: the assistant message that
/// prompt followed, and the prompt itself, both on the active branch of the task's own file.
#[derive(Debug, PartialEq)]
pub struct EditAnchor {
    pub assistant: String,
    pub prompt: String,
}

pub fn edit_anchor(path: &Path, message_id: &str) -> Result<EditAnchor, String> {
    let (entries, parents) = read_entries(path)?;
    let included = active_branch(&entries, &parents);
    let mut assistant: Option<&str> = None;
    let mut last: Option<(&Entry, Option<&str>, Vec<Message>)> = None;
    for (index, entry) in entries.iter().enumerate() {
        if !included.contains(&index) || entry.is_meta {
            continue;
        }
        if entry.is_compact_summary {
            // Truncating to before a compaction would discard the summary as well.
            assistant = None;
            continue;
        }
        if !entry.is_user {
            assistant = Some(&entry.uuid);
            continue;
        }
        let mut messages = Vec::new();
        append_messages(entry, &mut messages);
        let is_prompt = messages.iter().any(|message| {
            message.kind == MessageKind::User && !message.text.starts_with(INTERRUPTION_PREFIX)
        });
        if is_prompt {
            last = Some((entry, assistant, messages));
        }
    }
    let (prompt, assistant, messages) = last.ok_or("这个任务还没有可以编辑的消息")?;
    if !messages.iter().any(|message| message.id == message_id) {
        return Err("只能编辑最后一条消息。任务已有新内容，请等它刷新后再试".into());
    }
    let assistant = assistant.ok_or("第一条消息或压缩后的第一条消息不能编辑")?;
    Ok(EditAnchor { assistant: assistant.to_owned(), prompt: prompt.uuid.clone() })
}

fn read_entries(path: &Path) -> Result<(Vec<Entry>, HashMap<String, String>), String> {
    let reader = BufReader::new(File::open(path).map_err(|error| error.to_string())?);
    let mut parents: HashMap<String, String> = HashMap::new();
    let mut entries = Vec::new();
    for line in reader.lines() {
        let line = line.map_err(|error| error.to_string())?;
        // Interrupted writes can leave a partial line. Other lines are still usable.
        let Ok(parsed) = serde_json::from_str::<Line>(&line) else {
            continue;
        };
        let Some(uuid) = parsed.uuid else { continue };
        if let Some(parent) = parsed.parent_uuid.or(parsed.logical_parent_uuid) {
            parents.insert(uuid.clone(), parent);
        }
        let kind = parsed.kind.as_deref();
        if !parsed.is_sidechain && kind == Some("attachment") {
            if let Some(message) = parsed.attachment.as_deref().and_then(queued_message) {
                entries.push(Entry {
                    uuid,
                    is_user: true,
                    is_meta: false,
                    is_compact_summary: false,
                    is_api_error_message: false,
                    timestamp: parsed.timestamp,
                    message,
                    permission_mode: None,
                });
            }
            continue;
        }
        if parsed.is_sidechain || !matches!(kind, Some("user" | "assistant")) {
            continue;
        }
        if let Some(message) = parsed.message {
            entries.push(Entry {
                uuid,
                is_user: kind == Some("user"),
                is_meta: parsed.is_meta,
                is_compact_summary: parsed.is_compact_summary,
                is_api_error_message: parsed.is_api_error_message,
                timestamp: parsed.timestamp,
                message,
                permission_mode: parsed.permission_mode,
            });
        }
    }
    Ok((entries, parents))
}

/// Rewinding leaves abandoned branches in the file, so messages are selected from the newest leaf
/// back through its parents. Parallel tool calls are written as siblings of that path: their other
/// content blocks share a message id, and their results point at the tool use.
fn active_branch(entries: &[Entry], parents: &HashMap<String, String>) -> HashSet<usize> {
    let Some(leaf) = entries.last() else {
        return HashSet::new();
    };
    let mut chain = HashSet::new();
    let mut current = Some(leaf.uuid.as_str());
    while let Some(uuid) = current {
        if !chain.insert(uuid) {
            break;
        }
        current = parents.get(uuid).map(String::as_str);
    }

    let raw: Vec<Option<RawMessage>> = entries
        .iter()
        .map(|entry| serde_json::from_str(entry.message.get()).ok())
        .collect();
    let mut included: HashSet<usize> = HashSet::new();
    let mut message_ids: HashSet<&str> = HashSet::new();
    for (index, entry) in entries.iter().enumerate() {
        if chain.contains(entry.uuid.as_str()) {
            included.insert(index);
            if let Some(id) = raw[index].as_ref().and_then(|message| message.id.as_deref()) {
                message_ids.insert(id);
            }
        }
    }
    let mut tool_uses: HashSet<&str> = HashSet::new();
    for (index, entry) in entries.iter().enumerate() {
        let Some(message) = raw[index].as_ref() else {
            continue;
        };
        let same_message = message
            .id
            .as_deref()
            .is_some_and(|id| message_ids.contains(id));
        if same_message {
            included.insert(index);
        }
        if !entry.is_user && included.contains(&index) {
            for block in blocks(message) {
                if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                    if let Some(id) = block.get("id").and_then(Value::as_str) {
                        tool_uses.insert(id);
                    }
                }
            }
        }
    }
    for (index, entry) in entries.iter().enumerate() {
        let Some(message) = raw[index].as_ref() else {
            continue;
        };
        if entry.is_user
            && blocks(message).iter().any(|block| {
                block
                    .get("tool_use_id")
                    .and_then(Value::as_str)
                    .is_some_and(|id| tool_uses.contains(id))
            })
        {
            included.insert(index);
        }
    }
    included
}

fn blocks(message: &RawMessage) -> &[Value] {
    message
        .content
        .as_ref()
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueuedCommand {
    #[serde(rename = "type")]
    kind: String,
    prompt: Option<Box<RawValue>>,
    #[serde(default)]
    human_turn: bool,
    origin: Option<Value>,
    command_mode: Option<String>,
    #[serde(default)]
    is_meta: bool,
}

/// What the user typed while a turn was running is recorded as an attachment, not a user line.
/// Programs queue commands the same way, and those are not the user's words.
fn queued_message(attachment: &RawValue) -> Option<Box<RawValue>> {
    let queued: QueuedCommand = serde_json::from_str(attachment.get()).ok()?;
    // The terminal marks typed messages `humanTurn`. A message written into a running print-mode
    // process, as Tandem adds one mid-turn, carries no origin at all; task notifications and peer
    // messages name their origin or are marked meta.
    let typed_mid_turn = queued.origin.is_none() && queued.command_mode.as_deref() == Some("prompt") && !queued.is_meta;
    if queued.kind != "queued_command" || !(queued.human_turn || typed_mid_turn) {
        return None;
    }
    let prompt = queued.prompt?;
    RawValue::from_string(format!(r#"{{"role":"user","content":{}}}"#, prompt.get())).ok()
}

fn append_messages(entry: &Entry, out: &mut Vec<Message>) {
    let Ok(message) = serde_json::from_str::<RawMessage>(entry.message.get()) else {
        return;
    };
    // `isMeta` lines are filtered here rather than while reading, so they still link the chain.
    if entry.is_meta {
        return;
    }
    if entry.is_compact_summary {
        out.push(text_message(entry, 0, MessageKind::Compaction, ""));
        return;
    }
    if let Some(text) = message.content.as_ref().and_then(Value::as_str) {
        if entry.is_user {
            if let Some(text) = visible_user_text(text) {
                out.push(text_message(entry, 0, MessageKind::User, &text));
            }
        } else {
            out.push(text_message(entry, 0, MessageKind::Assistant, text));
        }
        return;
    }
    for (index, block) in blocks(&message).iter().enumerate() {
        match block.get("type").and_then(Value::as_str) {
            Some("text") => {
                let text = block.get("text").and_then(Value::as_str).unwrap_or_default();
                if entry.is_user {
                    if let Some(text) = visible_user_text(text) {
                        out.push(text_message(entry, index, MessageKind::User, &text));
                    }
                } else if !text.trim().is_empty() {
                    out.push(text_message(entry, index, MessageKind::Assistant, text));
                }
            }
            Some("image") if entry.is_user => {
                if let Some(image) = image_data_url(block) {
                    out.push(Message {
                        image: Some(image),
                        ..text_message(entry, index, MessageKind::User, "")
                    });
                }
            }
            Some("thinking") => {
                let text = block
                    .get("thinking")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if !text.trim().is_empty() {
                    out.push(text_message(entry, index, MessageKind::Thinking, text));
                }
            }
            Some("tool_use") => {
                let (text, truncated) = tool_input_text(block.get("input"));
                out.push(Message {
                    id: message_id(entry, index),
                    kind: MessageKind::ToolUse,
                    text,
                    tool_name: block.get("name").and_then(Value::as_str).map(str::to_owned),
                    tool_use_id: block.get("id").and_then(Value::as_str).map(str::to_owned),
                    is_error: false,
                    truncated,
                    timestamp: entry.timestamp.clone(),
                    image: None, image_error: None,
                });
            }
            Some("tool_result") => {
                let content = tool_result_text(block.get("content"));
                let (text, truncated) = clip(&content, MAX_TEXT_BYTES);
                out.push(Message {
                    id: message_id(entry, index),
                    kind: MessageKind::ToolResult,
                    text,
                    tool_name: None,
                    tool_use_id: block
                        .get("tool_use_id")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    is_error: block
                        .get("is_error")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    truncated,
                    timestamp: entry.timestamp.clone(),
                    image: None, image_error: None,
                });
            }
            _ => {}
        }
    }
}

/// Task files can come from anywhere, so only plain image types reach the page.
fn image_data_url(block: &Value) -> Option<String> {
    let source = block.get("source")?;
    let media_type = source.get("media_type")?.as_str()?;
    let data = source.get("data")?.as_str()?;
    if source.get("type")?.as_str()? != "base64"
        || !crate::attachments::is_inline_media_type(media_type)
        || data.len() > MAX_IMAGE_DATA_BYTES
    {
        return None;
    }
    Some(format!("data:{media_type};base64,{data}"))
}

fn message_id(entry: &Entry, block: usize) -> String {
    format!("{}:{block}", entry.uuid)
}

fn text_message(entry: &Entry, block: usize, kind: MessageKind, text: &str) -> Message {
    let (text, truncated) = clip(text, MAX_TEXT_BYTES * 10);
    Message {
        id: message_id(entry, block),
        kind,
        text,
        tool_name: None,
        tool_use_id: None,
        is_error: kind == MessageKind::Assistant && entry.is_api_error_message,
        truncated,
        timestamp: entry.timestamp.clone(),
        image: None, image_error: None,
    }
}

/// Clips each string value rather than the whole text, so the page can still parse the input.
pub fn tool_input_text(input: Option<&Value>) -> (String, bool) {
    let Some(input) = input else {
        return (String::new(), false);
    };
    let mut clipped = input.clone();
    let truncated = clip_strings(&mut clipped);
    (serde_json::to_string_pretty(&clipped).unwrap_or_default(), truncated)
}

fn clip_strings(value: &mut Value) -> bool {
    match value {
        Value::String(text) => {
            let (short, truncated) = clip(text, MAX_INPUT_BYTES);
            *text = short;
            truncated
        }
        Value::Array(items) => items.iter_mut().fold(false, |any, item| clip_strings(item) | any),
        Value::Object(map) => map.values_mut().fold(false, |any, item| clip_strings(item) | any),
        _ => false,
    }
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

/// Hides CLI bookkeeping that is stored as user text, and shows slash commands by name.
/// The terminal marks pasted images as `[Image #3]` in the text. The page shows the image itself.
fn without_image_tags(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("[Image #") {
        let after = &rest[start + "[Image #".len()..];
        let digits = after.chars().take_while(char::is_ascii_digit).count();
        if digits == 0 || !after[digits..].starts_with(']') {
            result.push_str(&rest[..start + 1]);
            rest = &rest[start + 1..];
            continue;
        }
        result.push_str(&rest[..start]);
        rest = after[digits + 1..].strip_prefix(' ').unwrap_or(&after[digits + 1..]);
    }
    result.push_str(rest);
    result
}

fn visible_user_text(text: &str) -> Option<String> {
    let cleaned = without_image_tags(text);
    let text = cleaned.as_str();
    let trimmed = text.trim();
    if trimmed.is_empty()
        || trimmed.starts_with("<local-command-")
        || trimmed.starts_with("<system-reminder>")
        || trimmed.starts_with("<task-notification>")
    {
        return None;
    }
    if let Some(name) = between(trimmed, "<command-name>", "</command-name>") {
        // The compaction it asks for already shows as a divider.
        if name == "/compact" {
            return None;
        }
        let args = between(trimmed, "<command-args>", "</command-args>").unwrap_or_default();
        return Some(format!("{name} {args}").trim().to_owned());
    }
    Some(text.to_owned())
}

fn between<'a>(text: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let (_, rest) = text.split_once(start)?;
    Some(rest.split_once(end)?.0)
}

fn clip(text: &str, max_bytes: usize) -> (String, bool) {
    if text.len() <= max_bytes {
        return (text.to_owned(), false);
    }
    let mut end = max_bytes;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (text[..end].to_owned(), true)
}

fn is_session_file(path: &Path) -> bool {
    path.extension().is_some_and(|ext| ext == "jsonl")
        && path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .is_some_and(|stem| uuid::Uuid::parse_str(stem).is_ok())
}

fn modified_ms(path: &Path) -> Option<u64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    Some(modified.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64)
}

fn summarize(path: &Path, updated_at_ms: u64) -> Option<TaskSummary> {
    let (cwd, first_prompt) = read_cwd_and_first_prompt(path);
    let cwd = cwd?;
    let title = crate::session_titles::claude(path)
        .or(first_prompt)
        .unwrap_or_default();
    Some(TaskSummary {
        id: path.file_stem()?.to_str()?.to_owned(),
        title: shorten(&title),
        cwd,
        updated_at_ms,
        agent: Agent::Claude,
        archived: None,
    })
}

fn shorten(title: &str) -> String {
    let single_line = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if single_line.chars().count() <= MAX_TITLE_CHARS {
        return single_line;
    }
    single_line.chars().take(MAX_TITLE_CHARS).collect::<String>() + "…"
}

/// Stops at the first real user prompt, which is near the start of the file.
fn read_cwd_and_first_prompt(path: &Path) -> (Option<String>, Option<String>) {
    let Ok(file) = File::open(path) else {
        return (None, None);
    };
    let mut cwd = None;
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if cwd.is_none() {
            cwd = value.get("cwd").and_then(Value::as_str).map(str::to_owned);
        }
        if value.get("type").and_then(Value::as_str) != Some("user")
            || value.get("isMeta").and_then(Value::as_bool) == Some(true)
            || value.get("isCompactSummary").and_then(Value::as_bool) == Some(true)
        {
            continue;
        }
        if let Some(prompt) = first_prompt_text(&value) {
            return (cwd, Some(prompt));
        }
    }
    (cwd, None)
}

fn first_prompt_text(line: &Value) -> Option<String> {
    let content = line.get("message")?.get("content")?;
    if let Some(text) = content.as_str() {
        return visible_user_text(text);
    }
    content.as_array()?.iter().find_map(|block| {
        if block.get("type")?.as_str()? != "text" {
            return None;
        }
        prompt_without_attachments(&visible_user_text(block.get("text")?.as_str()?)?)
    })
}

/// Attached files are named after the prompt, and are no use as a title unless nothing else is.
fn prompt_without_attachments(text: &str) -> Option<String> {
    let prompt = text
        .lines()
        .filter(|line| !line.starts_with(ATTACHED_FILE_PREFIX))
        .collect::<Vec<_>>()
        .join("\n");
    if !prompt.trim().is_empty() {
        return Some(prompt.trim_end().to_owned());
    }
    let first = text.lines().find_map(|line| line.strip_prefix(ATTACHED_FILE_PREFIX))?;
    first.rsplit('/').next().map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_messages_for_test(path: &Path) -> Result<Vec<Message>, String> {
        read_task(path).map(|content| content.messages)
    }

    #[test]
    fn native_api_errors_mark_the_failed_reply_and_successful_retries_clear_the_marker() {
        for recovered in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let mut error = assistant("err", "u", "m", json!({"type":"text", "text":"API error details"}));
            error["isApiErrorMessage"] = json!(true);
            let mut lines = vec![user("u", None, json!("first")), error];
            lines.push(if recovered { assistant("ok", "err", "m", json!({"type":"text", "text":"recovered"})) } else { user("next", Some("err"), json!("try again")) });
            let path = write_session(dir.path(), "p", ID, &lines);
            let messages = read_task(&path).unwrap().messages;
            assert_eq!(messages.iter().filter(|message| message.kind == MessageKind::Assistant && message.is_error).count(), usize::from(!recovered));
            if !recovered { assert!(messages[1].is_error); assert_eq!(messages[2].text, "try again"); }
        }
    }

    #[test]
    fn restores_the_last_real_model_on_the_active_claude_branch() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("task.jsonl");
        let lines = [
            json!({"type":"assistant", "uuid":"a", "message":{"model":"claude-a", "content":[]}}),
            json!({"type":"assistant", "uuid":"abandoned", "parentUuid":"a", "message":{"model":"wrong", "content":[]}}),
            json!({"type":"assistant", "uuid":"b", "parentUuid":"a", "message":{"model":"claude-b", "content":[]}}),
            json!({"type":"assistant", "uuid":"synthetic", "parentUuid":"b", "message":{"model":"<synthetic>", "content":[]}}),
        ];
        std::fs::write(&path, lines.iter().map(Value::to_string).collect::<Vec<_>>().join("\n")).unwrap();
        assert_eq!(read_task(&path).unwrap().model_selection, Some(TaskModel { model:"claude-b".into(), effort:None }));
    }

    #[test]
    fn context_comes_from_the_last_request_on_the_active_branch() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("task.jsonl");
        let usage = |tokens: u64| format!(r#"{{"model":"m","content":[],"usage":{{"input_tokens":{tokens},"cache_read_input_tokens":1,"output_tokens":99}}}}"#);
        let lines = [
            format!(r#"{{"type":"assistant","uuid":"a","message":{}}}"#, usage(10)),
            format!(r#"{{"type":"assistant","uuid":"side","isSidechain":true,"parentUuid":"a","message":{}}}"#, usage(500)),
            format!(r#"{{"type":"assistant","uuid":"b","parentUuid":"a","message":{}}}"#, usage(20)),
        ];
        std::fs::write(&path, lines.join("\n")).unwrap();
        let context = read_task(&path).unwrap().context;
        assert_eq!(context, Some(TaskContext { used_tokens: 21, model: Some("m".into()) }));
    }
    use serde_json::json;
    use std::io::Write;

    const ID: &str = "11111111-1111-4111-8111-111111111111";

    fn write_session(dir: &Path, project: &str, id: &str, lines: &[Value]) -> PathBuf {
        let project = dir.join(project);
        std::fs::create_dir_all(&project).unwrap();
        let path = project.join(format!("{id}.jsonl"));
        let mut file = File::create(&path).unwrap();
        for line in lines {
            writeln!(file, "{line}").unwrap();
        }
        path
    }

    fn user(uuid: &str, parent: Option<&str>, content: Value) -> Value {
        json!({"type": "user", "uuid": uuid, "parentUuid": parent, "cwd": "/work/app",
               "message": {"role": "user", "content": content}})
    }

    fn assistant(uuid: &str, parent: &str, id: &str, block: Value) -> Value {
        json!({"type": "assistant", "uuid": uuid, "parentUuid": parent, "cwd": "/work/app",
               "message": {"id": id, "role": "assistant", "content": [block]}})
    }

    fn texts(messages: &[Message]) -> Vec<&str> {
        messages.iter().map(|message| message.text.as_str()).collect()
    }

    #[test]
    fn the_last_recorded_permission_mode_on_the_active_branch_is_reported() {
        let dir = tempfile::tempdir().unwrap();
        let mut terminal = user("u1", None, json!("in the terminal"));
        terminal["permissionMode"] = json!("auto");
        let mut sent_here = user("u2", Some("a1"), json!("from elsewhere"));
        sent_here["permissionMode"] = json!("default");
        let path = write_session(dir.path(), "p", ID, &[terminal, assistant("a1", "u1", "m1", json!({"type":"text","text":"ok"})), sent_here]);
        assert_eq!(read_task(&path).unwrap().permission_mode.as_deref(), Some("default"));
    }

    #[test]
    fn editing_truncates_at_the_assistant_before_the_last_prompt_on_the_active_branch() {
        let dir = tempfile::tempdir().unwrap();
        let text = |text: &str| json!({"type": "text", "text": text});
        let mut lines = vec![
            user("u1", None, json!("first")),
            assistant("a1", "u1", "m1", text("one")),
            user("u2", Some("a1"), json!("second")),
            assistant("a2", "u2", "m2", text("two")),
            // A tool result and the interruption marker are part of the turn, not prompts of their own.
            user("r2", Some("a2"), json!([{"type": "tool_result", "tool_use_id": "t", "content": "ok"}])),
            user("i2", Some("r2"), json!("[Request interrupted by user]")),
        ];
        let path = write_session(dir.path(), "p", ID, &lines);
        assert_eq!(edit_anchor(&path, "u2:0"), Ok(EditAnchor { assistant: "a1".into(), prompt: "u2".into() }));
        assert!(edit_anchor(&path, "u1:0").unwrap_err().contains("最后一条"));

        let only = write_session(dir.path(), "q", ID, &lines[..2]);
        assert!(edit_anchor(&only, "u1:0").unwrap_err().contains("第一条"));

        // An earlier edit left a branch behind; only the active one counts.
        lines.push(user("u3", Some("a1"), json!("second, edited")));
        let path = write_session(dir.path(), "r", ID, &lines);
        assert_eq!(edit_anchor(&path, "u3:0"), Ok(EditAnchor { assistant: "a1".into(), prompt: "u3".into() }));

        let compacted = write_session(dir.path(), "s", ID, &[
            user("u1", None, json!("first")),
            assistant("a1", "u1", "m1", text("one")),
            json!({"type": "user", "uuid": "c", "parentUuid": null, "logicalParentUuid": "a1", "isCompactSummary": true,
                   "message": {"role": "user", "content": "summary"}}),
            user("u2", Some("c"), json!("after compaction")),
        ]);
        assert!(edit_anchor(&compacted, "u2:0").unwrap_err().contains("压缩"));
    }

    #[test]
    fn reads_every_block_kind_in_order() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_session(dir.path(), "p", ID, &[
            user("u1", None, json!("hello")),
            assistant("a1", "u1", "m1", json!({"type": "thinking", "thinking": "hmm"})),
            assistant("a2", "a1", "m1", json!({"type": "tool_use", "id": "t1", "name": "Read", "input": {"file": "a"}})),
            user("u2", Some("a2"), json!([{"type": "tool_result", "tool_use_id": "t1", "is_error": true,
                                           "content": [{"type": "text", "text": "missing"}]}])),
            assistant("a3", "u2", "m2", json!({"type": "text", "text": "done"})),
        ]);
        let messages = read_messages_for_test(&path).unwrap();
        let kinds: Vec<_> = messages.iter().map(|message| message.kind).collect();
        assert_eq!(kinds, [
            MessageKind::User,
            MessageKind::Thinking,
            MessageKind::ToolUse,
            MessageKind::ToolResult,
            MessageKind::Assistant,
        ]);
        assert_eq!(messages[2].tool_name.as_deref(), Some("Read"));
        assert_eq!(messages[3].tool_use_id.as_deref(), Some("t1"));
        assert_eq!(messages[3].text, "missing");
        assert!(messages[3].is_error);
    }

    #[test]
    fn drops_branches_abandoned_by_rewinding() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_session(dir.path(), "p", ID, &[
            user("u1", None, json!("first")),
            assistant("a1", "u1", "m1", json!({"type": "text", "text": "first reply"})),
            user("u2", Some("a1"), json!("abandoned")),
            assistant("a2", "u2", "m2", json!({"type": "text", "text": "abandoned reply"})),
            user("u3", Some("a1"), json!("second")),
            assistant("a3", "u3", "m3", json!({"type": "text", "text": "second reply"})),
        ]);
        assert_eq!(
            texts(&read_messages_for_test(&path).unwrap()),
            ["first", "first reply", "second", "second reply"]
        );
    }

    #[test]
    fn keeps_parallel_tool_calls_that_sit_beside_the_active_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_session(dir.path(), "p", ID, &[
            user("u1", None, json!("go")),
            assistant("a1", "u1", "m1", json!({"type": "tool_use", "id": "t1", "name": "A", "input": {}})),
            assistant("a2", "a1", "m1", json!({"type": "tool_use", "id": "t2", "name": "B", "input": {}})),
            user("r1", Some("a1"), json!([{"type": "tool_result", "tool_use_id": "t1", "content": "one"}])),
            user("r2", Some("a2"), json!([{"type": "tool_result", "tool_use_id": "t2", "content": "two"}])),
            assistant("a3", "r2", "m2", json!({"type": "text", "text": "done"})),
        ]);
        let messages = read_messages_for_test(&path).unwrap();
        let results: Vec<_> = messages
            .iter()
            .filter(|message| message.kind == MessageKind::ToolResult)
            .map(|message| message.text.as_str())
            .collect();
        assert_eq!(results, ["one", "two"]);
    }

    #[test]
    fn follows_the_logical_parent_across_compaction() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_session(dir.path(), "p", ID, &[
            user("u1", None, json!("before")),
            json!({"type": "system", "uuid": "c1", "parentUuid": null, "logicalParentUuid": "u1"}),
            user("u2", Some("c1"), json!("after")),
        ]);
        assert_eq!(texts(&read_messages_for_test(&path).unwrap()), ["before", "after"]);
    }

    #[test]
    fn a_compact_command_leaves_only_its_divider() {
        assert!(visible_user_text("<command-name>/compact</command-name>").is_none());
        assert_eq!(visible_user_text("<command-name>/review</command-name>").as_deref(), Some("/review"));
    }

    #[test]
    fn image_tags_leave_the_text_alone_otherwise() {
        assert_eq!(without_image_tags("[Image #21] 太近了"), "太近了");
        assert_eq!(without_image_tags("a[Image #1]b [Image #2]"), "ab ");
        assert_eq!(without_image_tags("see [Image #x] and [Image"), "see [Image #x] and [Image");
        assert!(visible_user_text("[Image #3]").is_none());
    }

    #[test]
    fn shows_what_the_user_typed_during_a_turn() {
        let dir = tempfile::tempdir().unwrap();
        let queued = |uuid: &str, parent: &str, human: bool, text: &str| {
            json!({
                "type": "attachment", "uuid": uuid, "parentUuid": parent,
                "attachment": {"type": "queued_command", "prompt": text, "humanTurn": human},
            })
        };
        let hook = json!({"type": "attachment", "uuid": "h", "parentUuid": "q2", "attachment": {"type": "hook_success"}});
        let blocks = json!({
            "type": "attachment", "uuid": "q3", "parentUuid": "h",
            "attachment": {"type": "queued_command", "humanTurn": true, "prompt": [{"type": "text", "text": "with blocks"}]},
        });
        // Written into a running print-mode process, as Tandem adds a message mid-turn.
        let added = json!({
            "type": "attachment", "uuid": "q4", "parentUuid": "q3",
            "attachment": {"type": "queued_command", "commandMode": "prompt", "prompt": [{"type": "text", "text": "added mid-turn"}]},
        });
        let notification = json!({
            "type": "attachment", "uuid": "q5", "parentUuid": "q4",
            "attachment": {"type": "queued_command", "commandMode": "task-notification", "origin": {"kind": "task-notification"}, "prompt": "task done"},
        });
        let path = write_session(dir.path(), "p", ID, &[
            user("u1", None, json!("first")),
            queued("q1", "u1", true, "typed meanwhile"),
            queued("q2", "q1", false, "from a program"),
            hook,
            blocks,
            added,
            notification,
            user("u2", Some("q5"), json!("last")),
        ]);
        assert_eq!(texts(&read_messages_for_test(&path).unwrap()), ["first", "typed meanwhile", "with blocks", "added mid-turn", "last"]);
    }

    #[test]
    fn a_compaction_summary_is_a_marker_and_never_a_title() {
        let dir = tempfile::tempdir().unwrap();
        let mut summary = user("s", Some("c1"), json!("This session is being continued"));
        summary["isCompactSummary"] = json!(true);
        summary["isVisibleInTranscriptOnly"] = json!(true);
        let path = write_session(dir.path(), "p", ID, &[
            summary.clone(),
            user("u1", Some("s"), json!("real question")),
        ]);
        let messages = read_messages_for_test(&path).unwrap();
        assert_eq!(messages[0].kind, MessageKind::Compaction);
        assert_eq!(messages[0].text, "");
        assert_eq!(messages[1].text, "real question");
        assert_eq!(read_cwd_and_first_prompt(&path).1.as_deref(), Some("real question"));
    }

    #[test]
    fn hides_sidechains_meta_lines_and_cli_bookkeeping() {
        let dir = tempfile::tempdir().unwrap();
        let mut side = user("s1", Some("u1"), json!("subagent"));
        side["isSidechain"] = json!(true);
        let mut meta = user("m1", Some("u1"), json!("meta note"));
        meta["isMeta"] = json!(true);
        let path = write_session(dir.path(), "p", ID, &[
            user("u1", None, json!("real")),
            side,
            meta,
            user("u2", Some("m1"), json!("<local-command-stdout>x</local-command-stdout>")),
            user("u3", Some("u2"), json!("<command-name>/review</command-name><command-args>a b</command-args>")),
        ]);
        assert_eq!(texts(&read_messages_for_test(&path).unwrap()), ["real", "/review a b"]);
    }

    #[test]
    fn skips_a_partial_last_line() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_session(dir.path(), "p", ID, &[user("u1", None, json!("kept"))]);
        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(br#"{"type":"user","uuid":"u2"#)
            .unwrap();
        assert_eq!(texts(&read_messages_for_test(&path).unwrap()), ["kept"]);
    }

    #[test]
    fn clipped_tool_input_stays_valid_json() {
        let long = "x".repeat(MAX_INPUT_BYTES + 10);
        let (text, truncated) = tool_input_text(Some(&json!({"file_path": "/a", "content": long})));
        let parsed: Value = serde_json::from_str(&text).unwrap();
        assert!(truncated);
        assert_eq!(parsed["file_path"], "/a");
        assert_eq!(parsed["content"].as_str().unwrap().len(), MAX_INPUT_BYTES);
        assert!(!tool_input_text(Some(&json!({"a": "b"}))).1);
    }

    #[test]
    fn messages_carry_the_line_timestamp() {
        let dir = tempfile::tempdir().unwrap();
        let mut line = user("u1", None, json!("hi"));
        line["timestamp"] = json!("2026-11-04T01:02:03.000Z");
        let path = write_session(dir.path(), "p", ID, &[line]);
        let messages = read_messages_for_test(&path).unwrap();
        assert_eq!(messages[0].timestamp.as_deref(), Some("2026-11-04T01:02:03.000Z"));
    }

    #[test]
    fn clips_long_output_on_a_character_boundary() {
        let (text, truncated) = clip("任务任务", 7);
        assert_eq!(text, "任务");
        assert!(truncated);
        assert_eq!(clip("ok", 7), ("ok".to_owned(), false));
    }

    #[test]
    fn prefers_custom_title_then_generated_title_then_first_prompt() {
        let dir = tempfile::tempdir().unwrap();
        let prompt = user("u1", None, json!("first prompt"));
        let generated = json!({"type": "ai-title", "aiTitle": "Generated"});
        let custom = json!({"type": "custom-title", "customTitle": "Custom"});
        let ids = [
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222",
            "33333333-3333-4333-8333-333333333333",
        ];
        write_session(dir.path(), "p", ids[0], std::slice::from_ref(&prompt));
        write_session(dir.path(), "p", ids[1], &[prompt.clone(), generated.clone()]);
        write_session(dir.path(), "p", ids[2], &[prompt, custom, generated]);
        let tasks = list_tasks(dir.path(), &["/".to_owned()]).unwrap();
        let title = |id: &str| {
            tasks.iter().find(|task| task.id == id).unwrap().title.clone()
        };
        assert_eq!(title(ids[0]), "first prompt");
        assert_eq!(title(ids[1]), "Generated");
        assert_eq!(title(ids[2]), "Custom");
        assert_eq!(tasks[0].cwd, "/work/app");
    }

    #[test]
    fn saved_titles_survive_later_output_and_keep_custom_title_priority() {
        for custom in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let mut lines = vec![user("u1", None, json!("first prompt"))];
            if custom {
                lines.push(json!({"type":"custom-title", "customTitle":"Custom"}));
            }
            lines.push(json!({"type":"ai-title", "aiTitle":"Generated"}));
            lines.push(assistant("a1", "u1", "m1", json!({"type":"text", "text":"x".repeat(512 * 1024)})));
            let path = write_session(dir.path(), "p", ID, &lines);
            let expected = if custom { "Custom" } else { "Generated" };
            assert_eq!(summarize(&path, 0).unwrap().title, expected);
            assert_eq!(list_tasks(dir.path(), &["/".to_owned()]).unwrap()[0].title, expected);
        }
    }

    #[test]
    fn lists_only_session_files_with_a_working_directory() {
        let dir = tempfile::tempdir().unwrap();
        write_session(dir.path(), "p", "not-a-uuid", &[user("u1", None, json!("x"))]);
        write_session(dir.path(), "p", ID, &[json!({"type": "mode", "mode": "normal"})]);
        assert!(list_tasks(dir.path(), &["/".to_owned()]).unwrap().is_empty());
    }

    #[test]
    fn missing_projects_directory_is_an_empty_list() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list_tasks(&dir.path().join("none"), &["/".to_owned()]).unwrap().is_empty());
    }

    #[test]
    fn rejects_ids_that_are_not_uuids() {
        let dir = tempfile::tempdir().unwrap();
        assert!(find_task_file(dir.path(), "../../secret").unwrap_err().contains("Invalid"));
        assert!(find_task_file(dir.path(), ID).unwrap_err().contains("not found"));
        let path = write_session(dir.path(), "p", ID, &[]);
        assert_eq!(find_task_file(dir.path(), ID).unwrap(), path);
    }

    #[test]
    fn user_images_reach_the_page_only_as_plain_image_types() {
        let image = |media_type: &str| {
            json!({"type": "image", "source": {"type": "base64", "media_type": media_type, "data": "AA"}})
        };
        assert_eq!(image_data_url(&image("image/png")).unwrap(), "data:image/png;base64,AA");
        assert!(image_data_url(&image("image/svg+xml")).is_none());
    }

    #[test]
    fn titles_skip_attached_file_lines_unless_nothing_else_is_there() {
        assert_eq!(prompt_without_attachments("fix it\n\nAttached file, readable with your tools even outside the workspace: /a/b.log").unwrap(), "fix it");
        assert_eq!(prompt_without_attachments("Attached file, readable with your tools even outside the workspace: /a/b.log").unwrap(), "b.log");
    }

    #[test]
    fn hides_background_task_notifications() {
        assert!(visible_user_text("<task-notification>\n<task-id>a</task-id>").is_none());
        assert_eq!(visible_user_text("a real question").unwrap(), "a real question");
    }

    #[test]
    fn a_root_covers_itself_and_what_is_inside_it_only() {
        assert!(is_under("/code/app", "/code/app"));
        assert!(is_under("/code/app/.claude/worktrees/x", "/code/app/"));
        assert!(!is_under("/code/app-two", "/code/app"));
        assert!(is_under("/anything", "/"));
    }
}

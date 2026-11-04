//! Read-only access to Claude Code's native session files. Tandem keeps no copy of task content.

use serde::{Deserialize, Serialize};
use serde_json::{value::RawValue, Value};
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

const MAX_TASKS: usize = 300;
const TITLE_TAIL_BYTES: u64 = 256 * 1024;
const MAX_TEXT_BYTES: usize = 20 * 1024;
const MAX_INPUT_BYTES: usize = 4 * 1024;
const MAX_TITLE_CHARS: usize = 80;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummary {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub updated_at_ms: u64,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MessageKind {
    User,
    Assistant,
    Thinking,
    ToolUse,
    ToolResult,
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
    timestamp: Option<String>,
    message: Option<Box<RawValue>>,
}

struct Entry {
    uuid: String,
    is_user: bool,
    is_meta: bool,
    timestamp: Option<String>,
    message: Box<RawValue>,
}

#[derive(Deserialize)]
struct RawMessage {
    id: Option<String>,
    content: Option<Value>,
}

pub fn claude_projects_dir() -> Result<PathBuf, String> {
    let config = match std::env::var_os("CLAUDE_CONFIG_DIR") {
        Some(dir) => PathBuf::from(dir),
        None => PathBuf::from(std::env::var_os("HOME").ok_or("HOME is not set")?).join(".claude"),
    };
    Ok(config.join("projects"))
}

pub fn list_tasks(projects_dir: &Path) -> Result<Vec<TaskSummary>, String> {
    let mut files = Vec::new();
    let projects = match std::fs::read_dir(projects_dir) {
        Ok(projects) => projects,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    for project in projects.flatten() {
        let Ok(entries) = std::fs::read_dir(project.path()) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !is_session_file(&path) {
                continue;
            }
            if let Some(modified) = modified_ms(&path) {
                files.push((modified, path));
            }
        }
    }
    files.sort_by(|a, b| b.0.cmp(&a.0));

    let mut tasks = Vec::new();
    for (updated_at_ms, path) in files {
        if tasks.len() == MAX_TASKS {
            break;
        }
        if let Some(task) = summarize(&path, updated_at_ms) {
            tasks.push(task);
        }
    }
    Ok(tasks)
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

pub fn read_messages(path: &Path) -> Result<Vec<Message>, String> {
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
        if parsed.is_sidechain || !matches!(kind, Some("user" | "assistant")) {
            continue;
        }
        if let Some(message) = parsed.message {
            entries.push(Entry {
                uuid,
                is_user: kind == Some("user"),
                is_meta: parsed.is_meta,
                timestamp: parsed.timestamp,
                message,
            });
        }
    }
    let included = active_branch(&entries, &parents);
    let mut messages = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        if included.contains(&index) {
            append_messages(entry, &mut messages);
        }
    }
    Ok(messages)
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

fn append_messages(entry: &Entry, out: &mut Vec<Message>) {
    let Ok(message) = serde_json::from_str::<RawMessage>(entry.message.get()) else {
        return;
    };
    // `isMeta` lines are filtered here rather than while reading, so they still link the chain.
    if entry.is_meta {
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
                });
            }
            _ => {}
        }
    }
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
        is_error: false,
        truncated,
        timestamp: entry.timestamp.clone(),
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
fn visible_user_text(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty()
        || trimmed.starts_with("<local-command-")
        || trimmed.starts_with("<system-reminder>")
    {
        return None;
    }
    if let Some(name) = between(trimmed, "<command-name>", "</command-name>") {
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
    let title = read_title_from_tail(path)
        .or(first_prompt)
        .unwrap_or_default();
    Some(TaskSummary {
        id: path.file_stem()?.to_str()?.to_owned(),
        title: shorten(&title),
        cwd,
        updated_at_ms,
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
        visible_user_text(block.get("text")?.as_str()?)
    })
}

/// A user-set title outranks the generated one. Both are appended, so the last of each wins.
fn read_title_from_tail(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let length = file.metadata().ok()?.len();
    let start = length.saturating_sub(TITLE_TAIL_BYTES);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    let mut custom = None;
    let mut generated = None;
    for line in text.lines() {
        if !line.contains("itle\"") {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        match value.get("type").and_then(Value::as_str) {
            Some("custom-title") => {
                custom = value
                    .get("customTitle")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
            }
            Some("ai-title") => {
                generated = value
                    .get("aiTitle")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
            }
            _ => {}
        }
    }
    custom.or(generated)
}

#[cfg(test)]
mod tests {
    use super::*;
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
        let messages = read_messages(&path).unwrap();
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
            texts(&read_messages(&path).unwrap()),
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
        let messages = read_messages(&path).unwrap();
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
        assert_eq!(texts(&read_messages(&path).unwrap()), ["before", "after"]);
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
        assert_eq!(texts(&read_messages(&path).unwrap()), ["real", "/review a b"]);
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
        assert_eq!(texts(&read_messages(&path).unwrap()), ["kept"]);
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
        let messages = read_messages(&path).unwrap();
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
        let tasks = list_tasks(dir.path()).unwrap();
        let title = |id: &str| {
            tasks.iter().find(|task| task.id == id).unwrap().title.clone()
        };
        assert_eq!(title(ids[0]), "first prompt");
        assert_eq!(title(ids[1]), "Generated");
        assert_eq!(title(ids[2]), "Custom");
        assert_eq!(tasks[0].cwd, "/work/app");
    }

    #[test]
    fn lists_only_session_files_with_a_working_directory() {
        let dir = tempfile::tempdir().unwrap();
        write_session(dir.path(), "p", "not-a-uuid", &[user("u1", None, json!("x"))]);
        write_session(dir.path(), "p", ID, &[json!({"type": "mode", "mode": "normal"})]);
        assert!(list_tasks(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn missing_projects_directory_is_an_empty_list() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list_tasks(&dir.path().join("none")).unwrap().is_empty());
    }

    #[test]
    fn rejects_ids_that_are_not_uuids() {
        let dir = tempfile::tempdir().unwrap();
        assert!(find_task_file(dir.path(), "../../secret").unwrap_err().contains("Invalid"));
        assert!(find_task_file(dir.path(), ID).unwrap_err().contains("not found"));
        let path = write_session(dir.path(), "p", ID, &[]);
        assert_eq!(find_task_file(dir.path(), ID).unwrap(), path);
    }
}

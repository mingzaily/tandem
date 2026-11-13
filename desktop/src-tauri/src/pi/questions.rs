use super::*;
#[cfg(test)]
#[path = "question_tests.rs"]
mod question_tests;

pub(super) const SELECTION_COMMAND: &str = "tandem_question_answer";
const COMMENT_PLACEHOLDER: &str = "Optional comment (press Enter to skip)...";

/// Only the active ask_user call enriches native dialogs; ordinary extension dialogs stay native.
#[derive(Default)]
pub(super) struct DialogReplies {
    pub(super) custom: HashMap<String, String>,
    comments: HashMap<String, String>,
    active: HashMap<String, (Value, bool)>,
}

impl DialogReplies {
    pub(super) fn observe(&mut self, event: &Value, default_comment: bool) {
        let id = event.get("toolCallId").and_then(Value::as_str).unwrap_or_default();
        match event.get("type").and_then(Value::as_str) {
            Some("agent_start") => { self.active.clear(); self.custom.clear(); self.comments.clear(); }
            Some("tool_execution_start") if event.get("toolName").and_then(Value::as_str) == Some("ask_user") => {
                self.active.insert(id.to_owned(), (event.get("args").cloned().unwrap_or(Value::Null), default_comment));
            }
            Some("tool_execution_end") if self.active.remove(id).is_some() => { self.custom.clear(); self.comments.clear(); }
            _ => {}
        }
    }

    pub(super) fn present(&self, value: &Value) -> Option<(String, TurnEvent, PendingRequest)> {
        let (id, mut event, mut pending) = ui_request(value)?;
        if !matches!(event, TurnEvent::Question { .. }) { return Some((id, event, pending)); }
        let title = value.get("title").and_then(Value::as_str).unwrap_or_default();
        for (args, default_comment) in self.active.values() {
            let batch = args.get("questions").and_then(Value::as_array);
            let entries: Vec<&Value> = batch.map(|entries| entries.iter().collect()).unwrap_or_else(|| vec![args]);
            for (index, entry) in entries.iter().enumerate() {
                let question = entry.get("question").and_then(Value::as_str).unwrap_or_default();
                let main = if let Some(batch) = batch {
                    let heading = args.get("question").and_then(Value::as_str).filter(|text| !text.is_empty()).map(|text| format!("{text}\n")).unwrap_or_default();
                    format!("{heading}({}/{}) {question}", index + 1, batch.len())
                } else { question.to_owned() };
                let context = entry.get("context").and_then(Value::as_str).unwrap_or_default().trim();
                let prompt = if context.is_empty() { main.clone() } else { format!("{main}\n\nContext:\n{context}") };
                let multi = entry.get("allowMultiple").and_then(Value::as_bool).unwrap_or(false);
                if title != prompt && !(multi && title.starts_with(&format!("{prompt}\n\nOptions (select one or more):\n"))) { continue; }
                let options: Vec<Value> = entry.get("options").and_then(Value::as_array).into_iter().flatten().filter_map(|option| {
                    let label = option.as_str().or_else(|| ["title", "label", "text", "value", "name", "option"].iter().find_map(|key| option.get(key).and_then(Value::as_str)))?.trim();
                    if label.is_empty() { return None; }
                    let mut row = json!({"label":label});
                    if let Some(description) = option.get("description").and_then(Value::as_str) { row["description"] = json!(description); }
                    Some(row)
                }).collect();
                let allow_comment = args.get("allowComment").and_then(Value::as_bool).unwrap_or(*default_comment) && !options.is_empty();
                if let TurnEvent::Question { questions, .. } = &mut event {
                    questions[0]["displayQuestion"] = json!(main);
                    questions[0]["context"] = json!(context);
                    questions[0]["options"] = json!(options);
                    questions[0]["multiSelect"] = json!(multi);
                    questions[0]["allowCustom"] = json!(entry.get("allowFreeform").and_then(Value::as_bool).unwrap_or(true));
                    questions[0]["allowComment"] = json!(allow_comment);
                }
                pending.input["allowComment"] = json!(allow_comment);
                pending.input["prompt"] = json!(prompt);
                pending.input["multiSelect"] = json!(multi);
                return Some((id, event, pending));
            }
        }
        Some((id, event, pending))
    }

    pub(super) fn outbound(&mut self, line: &str) -> Result<String, String> {
        let value: Value = serde_json::from_str(line).map_err(|error| error.to_string())?;
        let command = value.get("type").and_then(Value::as_str);
        if command != Some(CUSTOM_ANSWER_COMMAND) && command != Some(SELECTION_COMMAND) { return Ok(line.to_owned()); }
        let question = value.get("question").and_then(Value::as_str).ok_or("回答缺少原问题")?;
        let answer = value.get("answer").and_then(Value::as_str).ok_or("回答缺少正文")?;
        if command == Some(CUSTOM_ANSWER_COMMAND) {
            self.custom.insert(question.to_owned(), answer.to_owned());
            return Ok(json!({"type":"extension_ui_response", "id":value["id"], "value":ASK_USER_CUSTOM_OPTION}).to_string());
        }
        let prompt = value.get("prompt").and_then(Value::as_str).unwrap_or(question);
        let selections: Vec<&str> = if value.get("multiSelect").and_then(Value::as_bool) == Some(true) { answer.split(',').map(str::trim).collect() } else { vec![answer] };
        let label = if selections.len() == 1 { "Selected option" } else { "Selected options" };
        let comment_title = format!("{prompt}\n\n{label}:\n{}", selections.iter().map(|selection| format!("- {selection}")).collect::<Vec<_>>().join("\n"));
        self.comments.insert(comment_title, value.get("comment").and_then(Value::as_str).unwrap_or_default().to_owned());
        Ok(json!({"type":"extension_ui_response", "id":value["id"], "value":answer}).to_string())
    }

    pub(super) fn follow_up(&mut self, request: &Value) -> Option<String> {
        if request.get("method")?.as_str()? != "input" { return None; }
        let title = request.get("title")?.as_str()?;
        let answer = match request.get("placeholder")?.as_str()? {
            "Type your answer..." => self.custom.remove(title)?,
            COMMENT_PLACEHOLDER => self.comments.remove(title)?,
            _ => return None,
        };
        Some(json!({"type":"extension_ui_response", "id":request["id"], "value":answer}).to_string())
    }
}

/// Match the extension's read-only defaults using the same environment as the child process.
pub(super) async fn comment_default(env: &HashMap<String, String>) -> bool {
    if let Some(value) = env.get("PI_ASK_USER_ALLOW_COMMENT") {
        match value.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" | "on" => return true,
            "false" | "0" | "no" | "off" => return false,
            _ => {}
        }
    }
    let path = env.get("PI_CODING_AGENT_DIR").map(PathBuf::from).or_else(|| env.get("HOME").map(|home| PathBuf::from(home).join(".pi/agent")));
    let Some(path) = path else { return false };
    let Some(settings) = tokio::fs::read(path.join("ask-user.json")).await.ok().and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok()) else { return false };
    settings.get("allowComment").and_then(Value::as_bool).unwrap_or(false)
}

/// Structured native details survive both the live event and later history reads.
pub(super) fn result_text(result: &Value, name: Option<&str>) -> String {
    if name == Some("ask_user") {
        if let Some(details) = result.get("details").filter(|details| details.get("question").is_some() || details.get("questions").is_some()) { return details.to_string(); }
    }
    text_of(result.get("content"))
}

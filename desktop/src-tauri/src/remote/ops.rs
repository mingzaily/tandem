//! What a phone may ask for. This list is the whole of it: anything not here is refused, and the
//! limits from docs/relay-protocol.md section 2 are enforced here rather than trusted to the page.

use super::{Context, Inner, Remote, TURN_EVENT};
use crate::runner::{self, Decision, TurnOptions, TurnSink};
use crate::sessions::{Agent, Message};
use crate::{codex, commands, conversations, login_env};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

const CONVERSATION_CWD: &str = "tandem:conversation";
const DEFAULT_PAGE: usize = 200;
const MAX_PAGE: usize = 500;
const INFO_LIFETIME: Duration = Duration::from_secs(60);
const OMITTED_IMAGE: &str = "omitted";

struct OpError(&'static str, String);

impl OpError {
    fn bad(message: impl Into<String>) -> Self {
        Self("BAD_REQUEST", message.into())
    }
    fn not_allowed(message: impl Into<String>) -> Self {
        Self("NOT_ALLOWED", message.into())
    }
}

impl From<String> for OpError {
    fn from(message: String) -> Self {
        Self("INTERNAL", message)
    }
}

fn params<T: serde::de::DeserializeOwned>(value: &Value) -> Result<T, OpError> {
    serde_json::from_value(value.clone()).map_err(|error| OpError::bad(error.to_string()))
}

fn agent_key(agent: Agent) -> &'static str {
    match agent {
        Agent::Claude => "claude",
        Agent::Codex => "codex",
        Agent::Pi => "pi",
    }
}

fn host_name() -> String {
    let mut buffer = [0u8; 256];
    let result = unsafe { libc::gethostname(buffer.as_mut_ptr().cast(), buffer.len()) };
    if result != 0 {
        return "Tandem".to_owned();
    }
    let end = buffer.iter().position(|byte| *byte == 0).unwrap_or(buffer.len());
    String::from_utf8_lossy(&buffer[..end]).trim_end_matches(".local").to_owned()
}

fn project_name(cwd: &str) -> String {
    cwd.trim_end_matches('/').rsplit('/').next().unwrap_or(cwd).to_owned()
}

fn host_projects(context: &Context) -> Vec<Value> {
    let mut projects: Vec<&str> = context.projects.iter().map(String::as_str).collect();
    projects.push(CONVERSATION_CWD);
    let order: std::collections::HashMap<&str, usize> = context.project_order.iter()
        .enumerate().map(|(index, cwd)| (cwd.as_str(), index + 1)).collect();
    projects.sort_by_key(|cwd| order.get(cwd).copied().unwrap_or(0));
    projects.into_iter().map(|cwd| json!({
        "cwd": cwd,
        "name": if cwd == CONVERSATION_CWD { "对话".to_owned() } else { project_name(cwd) },
    })).collect()
}

async fn host_info(inner: &Inner) -> Result<Value, OpError> {
    let env = login_env::login_env().await;
    let agents: Vec<&str> = ["claude", "codex", "pi"]
        .into_iter()
        .filter(|command| login_env::find_in_path(command, env.get("PATH")).is_some())
        .collect();
    let context = inner.context.lock().map(|context| context.clone()).unwrap_or_default();
    Ok(json!({
        "name": host_name(),
        "version": inner.app.package_info().version.to_string(),
        "agents": agents,
        "projects": host_projects(&context),
        "conversationRoots": context.conversation_roots,
    }))
}

async fn tasks_list(inner: &Inner) -> Result<Value, OpError> {
    let context = inner.context.lock().map(|context| context.clone()).unwrap_or_default();
    let reader = inner.app.state::<codex::Reader>();
    let runs = inner.app.state::<runner::Runs>();
    let mut tasks = commands::collect_tasks(reader.inner(), context.projects, context.conversation_roots).await;
    tasks.retain(|task| !context.archived.contains(&task.id));
    for task in &mut tasks {
        if let Some(title) = context.titles.get(&task.id) {
            task.title.clone_from(title);
        }
    }
    tasks.sort_by_key(|task| std::cmp::Reverse(task.updated_at_ms));
    let writers = commands::collect_writers(runs.inner(), reader.inner()).await?;
    let external: Vec<Value> = writers
        .iter()
        .map(|writer| json!({"taskId": writer.task_id, "isBusy": writer.is_busy}))
        .collect();
    Ok(json!({"tasks": tasks, "external": external}))
}

#[derive(Deserialize)]
struct ReadParams {
    agent: Agent,
    id: String,
    before: Option<usize>,
    limit: Option<usize>,
}

/// Images stay on the computer in this version: they are large, and most phones never open them.
fn page_of(mut messages: Vec<Message>, before: Option<usize>, limit: Option<usize>) -> (Vec<Message>, usize) {
    let total = messages.len();
    let end = before.unwrap_or(total).min(total);
    let start = end.saturating_sub(limit.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE));
    let mut page: Vec<Message> = messages.drain(start..end).collect();
    for message in &mut page {
        if message.image.is_some() {
            message.image = Some(OMITTED_IMAGE.to_owned());
        }
    }
    (page, total)
}

async fn task_read(inner: &Inner, value: &Value) -> Result<Value, OpError> {
    let request: ReadParams = params(value)?;
    let reader = inner.app.state::<codex::Reader>();
    let content = commands::read_any(reader.inner(), request.agent, request.id)
        .await
        .map_err(|message| OpError("NOT_FOUND", message))?;
    let (messages, total) = page_of(content.messages, request.before, request.limit);
    Ok(json!({"messages": messages, "context": content.context, "total": total}))
}

#[derive(Deserialize)]
struct AgentParams {
    agent: Agent,
}

/// Each answer starts a CLI, so a phone refreshing does not start one every time.
async fn agent_info(inner: &Inner, value: &Value) -> Result<Value, OpError> {
    let request: AgentParams = params(value)?;
    let key = agent_key(request.agent);
    {
        let cache = inner.info_cache.lock().await;
        if let Some((at, info)) = cache.get(key).filter(|(at, _)| at.elapsed() < INFO_LIFETIME) {
            let _ = at;
            return Ok(info.clone());
        }
    }
    let reader = inner.app.state::<codex::Reader>();
    let info = commands::read_info(reader.inner(), request.agent).await?;
    let info = serde_json::to_value(info).map_err(|error| error.to_string())?;
    inner.info_cache.lock().await.insert(key, (Instant::now(), info.clone()));
    Ok(info)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendParams {
    agent: Agent,
    task_id: Option<String>,
    cwd: Option<String>,
    prompt: String,
    model: Option<String>,
    effort: Option<String>,
    permission_mode: Option<String>,
}

/// A new task may only start in a folder the user added on the computer.
fn check_new_cwd(cwd: &str, projects: &[String]) -> Result<(), OpError> {
    if cwd == CONVERSATION_CWD || projects.iter().any(|project| project == cwd) {
        return Ok(());
    }
    Err(OpError::not_allowed("That folder has not been added on the computer"))
}

fn check_send(request: &SendParams, projects: &[String]) -> Result<(), OpError> {
    if request.prompt.trim().is_empty() {
        return Err(OpError::bad("There is nothing to send"));
    }
    match (&request.task_id, &request.cwd) {
        (Some(_), None) => Ok(()),
        (None, Some(cwd)) => check_new_cwd(cwd, projects),
        _ => Err(OpError::bad("Give either a task or a folder")),
    }
}

async fn turn_send(inner: &Arc<Inner>, value: &Value) -> Result<Value, OpError> {
    let request: SendParams = params(value)?;
    let (projects, conversation_dir) = inner
        .context
        .lock()
        .map(|context| (context.projects.clone(), context.conversation_dir.clone()))
        .unwrap_or_default();
    check_send(&request, &projects)?;
    let cwd = match request.cwd.as_deref() {
        Some(CONVERSATION_CWD) => Some(conversations::create_dir(conversation_dir.as_deref())?),
        other => other.map(str::to_owned),
    };
    let remote = Remote(inner.clone());
    let app = inner.app.clone();
    let (agent, prompt, is_new) = (request.agent, request.prompt.clone(), request.task_id.is_none());
    let run_holder: Arc<std::sync::Mutex<String>> = Arc::default();
    let holder = run_holder.clone();
    let page_cwd = cwd.clone();
    let page_prompt = prompt.clone();
    // The computer's window shows this turn as well, as if it had been sent from there.
    let page_sink = TurnSink::new(move |event| {
        let run_id = holder.lock().map(|run_id| run_id.clone()).unwrap_or_default();
        app.emit_to(
            "main",
            TURN_EVENT,
            json!({"runId": run_id, "agent": agent, "isNew": is_new, "cwd": page_cwd, "prompt": page_prompt, "event": event}),
        )
        .map_err(|error| error.to_string())
    });
    let (run_id, sink) = remote.track(request.agent, page_sink);
    if let Ok(mut holder) = run_holder.lock() {
        holder.clone_from(&run_id);
    }
    let options = TurnOptions {
        model: request.model,
        effort: request.effort,
        permission_mode: request.permission_mode,
        worktree: false,
        ignore_external_writer: false,
        ..Default::default()
    };
    let task_id = request.task_id;
    let inner_for_turn = inner.clone();
    let id_for_turn = run_id.clone();
    tauri::async_runtime::spawn(async move {
        let result = commands::dispatch_turn(&inner_for_turn.app, agent, task_id, cwd, prompt, Default::default(), options, sink).await;
        Remote(inner_for_turn.clone()).end_run(&id_for_turn, &result);
    });
    Ok(json!({"runId": run_id}))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelParams {
    task_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnswerParams {
    task_id: String,
    request_id: String,
    decision: Decision,
}

async fn dispatch(inner: &Arc<Inner>, op: &str, value: &Value) -> Result<Value, OpError> {
    match op {
        "host.info" => host_info(inner).await,
        "tasks.list" => tasks_list(inner).await,
        "task.read" => task_read(inner, value).await,
        "agent.info" => agent_info(inner, value).await,
        "turn.send" => turn_send(inner, value).await,
        "turn.cancel" => {
            let request: CancelParams = params(value)?;
            commands::cancel_turn(inner.app.clone(), request.task_id).await?;
            Ok(json!({}))
        }
        "request.answer" => {
            let request: AnswerParams = params(value)?;
            inner
                .app
                .state::<runner::Runs>()
                .answer(&request.task_id, &request.request_id, request.decision)
                .map_err(|message| OpError("NOT_FOUND", message))?;
            Remote(inner.clone()).settle(&request.task_id, &request.request_id);
            Ok(json!({}))
        }
        "live.snapshot" => Ok(inner.snapshot()),
        _ => Err(OpError::bad("Unknown operation")),
    }
}

pub(super) async fn handle(inner: Arc<Inner>, request: Value) -> Value {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let op = request.get("op").and_then(Value::as_str).unwrap_or_default().to_owned();
    let value = request.get("p").cloned().unwrap_or_else(|| json!({}));
    match dispatch(&inner, &op, &value).await {
        Ok(result) => json!({"id": id, "ok": true, "r": result}),
        Err(OpError(code, message)) => json!({"id": id, "ok": false, "e": {"code": code, "message": message}}),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions::MessageKind;

    fn send(task_id: Option<&str>, cwd: Option<&str>, permission: Option<&str>) -> SendParams {
        SendParams {
            agent: Agent::Claude,
            task_id: task_id.map(str::to_owned),
            cwd: cwd.map(str::to_owned),
            prompt: "hi".into(),
            model: None,
            effort: None,
            permission_mode: permission.map(str::to_owned),
        }
    }

    #[test]
    fn a_phone_picks_from_the_same_permissions_as_the_computer() {
        let projects = ["/a".to_owned()];
        assert!(check_send(&send(Some("t"), None, Some("acceptEdits")), &projects).is_ok());
        assert!(check_send(&send(Some("t"), None, Some("bypassPermissions")), &projects).is_ok());
    }

    #[test]
    fn a_new_task_starts_only_in_an_added_folder() {
        let projects = ["/a".to_owned()];
        assert!(check_send(&send(None, Some("/a"), None), &projects).is_ok());
        assert!(check_send(&send(None, Some(CONVERSATION_CWD), None), &projects).is_ok());
        assert!(matches!(check_send(&send(None, Some("/etc"), None), &projects), Err(OpError("NOT_ALLOWED", _))));
        assert!(matches!(check_send(&send(None, Some("/a/sub"), None), &projects), Err(OpError("NOT_ALLOWED", _))));
    }

    #[test]
    fn host_projects_follow_the_saved_sidebar_order_including_conversations() {
        let context = Context {
            projects: vec!["/first".into(), "/second".into()],
            project_order: vec!["/second".into(), CONVERSATION_CWD.into(), "/removed".into(), "/first".into()],
            ..Context::default()
        };
        let projects = host_projects(&context);
        assert_eq!(projects.iter().map(|p| p["cwd"].as_str().unwrap()).collect::<Vec<_>>(),
            ["/second", CONVERSATION_CWD, "/first"]);
        assert_eq!(projects[1]["name"], "对话");
    }

    #[test]
    fn projects_without_a_saved_position_come_first_as_in_the_sidebar() {
        let context = Context {
            projects: vec!["/known".into(), "/new".into()],
            project_order: vec![CONVERSATION_CWD.into(), "/known".into()],
            ..Context::default()
        };
        assert_eq!(host_projects(&context).iter().map(|p| p["cwd"].as_str().unwrap()).collect::<Vec<_>>(),
            ["/new", CONVERSATION_CWD, "/known"]);
    }

    #[test]
    fn a_turn_names_either_a_task_or_a_folder() {
        assert!(check_send(&send(None, None, None), &[]).is_err());
        assert!(check_send(&send(Some("t"), Some("/a"), None), &["/a".to_owned()]).is_err());
    }

    fn message(id: usize, image: Option<&str>) -> Message {
        Message {
            id: id.to_string(),
            kind: MessageKind::User,
            text: String::new(),
            tool_name: None,
            tool_use_id: None,
            is_error: false,
            truncated: false,
            timestamp: None,
            image: image.map(str::to_owned),
        }
    }

    #[test]
    fn pages_count_back_from_the_end_and_leave_images_behind() {
        let messages: Vec<Message> = (0..5).map(|id| message(id, (id == 4).then_some("data:image/png;base64,x"))).collect();
        let (page, total) = page_of(messages, None, Some(2));
        assert_eq!(total, 5);
        assert_eq!(page.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["3", "4"]);
        assert_eq!(page[1].image.as_deref(), Some(OMITTED_IMAGE));

        let messages: Vec<Message> = (0..5).map(|id| message(id, None)).collect();
        let (page, _) = page_of(messages, Some(3), Some(100));
        assert_eq!(page.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["0", "1", "2"]);
    }
}

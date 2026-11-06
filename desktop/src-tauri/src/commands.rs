use crate::remote::{self, Remote};
use crate::sessions::Agent;
use crate::{agents, attachments, cli_info, codex, conversations, git_info, pi, queue, runner, sessions, storage, titles, tray, writers};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{ipc::Channel, AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

pub struct StartedAt(pub Instant);

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn list_tasks(window: WebviewWindow, roots: Vec<String>) -> Result<Vec<sessions::TaskSummary>, String> {
    let started = Instant::now();
    let tasks = blocking(move || sessions::list_tasks(&sessions::claude_projects_dir()?, &roots)).await?;
    trace(&window, &format!("list_tasks count={} took_ms={}", tasks.len(), started.elapsed().as_millis()));
    Ok(tasks)
}

#[tauri::command]
pub async fn read_task(id: String) -> Result<sessions::TaskContent, String> {
    blocking(move || {
        let path = sessions::find_task_file(&sessions::claude_projects_dir()?, &id)?;
        sessions::read_task(&path)
    })
    .await
}

#[tauri::command]
pub async fn generate_task_title(
    app: AppHandle, reader: State<'_, codex::Reader>, jobs: State<'_, titles::Jobs>, agent: Agent, id: String,
    model: Option<String>, effort: Option<String>,
) -> Result<String, String> {
    { let store = app.state::<storage::Store>(); store.ensure_writable()?; }
    let _job = jobs.begin(&id)?;
    let content = read_any(reader.inner(), agent, id).await?;
    titles::generate(agent, content.messages, runner::TurnOptions { model, effort, ..Default::default() }).await
}

#[tauri::command]
pub async fn rename_native_task(
    app: AppHandle, reader: State<'_, codex::Reader>, jobs: State<'_, titles::Jobs>, agent: Agent, id: String, title: String,
) -> Result<(), String> {
    { let store = app.state::<storage::Store>(); store.ensure_writable()?; }
    queue::validate_task_id(&id)?;
    titles::validate_name(&title)?;
    let _job = jobs.begin(&id)?;
    match agent {
        Agent::Codex => reader.rename_task(&id, &title).await,
        Agent::Claude => titles::save_name(&app, titles::NameProtocol::Claude, id, title).await,
        Agent::Pi => titles::save_name(&app, titles::NameProtocol::Pi, id, title).await,
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendRequest {
    agent: Agent,
    task_id: Option<String>,
    cwd: Option<String>,
    prompt: String,
    attachment_ids: Vec<String>,
    options: runner::TurnOptions,
}

#[tauri::command]
pub async fn send_turn(
    app: AppHandle,
    remote: State<'_, Remote>,
    attachments: State<'_, attachments::Attachments>,
    request: SendRequest,
    on_event: Channel<runner::TurnEvent>,
) -> Result<(), String> {
    let SendRequest { agent, task_id, cwd, prompt, attachment_ids, options } = request;
    if prompt.trim().is_empty() && attachment_ids.is_empty() {
        return Err("There is nothing to send".into());
    }
    // Check the single-writer lock before consuming draft attachment IDs.
    { let store = app.state::<storage::Store>(); store.ensure_writable()?; }
    let prepared = attachments.take(&attachment_ids)?;
    let page_sink = runner::TurnSink::new(move |event| on_event.send(event).map_err(|error| error.to_string()));
    let (run_id, sink) = remote.track(agent, page_sink);
    let result = queue::dispatch(&app, agent, codex::TurnRequest { task_id, cwd, prompt, attachments: prepared, options }, sink).await;
    remote.end_run(&run_id, &result);
    result
}

#[tauri::command]
pub async fn list_queues(app: AppHandle) -> Result<Vec<queue::Snapshot>, String> {
    queue::access(&app, queue::Store::list).await
}

#[tauri::command]
pub async fn enqueue_turn(
    app: AppHandle, reader: State<'_, codex::Reader>, agent: Agent, task_id: String,
    prompt: String, attachment_ids: Vec<String>, options: runner::TurnOptions,
) -> Result<queue::Snapshot, String> {
    queue::validate_task_id(&task_id)?;
    options.validate_for(agent)?;
    // A new task can receive queued messages before its CLI creates the native file.
    match app.state::<queue::Store>().active_agent(&task_id)? {
        Some(active) if active != agent => return Err("排队消息的 Agent 必须与任务一致".into()),
        Some(_) => {}
        None => {
            let id = task_id.clone();
            match agent {
                Agent::Claude => { blocking(move || sessions::find_task_file(&sessions::claude_projects_dir()?, &id)).await?; }
                Agent::Codex => { reader.task_cwd(&id).await?; }
                Agent::Pi => { blocking(move || pi::find_task_file(&pi::sessions_dir()?, &id)).await?; }
            }
        }
    }
    let attachments = app.state::<attachments::Attachments>();
    let entry = queue::Entry::new(prompt, attachments.capture(&attachment_ids)?, options)?;
    let id = task_id.clone();
    let snapshot = queue::access(&app, move |store| store.enqueue(&id, agent, entry)).await?;
    attachments.release(&attachment_ids);
    queue::announce(&app, &snapshot);
    queue::kick(app, task_id);
    Ok(snapshot)
}

#[tauri::command]
pub async fn edit_queued_turn(app: AppHandle, task_id: String, entry_id: String, prompt: String) -> Result<queue::Snapshot, String> {
    let id = task_id.clone();
    let snapshot = queue::access(&app, move |store| store.edit(&id, &entry_id, prompt)).await?;
    queue::announce(&app, &snapshot);
    queue::kick(app, task_id);
    Ok(snapshot)
}

#[tauri::command]
pub async fn remove_queued_turn(app: AppHandle, task_id: String, entry_id: String) -> Result<queue::Snapshot, String> {
    let id = task_id.clone();
    let snapshot = queue::access(&app, move |store| store.remove(&id, &entry_id)).await?;
    queue::announce(&app, &snapshot);
    queue::kick(app, task_id);
    Ok(snapshot)
}

#[tauri::command]
pub async fn reorder_queued_turn(app: AppHandle, task_id: String, entry_id: String, target_index: usize) -> Result<queue::Snapshot, String> {
    let id = task_id.clone();
    let snapshot = queue::access(&app, move |store| store.reorder(&id, &entry_id, target_index)).await?;
    queue::announce(&app, &snapshot);
    queue::kick(app, task_id);
    Ok(snapshot)
}

#[tauri::command]
pub async fn resume_queue(app: AppHandle, task_id: String) -> Result<queue::Snapshot, String> {
    let id = task_id.clone();
    let snapshot = queue::access(&app, move |store| store.resume(&id)).await?;
    queue::announce(&app, &snapshot);
    queue::kick(app, task_id);
    Ok(snapshot)
}

#[tauri::command]
pub async fn set_queue_lock(app: AppHandle, task_id: String, owner: String, entry_id: Option<String>, locked: bool) -> Result<(), String> {
    let id = task_id.clone();
    queue::access(&app, move |store| store.set_lock(&id, owner, entry_id, locked)).await?;
    if !locked { queue::kick(app, task_id); }
    Ok(())
}

/// Runs the native dialog here, so the page never supplies a path.
#[tauri::command]
pub async fn pick_attachments(app: AppHandle) -> Result<attachments::AddResult, String> {
    blocking(move || {
        let picked = app.dialog().file().blocking_pick_files().unwrap_or_default();
        let paths: Vec<_> = picked.into_iter().filter_map(|file| file.into_path().ok()).collect();
        Ok(app.state::<attachments::Attachments>().add_paths(&paths))
    })
    .await
}

/// Runs the native dialog here, for the same reason as attachments.
#[tauri::command]
pub async fn pick_project(app: AppHandle) -> Result<Option<String>, String> {
    blocking(move || {
        let Some(picked) = app.dialog().file().blocking_pick_folder() else {
            return Ok(None);
        };
        let path = picked.into_path().map_err(|error| error.to_string())?;
        let path = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
}

#[tauri::command]
pub async fn git_branch(cwd: String) -> Result<Option<String>, String> {
    blocking(move || Ok(git_info::current_branch(std::path::Path::new(&cwd)))).await
}

/// Opens the folder recorded in the task's own file, never a path from the page.
#[tauri::command]
pub async fn reveal_task_folder(reader: State<'_, codex::Reader>, agent: Agent, id: String) -> Result<(), String> {
    let cwd = match agent {
        Agent::Claude => {
            blocking(move || {
                let path = sessions::find_task_file(&sessions::claude_projects_dir()?, &id)?;
                sessions::read_task_cwd(&path).ok_or_else(|| "The task has no working directory".to_owned())
            })
            .await?
        }
        Agent::Codex => reader.task_cwd(&id).await?,
        Agent::Pi => blocking(move || pi::task_cwd(&id)).await?,
    };
    std::process::Command::new("open")
        .arg(cwd)
        .status()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn list_codex_tasks(
    reader: State<'_, codex::Reader>,
    roots: Vec<String>,
    conversation_roots: Vec<String>,
) -> Result<Vec<sessions::TaskSummary>, String> {
    let cwds = blocking(move || Ok(conversations::expand_roots(roots, &conversation_roots))).await?;
    reader.list_tasks(&cwds).await
}

/// Folders with tasks, offered in settings. Nothing is listed until the user adds a project.
#[tauri::command]
pub async fn discover_projects(reader: State<'_, codex::Reader>) -> Result<Vec<sessions::DiscoveredProject>, String> {
    let mut found = blocking(|| Ok(sessions::discover_projects(&sessions::claude_projects_dir()?))).await?;
    // Codex being unavailable should not hide what Claude found.
    found.extend(reader.discover_projects().await.unwrap_or_default());
    found.extend(blocking(|| Ok(pi::discover_projects(&pi::sessions_dir()?))).await.unwrap_or_default());
    blocking(move || Ok(conversations::usable_projects(found, &conversations::home_dir()?))).await
}

#[tauri::command]
pub fn default_conversation_dir(store: State<'_, storage::Store>) -> String {
    store.root().join("conversations").to_string_lossy().into_owned()
}

#[tauri::command]
pub async fn create_conversation_dir(store: State<'_, storage::Store>, base: Option<String>) -> Result<String, String> {
    store.ensure_writable()?;
    let base = base.unwrap_or_else(|| store.root().join("conversations").to_string_lossy().into_owned());
    blocking(move || conversations::create_dir(Some(&base))).await
}

/// Changes when a task's file changes, so a task open elsewhere reloads only when it needs to.
#[tauri::command]
pub async fn task_stamp(reader: State<'_, codex::Reader>, agent: Agent, id: String) -> Result<Option<String>, String> {
    let path = match agent {
        Agent::Claude => Some(blocking(move || sessions::find_task_file(&sessions::claude_projects_dir()?, &id)).await?),
        Agent::Codex => reader.task_file(&id).await,
        Agent::Pi => Some(blocking(move || pi::find_task_file(&pi::sessions_dir()?, &id)).await?),
    };
    Ok(path.and_then(|path| conversations::file_stamp(&path)))
}

#[tauri::command]
pub async fn list_pi_tasks(roots: Vec<String>, conversation_roots: Vec<String>) -> Result<Vec<sessions::TaskSummary>, String> {
    blocking(move || {
        let mut all = roots;
        all.extend(conversation_roots);
        Ok(pi::list_tasks(&pi::sessions_dir()?, &all))
    })
    .await
}

#[tauri::command]
pub async fn read_pi_task(id: String) -> Result<sessions::TaskContent, String> {
    blocking(move || pi::read_task(&pi::find_task_file(&pi::sessions_dir()?, &id)?)).await
}

#[tauri::command]
pub async fn pi_info() -> Result<cli_info::CliInfo, String> {
    pi::info().await
}

#[tauri::command]
pub async fn read_codex_task(reader: State<'_, codex::Reader>, id: String) -> Result<sessions::TaskContent, String> {
    reader.read_task(&id).await
}

pub(crate) async fn read_any(reader: &codex::Reader, agent: Agent, id: String) -> Result<sessions::TaskContent, String> {
    match agent {
        Agent::Claude => read_task(id).await,
        Agent::Codex => reader.read_task(&id).await,
        Agent::Pi => read_pi_task(id).await,
    }
}

pub(crate) async fn read_info(reader: &codex::Reader, agent: Agent) -> Result<cli_info::CliInfo, String> {
    match agent {
        Agent::Claude => cli_info::read().await,
        Agent::Codex => reader.info().await,
        Agent::Pi => pi::info().await,
    }
}

/// One agent being unavailable should not hide the others.
pub(crate) async fn collect_tasks(reader: &codex::Reader, projects: Vec<String>, conversations_dirs: Vec<String>) -> Vec<sessions::TaskSummary> {
    let mut all_roots = projects.clone();
    all_roots.extend(conversations_dirs.clone());
    let roots = all_roots.clone();
    let mut tasks = blocking(move || sessions::list_tasks(&sessions::claude_projects_dir()?, &roots)).await.unwrap_or_default();
    let cwds = blocking(move || Ok(conversations::expand_roots(projects, &conversations_dirs))).await.unwrap_or_default();
    tasks.extend(reader.list_tasks(&cwds).await.unwrap_or_default());
    tasks.extend(blocking(move || Ok(pi::list_tasks(&pi::sessions_dir()?, &all_roots))).await.unwrap_or_default());
    tasks
}

#[tauri::command]
pub async fn codex_info(reader: State<'_, codex::Reader>) -> Result<cli_info::CliInfo, String> {
    reader.info().await
}

#[tauri::command]
pub fn update_tray(app: AppHandle, update: tray::TrayUpdate) -> Result<(), String> {
    tray::update(&app, update)
}

#[tauri::command]
pub fn tray_summary(state: State<'_, tray::TrayState>) -> serde_json::Value {
    tray::current_summary(state.inner())
}

#[tauri::command]
pub fn resize_tray_panel(app: AppHandle, height: f64) -> Result<(), String> {
    tray::resize_panel(&app, height)
}

#[tauri::command]
pub fn tray_panel_action(app: AppHandle, action: String, task_id: Option<String>) -> Result<(), String> {
    tray::panel_action(&app, &action, task_id.as_deref())
}

#[tauri::command]
pub fn notify_user(app: AppHandle, title: String, body: String) -> Result<(), String> {
    tray::notify(&app, &title, &body)
}

#[tauri::command]
pub async fn install_agent(jobs: State<'_, agents::Jobs>, command: String, on_event: Channel<agents::JobEvent>) -> Result<(), String> {
    agents::install(jobs.inner(), &command, on_event).await
}

#[tauri::command]
pub async fn login_agent(jobs: State<'_, agents::Jobs>, command: String, on_event: Channel<agents::JobEvent>) -> Result<(), String> {
    agents::login(jobs.inner(), &command, on_event).await
}

#[tauri::command]
pub fn stop_agent_job(jobs: State<'_, agents::Jobs>) {
    jobs.stop();
}

/// Tasks open in another process. Tandem's own running turns are left out. Codex's lock only says
/// a thread is open, so its file has to say whether a turn is under way.
pub(crate) async fn collect_writers(runs: &runner::Runs, reader: &codex::Reader) -> Result<Vec<writers::ExternalWriter>, String> {
    let mut found = blocking(runner::external_writers).await?;
    found.retain(|writer| !runs.is_running(&writer.task_id));
    for writer in found.iter_mut().filter(|writer| !writer.can_override) {
        if let Some(path) = reader.task_file(&writer.task_id).await {
            writer.is_busy = blocking(move || Ok(writers::codex_turn_running(&path))).await?;
        }
    }
    Ok(found)
}

#[tauri::command]
pub async fn external_writers(
    runs: State<'_, runner::Runs>,
    reader: State<'_, codex::Reader>,
) -> Result<Vec<writers::ExternalWriter>, String> {
    collect_writers(runs.inner(), reader.inner()).await
}

/// Only runs when the settings page asks, because it starts each CLI once.
#[tauri::command]
pub async fn agent_status() -> Vec<agents::AgentStatus> {
    agents::read().await
}

#[tauri::command]
pub fn add_pasted_image(
    attachments: State<'_, attachments::Attachments>,
    data: String,
) -> Result<attachments::Attachment, String> {
    attachments.add_pasted_image(&data)
}

#[tauri::command]
pub fn remove_attachment(attachments: State<'_, attachments::Attachments>, id: String) {
    attachments.remove(&id);
}

#[tauri::command]
pub fn answer_request(
    runs: State<'_, runner::Runs>,
    remote: State<'_, Remote>,
    task_id: String,
    request_id: String,
    decision: runner::Decision,
) -> Result<(), runner::AnswerError> {
    runs.answer_checked(&task_id, &request_id, decision)?;
    remote.settle(&task_id, &request_id);
    Ok(())
}

#[tauri::command]
pub async fn cli_info() -> Result<cli_info::CliInfo, String> {
    cli_info::read().await
}

#[tauri::command]
pub async fn cancel_turn(app: AppHandle, task_id: String) -> Result<(), String> {
    let id = task_id.clone();
    let paused = queue::access(&app, move |store| store.pause(&id)).await;
    app.state::<runner::Runs>().cancel(&task_id);
    if let Some(snapshot) = paused? { queue::announce(&app, &snapshot); }
    Ok(())
}

#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only http and https links can be opened".into());
    }
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn app_ready(window: WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())?;
    trace(&window, "TANDEM_READY");
    Ok(())
}

/// Startup timing for measurements. Silent unless `TANDEM_TRACE` is set.
fn trace(window: &WebviewWindow, label: &str) {
    if std::env::var_os("TANDEM_TRACE").is_none() {
        return;
    }
    let epoch_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default();
    let since_main = window.state::<StartedAt>().0.elapsed().as_millis();
    eprintln!("{label} epoch_ms={epoch_ms} since_main_ms={since_main}");
}

#[tauri::command]
pub fn remote_state(remote: State<'_, Remote>) -> remote::RemoteState {
    remote.state()
}

#[tauri::command]
pub async fn remote_configure(app: AppHandle, remote: State<'_, Remote>, enabled: bool, relay_url: String, host_token: Option<String>) -> Result<(), String> {
    let remote = remote.inner().clone();
    blocking(move || {
        let store = app.state::<storage::Store>();
        store.ensure_writable()?;
        remote.configure(enabled, relay_url, host_token)
    }).await
}

#[tauri::command]
pub async fn remote_begin_pairing(store: State<'_, storage::Store>, remote: State<'_, Remote>) -> Result<(), String> {
    store.ensure_writable()?;
    remote.begin_pairing().await
}

#[tauri::command]
pub fn remote_cancel_pairing(remote: State<'_, Remote>) {
    remote.cancel_pairing();
}

#[tauri::command]
pub async fn remote_revoke(app: AppHandle, remote: State<'_, Remote>, client_id: String) -> Result<(), String> {
    let remote = remote.inner().clone();
    blocking(move || {
        let store = app.state::<storage::Store>();
        store.ensure_writable()?;
        remote.revoke(&client_id)
    }).await
}

#[tauri::command]
pub fn preferences(store: State<'_, storage::Store>) -> storage::Snapshot {
    store.snapshot()
}

#[tauri::command]
pub fn set_system_language(window: WebviewWindow, store: State<'_, storage::Store>, remote: State<'_, Remote>, language: String) -> Result<(), String> {
    if window.label() != "main" { return Err("系统语言由主窗口提供".into()); }
    store.set_system_language(language)?;
    remote.update_context(store.remote_context());
    Ok(())
}

#[tauri::command]
pub async fn update_preferences(app: AppHandle, window: WebviewWindow, target: String, patch: serde_json::Map<String, serde_json::Value>) -> Result<storage::Snapshot, String> {
    if window.label() != "main" { return Err("请在主窗口修改设置".into()); }
    let writer = app.clone();
    let result = blocking(move || writer.state::<storage::Store>().update(&target, patch)).await;
    storage::publish(&app);
    result
}

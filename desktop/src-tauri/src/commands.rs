use crate::{agents, attachments, cli_info, git_info, runner, sessions};
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
pub async fn list_tasks(window: WebviewWindow) -> Result<Vec<sessions::TaskSummary>, String> {
    let started = Instant::now();
    let tasks = blocking(|| sessions::list_tasks(&sessions::claude_projects_dir()?)).await?;
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
pub async fn send_turn(
    runs: State<'_, runner::Runs>,
    task_id: Option<String>,
    cwd: Option<String>,
    attachments: State<'_, attachments::Attachments>,
    prompt: String,
    attachment_ids: Vec<String>,
    options: runner::TurnOptions,
    on_event: Channel<runner::TurnEvent>,
) -> Result<(), String> {
    if prompt.trim().is_empty() && attachment_ids.is_empty() {
        return Err("There is nothing to send".into());
    }
    let prepared = attachments.take(&attachment_ids)?;
    runner::send_turn(runs.inner(), task_id, cwd, prompt, prepared, options, on_event).await
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
pub async fn reveal_task_folder(id: String) -> Result<(), String> {
    blocking(move || {
        let path = sessions::find_task_file(&sessions::claude_projects_dir()?, &id)?;
        let cwd = sessions::read_task_cwd(&path).ok_or("The task has no working directory")?;
        std::process::Command::new("open")
            .arg(cwd)
            .status()
            .map_err(|error| error.to_string())?;
        Ok(())
    })
    .await
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
    task_id: String,
    request_id: String,
    decision: runner::Decision,
) -> Result<(), String> {
    runs.answer(&task_id, &request_id, decision)
}

#[tauri::command]
pub async fn cli_info() -> Result<cli_info::CliInfo, String> {
    cli_info::read().await
}

#[tauri::command]
pub fn cancel_turn(runs: State<'_, runner::Runs>, task_id: String) {
    runs.cancel(&task_id);
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

use crate::{runner, sessions};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{ipc::Channel, Manager, State, WebviewWindow};

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
pub async fn read_task(id: String) -> Result<Vec<sessions::Message>, String> {
    blocking(move || {
        let path = sessions::find_task_file(&sessions::claude_projects_dir()?, &id)?;
        sessions::read_messages(&path)
    })
    .await
}

#[tauri::command]
pub async fn send_turn(
    runs: State<'_, runner::Runs>,
    task_id: Option<String>,
    cwd: Option<String>,
    prompt: String,
    on_event: Channel<runner::TurnEvent>,
) -> Result<(), String> {
    runner::send_turn(runs.inner(), task_id, cwd, prompt, on_event).await
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

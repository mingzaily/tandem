//! Explicit task archive actions. Codex owns native state; other CLIs keep their files in place.

use crate::{codex, pi, queue, runner, sessions, storage};
use crate::sessions::Agent;
use tauri::{AppHandle, Manager};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveResult {
    pub task_id: String,
    pub agent: Agent,
    pub archived: bool,
    pub preferences: storage::Snapshot,
}

fn preflight(agent: Agent, id: &str) -> Result<(), String> {
    if runner::external_writers()?.iter().any(|writer| writer.task_id == id) {
        return Err("任务在其他进程中打开，请关闭该任务后再整理".into());
    }
    match agent {
        Agent::Claude => { sessions::find_task_file(&sessions::claude_projects_dir()?, id)?; }
        Agent::Pi => { pi::find_task_file(&pi::sessions_dir()?, id)?; }
        Agent::Codex => {} // The official metadata read validates its native identity.
    }
    Ok(())
}

pub async fn set_archived(app: &AppHandle, reader: &codex::Reader, agent: Agent, id: String, archived: bool) -> Result<ArchiveResult, String> {
    queue::validate_task_id(&id)?;
    let _activity = crate::updater::activity()?;
    app.state::<storage::Store>().ensure_writable()?;
    let _guard = queue::archive_guard(app, id.clone(), agent).await?;
    if app.state::<runner::Runs>().is_running(&id) { return Err("任务正在运行，请结束当前工作后再整理".into()); }
    let task_id = id.clone();
    tauri::async_runtime::spawn_blocking(move || preflight(agent, &task_id)).await.map_err(|error| error.to_string())??;
    if agent == Agent::Codex { reader.set_archived(&id, archived).await?; }
    let owner = app.clone();
    let task_id = id.clone();
    let saved = tauri::async_runtime::spawn_blocking(move || owner.state::<storage::Store>().set_task_archived(&task_id, archived, agent == Agent::Codex))
        .await.map_err(|error| error.to_string())?;
    storage::publish(app);
    let preferences = saved.map_err(|error| {
        if agent == Agent::Codex {
            let action = if archived { "归档" } else { "恢复" };
            format!("Codex 已完成{action}，Tandem 列表状态保存失败：{error}。请重试完成列表整理。")
        } else { error }
    })?;
    Ok(ArchiveResult { task_id: id, agent, archived, preferences })
}

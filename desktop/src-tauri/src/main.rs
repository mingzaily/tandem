#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agents;
mod attachments;
mod cli_info;
mod commands;
#[cfg(debug_assertions)]
mod harness;
mod git_info;
mod login_env;
mod runner;
mod sessions;

use std::time::{Duration, Instant};
use tauri::Manager;

fn main() {
    let started_at = Instant::now();
    tauri::Builder::default()
        // No capability grants the page this plugin. Only the backend opens the dialog.
        .plugin(tauri_plugin_dialog::init())
        .manage(runner::Runs::default())
        .manage(attachments::Attachments::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(drag) = event {
                attachments::on_drag(window.app_handle(), drag);
            }
        })
        .manage(commands::StartedAt(started_at))
        .invoke_handler(tauri::generate_handler![
            commands::list_tasks,
            commands::read_task,
            commands::send_turn,
            commands::cancel_turn,
            commands::answer_request,
            commands::cli_info,
            commands::pick_attachments,
            commands::pick_project,
            commands::git_branch,
            commands::reveal_task_folder,
            commands::agent_status,
            commands::add_pasted_image,
            commands::remove_attachment,
            commands::open_external,
            commands::app_ready,
        ])
        .setup(|app| {
            // The page shows the window once it has painted. This covers a page that fails to load.
            let window = app.get_webview_window("main").expect("main window");
            #[cfg(debug_assertions)]
            harness::start(window.clone());
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(3)).await;
                let _ = window.show();
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Tandem");
}

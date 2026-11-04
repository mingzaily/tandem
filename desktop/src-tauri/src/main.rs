#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
#[cfg(debug_assertions)]
mod harness;
mod login_env;
mod runner;
mod sessions;

use std::time::{Duration, Instant};
use tauri::Manager;

fn main() {
    let started_at = Instant::now();
    tauri::Builder::default()
        .manage(runner::Runs::default())
        .manage(commands::StartedAt(started_at))
        .invoke_handler(tauri::generate_handler![
            commands::list_tasks,
            commands::read_task,
            commands::send_turn,
            commands::cancel_turn,
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

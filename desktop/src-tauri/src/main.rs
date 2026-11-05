#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agents;
mod attachments;
mod cli_info;
mod codex;
mod commands;
mod conversations;
#[cfg(debug_assertions)]
mod harness;
mod git_info;
mod login_env;
mod pi;
mod remote;
mod runner;
mod sessions;
mod tray;
mod writers;

use std::time::{Duration, Instant};
use tauri::Manager;

fn main() {
    let started_at = Instant::now();
    tauri::Builder::default()
        // No capability grants the page this plugin. Only the backend opens the dialog.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(runner::Runs::default())
        .manage(attachments::Attachments::default())
        .manage(codex::Reader::default())
        .manage(agents::Jobs::default())
        .manage(tray::TrayState::default())
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::DragDrop(drag) => attachments::on_drag(window.app_handle(), drag),
            // Running turns and notifications carry on with the window out of the way.
            tauri::WindowEvent::Focused(false) if window.label() == tray::PANEL_LABEL => tray::on_panel_blur(window.app_handle()),
            tauri::WindowEvent::CloseRequested { api, .. }
                if window.label() == "main" && tray::should_hide_on_close(window.app_handle()) =>
            {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
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
            commands::install_agent,
            commands::login_agent,
            commands::stop_agent_job,
            commands::external_writers,
            commands::update_tray,
            commands::tray_summary,
            commands::resize_tray_panel,
            commands::tray_panel_action,
            commands::notify_user,
            commands::set_keep_running,
            commands::list_codex_tasks,
            commands::list_pi_tasks,
            commands::read_pi_task,
            commands::pi_info,
            commands::discover_projects,
            commands::default_conversation_dir,
            commands::create_conversation_dir,
            commands::task_stamp,
            commands::read_codex_task,
            commands::codex_info,
            commands::add_pasted_image,
            commands::remove_attachment,
            commands::open_external,
            commands::app_ready,
            commands::remote_state,
            commands::remote_configure,
            commands::remote_begin_pairing,
            commands::remote_cancel_pairing,
            commands::remote_revoke,
            commands::remote_update_context,
        ])
        .setup(|app| {
            tray::create(app.handle())?;
            app.manage(remote::Remote::new(app.handle().clone()).map_err(std::io::Error::other)?);
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
        .build(tauri::generate_context!())
        .expect("failed to start Tandem")
        .run(|app, event| {
            // Clicking the Dock icon brings back a window that was closed to the menu bar.
            if let tauri::RunEvent::Reopen { .. } = event {
                tray::show_window(app);
            }
        });
}

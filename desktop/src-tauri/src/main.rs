#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agents;
mod agent_resources;
mod attachments;
mod cli_info;
mod codex;
mod commands;
mod conversations;
#[cfg(debug_assertions)]
mod harness;
mod git_info;
mod login_env;
mod local_files;
mod pi;
mod queue;
mod remote;
mod runner;
mod sessions;
mod storage;
mod tray;
mod titles;
mod writers;

use std::time::{Duration, Instant};
use tauri::Manager;

fn main() {
    let started_at = Instant::now();
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("queue-image", |context, request, responder| {
            let app = context.app_handle().clone();
            let path = request.uri().path().to_owned();
            tauri::async_runtime::spawn_blocking(move || {
                let result = (|| {
                    let storage = app.state::<storage::Store>();
                    storage.ensure_writable()?;
                    app.state::<queue::Store>().image(&path)
                })();
                let (status, media_type, body) = match result {
                    Ok((media_type, bytes)) => (200, media_type, bytes),
                    Err(error) => (404, "text/plain; charset=utf-8", error.into_bytes()),
                };
                responder.respond(tauri::http::Response::builder().status(status)
                    .header("Content-Type", media_type).header("Cache-Control", "no-store")
                    .body(body).expect("fixed image response headers are valid"));
            });
        })
        // No capability grants the page this plugin. Only the backend opens the dialog.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(runner::Runs::default())
        .manage(attachments::Attachments::default())
        .manage(codex::Reader::default())
        .manage(agents::Jobs::default())
        .manage(tray::TrayState::default())
        .manage(titles::Jobs::default())
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
            commands::generate_task_title,
            commands::rename_native_task,
            commands::send_turn,
            commands::list_queues,
            commands::enqueue_turn,
            commands::edit_queued_turn,
            commands::remove_queued_turn,
            commands::reorder_queued_turn,
            commands::resume_queue,
            commands::set_queue_lock,
            commands::cancel_turn,
            commands::answer_request,
            commands::cli_info,
            commands::pick_attachments,
            commands::pick_project,
            commands::git_branch,
            commands::reveal_task_folder,
            commands::resolve_task_path,
            commands::open_task_path,
            commands::agent_status,
            commands::agent_resources,
            commands::install_agent,
            commands::login_agent,
            commands::stop_agent_job,
            commands::external_writers,
            commands::update_tray,
            commands::tray_summary,
            commands::resize_tray_panel,
            commands::tray_panel_action,
            commands::notify_user,
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
            commands::preferences,
            commands::update_preferences,
            commands::set_system_language,
        ])
        .setup(|app| {
            let root = conversations::home_dir().map_err(std::io::Error::other)?.join(".tandem");
            #[cfg(debug_assertions)]
            let root = std::env::var_os("TANDEM_DRIVE_DATA_DIR").map(std::path::PathBuf::from).unwrap_or(root);
            let store = storage::Store::open(root);
            let preferences = store.snapshot();
            let script = preferences.initialization_script();
            let theme = preferences.native_theme();
            let queue_dir = store.root().join("queues");
            #[cfg(debug_assertions)]
            let queue_dir = std::env::var_os("TANDEM_DRIVE_QUEUE_DIR").map(std::path::PathBuf::from).unwrap_or(queue_dir);
            app.manage(store);
            app.manage(queue::Store::new(queue_dir));
            tray::create(app.handle())?;
            app.manage(remote::Remote::new(app.handle().clone()).map_err(std::io::Error::other)?);
            // The page shows the window once it has painted. This covers a page that fails to load.
            let config = app.config().app.windows.iter().find(|window| window.label == "main").expect("main window config");
            let window = tauri::WebviewWindowBuilder::from_config(app, config)?.initialization_script(script).theme(theme).build()?;
            storage::publish(app.handle());
            storage::watch(app.handle().clone());
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

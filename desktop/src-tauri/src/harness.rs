//! Debug builds only: drives the page without taking over the mouse or keyboard.
//! `TANDEM_DRIVE_SCRIPT=<file>` runs a script in the page. The window floats above others so
//! macOS keeps painting it, because a covered webview is suspended and draws nothing.
//! `TANDEM_DRIVE_ATTACH=<path>:<path>` delivers files the way a window drop does.
//! `TANDEM_DRIVE_PANEL=1` opens the menu bar panel, because a test cannot click the icon.
//! `TANDEM_DRIVE_PANEL_SCRIPT=<file>` drives that panel through its page, using the same watcher.
//! `TANDEM_DRIVE_CLOSE=<seconds>` asks the main window to close, as its red button does.
//! `TANDEM_DRIVE_PAIR_FILE=<path>` writes the pairing text there, and `TANDEM_DRIVE_PAIR_ALLOW=1`
//! answers the pairing dialog, which a test cannot click (see `remote`).

use std::time::Duration;
use tauri::{Listener, Manager, WebviewWindow};

pub fn start(window: WebviewWindow) {
    let Ok(path) = std::env::var("TANDEM_DRIVE_SCRIPT") else {
        return;
    };
    if let Some(report) = std::env::var_os("TANDEM_DRIVE_REPORT") {
        window.app_handle().listen("drive-report", move |event| {
            let path = std::path::PathBuf::from(&report);
            let payload = event.payload().to_owned();
            tauri::async_runtime::spawn_blocking(move || {
                use std::io::Write;
                let result = std::fs::OpenOptions::new().create(true).append(true).open(path)
                    .and_then(|mut file| writeln!(file, "{payload}"));
                if let Err(error) = result { eprintln!("drive report failed: {error}"); }
            });
        });
    }
    let _ = window.set_always_on_top(true);
    let _ = window.center();
    if let Some(seconds) = std::env::var("TANDEM_DRIVE_CLOSE").ok().and_then(|value| value.parse().ok()) {
        let closing = window.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(seconds)).await;
            let _ = closing.close();
        });
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(1)).await;
        let watch = std::env::var_os("TANDEM_DRIVE_WATCH").is_some();
        if std::env::var_os("TANDEM_DRIVE_PANEL").is_some() {
            let app = window.app_handle().clone();
            let opener = app.clone();
            let _ = app.run_on_main_thread(move || {
                match crate::tray::show_panel_for_test(&opener) {
                    Ok(panel) => {
                        if let Ok(path) = std::env::var("TANDEM_DRIVE_PANEL_SCRIPT") {
                            tauri::async_runtime::spawn(async move {
                                tokio::time::sleep(Duration::from_secs(1)).await;
                                drive_script(panel, path, watch).await;
                            });
                        }
                    }
                    Err(error) => eprintln!("panel failed: {error}"),
                }
            });
        }
        if let Ok(paths) = std::env::var("TANDEM_DRIVE_ATTACH") {
            let app = window.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(8)).await;
                crate::attachments::add_and_announce(app, std::env::split_paths(&paths).collect());
            });
        }
        drive_script(window, path, watch).await;
    });
}

async fn drive_script(window: WebviewWindow, path: String, watch: bool) {
    let mut previous = None;
    loop {
        let file = path.clone();
        match tauri::async_runtime::spawn_blocking(move || std::fs::read_to_string(file)).await {
            Ok(Ok(script)) => {
                if previous.as_ref() != Some(&script) {
                    if let Err(error) = window.eval(&script) { eprintln!("drive script failed: {error}"); }
                    previous = Some(script);
                }
            }
            Ok(Err(error)) => eprintln!("cannot read drive script {path}: {error}"),
            Err(error) => eprintln!("drive script reader failed: {error}"),
        }
        if !watch { break; }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

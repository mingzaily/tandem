//! Debug builds only: drives the page without taking over the mouse or keyboard.
//! `TANDEM_DRIVE_SCRIPT=<file>` runs a script in the page. The window floats above others so
//! macOS keeps painting it, because a covered webview is suspended and draws nothing.
//! `TANDEM_DRIVE_ATTACH=<path>:<path>` delivers files the way a window drop does.
//! `TANDEM_DRIVE_PANEL=1` opens the menu bar panel, because a test cannot click the icon.
//! `TANDEM_DRIVE_CLOSE=<seconds>` asks the main window to close, as its red button does.
//! `TANDEM_DRIVE_PAIR_FILE=<path>` writes the pairing text there, and `TANDEM_DRIVE_PAIR_ALLOW=1`
//! answers the pairing dialog, which a test cannot click (see `remote`).

use std::time::Duration;
use tauri::{Manager, WebviewWindow};

pub fn start(window: WebviewWindow) {
    let Ok(path) = std::env::var("TANDEM_DRIVE_SCRIPT") else {
        return;
    };
    let _ = window.set_always_on_top(true);
    if let Some(seconds) = std::env::var("TANDEM_DRIVE_CLOSE").ok().and_then(|value| value.parse().ok()) {
        let closing = window.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(seconds)).await;
            let _ = closing.close();
        });
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(1)).await;
        if std::env::var_os("TANDEM_DRIVE_PANEL").is_some() {
            let app = window.app_handle().clone();
            let opener = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Err(error) = crate::tray::show_panel_for_test(&opener) {
                    eprintln!("panel failed: {error}");
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
        match std::fs::read_to_string(&path) {
            Ok(script) => {
                if let Err(error) = window.eval(&script) {
                    eprintln!("drive script failed: {error}");
                }
            }
            Err(error) => eprintln!("cannot read drive script {path}: {error}"),
        }
    });
}

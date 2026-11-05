//! Debug builds only: drives the page without taking over the mouse or keyboard.
//! `TANDEM_DRIVE_SCRIPT=<file>` runs a script in the page. The window floats above others so
//! macOS keeps painting it, because a covered webview is suspended and draws nothing.
//! `TANDEM_DRIVE_ATTACH=<path>:<path>` delivers files the way a window drop does.

use std::time::Duration;
use tauri::{Manager, WebviewWindow};

pub fn start(window: WebviewWindow) {
    let Ok(path) = std::env::var("TANDEM_DRIVE_SCRIPT") else {
        return;
    };
    let _ = window.set_always_on_top(true);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(1)).await;
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

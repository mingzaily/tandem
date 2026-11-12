//! The menu bar icon and its panel: what is running, how much plan is left, and a way back.
//! The panel is its own small window, made on first use so it costs nothing until then. The main
//! page sends the summary, because it already knows the titles and the usage.

use serde::Deserialize;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::image::Image;
use tauri::tray::{MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::utils::config::WindowEffectsConfig;
use tauri::utils::{WindowEffect, WindowEffectState};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Rect, WebviewUrl, WebviewWindowBuilder, Wry};
use tauri_plugin_notification::NotificationExt;

const TRAY_ID: &str = "main";
pub const PANEL_LABEL: &str = "tray-panel";
const PANEL_WIDTH: f64 = 320.0;
const PANEL_MIN_HEIGHT: f64 = 120.0;
const PANEL_MAX_HEIGHT: f64 = 560.0;
const PANEL_RADIUS: f64 = 20.0;
const PANEL_GAP: f64 = 4.0;
/// A click on the icon first takes focus from an open panel, which hides it. Without this the
/// same click would open it straight back up.
const REOPEN_GUARD: Duration = Duration::from_millis(250);
pub const OPEN_TASK_EVENT: &str = "tray-open-task";
const OPEN_SETTINGS_EVENT: &str = "tray-open-settings";
const REFRESH_EVENT: &str = "tray-refresh";
/// Lets the main page read usage again when what it has is old.
const PANEL_OPENED_EVENT: &str = "tray-panel-opened";
const SUMMARY_EVENT: &str = "tray-summary";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayUpdate {
    /// Handed to the panel as it is.
    summary: Value,
}

pub struct TrayState {
    keep_running: AtomicBool,
    summary: Mutex<Value>,
    hidden_at: Mutex<Option<Instant>>,
}

impl Default for TrayState {
    fn default() -> Self {
        Self { keep_running: AtomicBool::new(true), summary: Mutex::new(Value::Null), hidden_at: Mutex::new(None) }
    }
}

pub fn set_keep_running(state: &TrayState, value: bool) {
    state.keep_running.store(value, Ordering::Relaxed);
}

pub fn should_hide_on_close(app: &AppHandle) -> bool {
    app.state::<TrayState>().keep_running.load(Ordering::Relaxed)
}

pub fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn panel_window(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    if let Some(panel) = app.get_webview_window(PANEL_LABEL) {
        return Ok(panel);
    }
    let preferences = app.state::<crate::storage::Store>().snapshot();
    WebviewWindowBuilder::new(app, PANEL_LABEL, WebviewUrl::App("index.html?panel=tray".into()))
        .initialization_script(preferences.initialization_script())
        .theme(preferences.native_theme())
        .title("Tandem")
        .inner_size(PANEL_WIDTH, PANEL_MIN_HEIGHT)
        .decorations(false)
        .transparent(true)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible(false)
        .effects(WindowEffectsConfig {
            effects: vec![WindowEffect::Popover],
            state: Some(WindowEffectState::Active),
            radius: Some(PANEL_RADIUS),
            color: None,
            interactive: false,
        })
        .build()
}

/// Under the icon, kept inside the screen the icon is on.
fn panel_position(app: &AppHandle, panel: &tauri::WebviewWindow, icon: &Rect) -> tauri::Result<PhysicalPosition<f64>> {
    let scale = panel.scale_factor()?;
    let icon_position = icon.position.to_physical::<f64>(scale);
    let icon_size = icon.size.to_physical::<f64>(scale);
    let width = PANEL_WIDTH * scale;
    let mut x = icon_position.x + icon_size.width / 2.0 - width / 2.0;
    if let Some(monitor) = app.monitor_from_point(icon_position.x, icon_position.y)? {
        let left = f64::from(monitor.position().x);
        let right = left + f64::from(monitor.size().width);
        x = x.clamp(left, (right - width).max(left));
    }
    Ok(PhysicalPosition::new(x, icon_position.y + icon_size.height + PANEL_GAP * scale))
}

fn toggle_panel(app: &AppHandle, icon: &Rect) -> tauri::Result<()> {
    let panel = panel_window(app)?;
    if panel.is_visible()? {
        return panel.hide();
    }
    let state = app.state::<TrayState>();
    let just_hidden = state.hidden_at.lock().ok().and_then(|at| *at).is_some_and(|at| at.elapsed() < REOPEN_GUARD);
    if just_hidden {
        return Ok(());
    }
    panel.set_position(panel_position(app, &panel, icon)?)?;
    panel.show()?;
    let _ = app.emit_to("main", PANEL_OPENED_EVENT, ());
    panel.set_focus()
}

/// A popover closes when the user looks elsewhere.
pub fn on_panel_blur(app: &AppHandle) {
    #[cfg(debug_assertions)]
    if std::env::var_os("TANDEM_DRIVE_PANEL").is_some() {
        return;
    }
    if let Some(panel) = app.get_webview_window(PANEL_LABEL) {
        let _ = panel.hide();
        if let Ok(mut at) = app.state::<TrayState>().hidden_at.lock() {
            *at = Some(Instant::now());
        }
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<TrayIcon<Wry>> {
    let icon = Image::from_bytes(include_bytes!("../icons/tray-template.png"))?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { rect, button_state: MouseButtonState::Up, .. } = event {
                if let Err(error) = toggle_panel(tray.app_handle(), &rect) {
                    crate::diagnostics::error("tray", format!("menu bar panel failed: {error}"));
                }
            }
        })
        .build(app)
}

pub fn update(app: &AppHandle, update: TrayUpdate) -> Result<(), String> {
    if let Ok(mut summary) = app.state::<TrayState>().summary.lock() {
        summary.clone_from(&update.summary);
    }
    app.emit_to(PANEL_LABEL, SUMMARY_EVENT, update.summary).map_err(|error| error.to_string())
}

pub fn current_summary(state: &TrayState) -> Value {
    state.summary.lock().map_or(Value::Null, |summary| summary.clone())
}

pub fn resize_panel(app: &AppHandle, height: f64) -> Result<(), String> {
    let panel = app.get_webview_window(PANEL_LABEL).ok_or("The panel is not open")?;
    let height = height.clamp(PANEL_MIN_HEIGHT, PANEL_MAX_HEIGHT);
    panel.set_size(LogicalSize::new(PANEL_WIDTH, height)).map_err(|error| error.to_string())
}

/// What the panel's buttons can do. A fixed list, because the page should not reach further.
pub fn panel_action(app: &AppHandle, action: &str, task_id: Option<&str>) -> Result<(), String> {
    if action == "refresh" {
        return app.emit_to("main", REFRESH_EVENT, ()).map_err(|error| error.to_string());
    }
    if let Some(panel) = app.get_webview_window(PANEL_LABEL) {
        let _ = panel.hide();
    }
    match action {
        "open" => show_window(app),
        "settings" => {
            show_window(app);
            app.emit_to("main", OPEN_SETTINGS_EVENT, ()).map_err(|error| error.to_string())?;
        }
        "task" => {
            show_window(app);
            app.emit_to("main", OPEN_TASK_EVENT, task_id.ok_or("No task given")?).map_err(|error| error.to_string())?;
        }
        "quit" => app.exit(0),
        _ => return Err("Unknown action".into()),
    }
    Ok(())
}

/// For testing the panel without a click on the icon, which is out of a test's reach.
#[cfg(debug_assertions)]
pub fn show_panel_for_test(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    let panel = panel_window(app)?;
    panel.set_position(PhysicalPosition::new(120.0, 120.0))?;
    panel.show()?;
    panel.set_focus()?;
    Ok(panel)
}

pub fn notify(app: &AppHandle, title: &str, body: &str) -> Result<(), String> {
    app.notification().builder().title(title).body(body).show().map_err(|error| error.to_string())
}

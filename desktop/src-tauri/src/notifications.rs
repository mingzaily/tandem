//! Dock attention follows the task list and the user's macOS notification settings.

#[cfg(target_os = "macos")]
mod macos;

use serde::Serialize;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct State {
    count: AtomicU32,
    syncing: tokio::sync::Mutex<()>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Authorization {
    NotDetermined,
    Denied,
    Authorized,
    Unsupported,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub authorization: Authorization,
    pub badge_enabled: bool,
}

impl Status {
    fn badge_count(self, enabled: bool, count: u32) -> u32 {
        if enabled && self.authorization == Authorization::Authorized && self.badge_enabled {
            count
        } else {
            0
        }
    }
}

pub async fn status() -> Result<Status, String> {
    #[cfg(target_os = "macos")]
    {
        macos::status().await
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(Status {
            authorization: Authorization::Unsupported,
            badge_enabled: false,
        })
    }
}

pub async fn request_permission() -> Result<Status, String> {
    #[cfg(target_os = "macos")]
    {
        if status().await?.authorization == Authorization::NotDetermined {
            macos::request_permission().await?;
        }
    }
    status().await
}

pub async fn update(app: &AppHandle, count: u32) -> Result<(), String> {
    app.state::<State>().count.store(count, Ordering::Relaxed);
    sync(app).await
}

/// Focus and configuration changes refresh the existing count; neither requests permission.
pub fn refresh(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = sync(&app).await {
            crate::diagnostics::error("notifications", format!("badge: {error}"));
        }
    });
}

pub async fn sync(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<State>();
    let _guard = state.syncing.lock().await;
    let status = status().await?;
    // A permission query is asynchronous; apply the newest count and preference after it returns.
    let enabled = app
        .state::<crate::storage::Store>()
        .snapshot()
        .config
        .notify_when_done;
    let count = state.count.load(Ordering::Relaxed);
    let applied = status.badge_count(enabled, count);
    #[cfg(target_os = "macos")]
    if status.authorization == Authorization::Authorized
        && status.badge_enabled
        && macos::set_badge(applied).await?
    {
        return Ok(());
    }
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_badge_count(Some(i64::from(applied)))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub async fn open_settings(app: &AppHandle) -> Result<(), String> {
    let mut url =
        tauri::Url::parse("x-apple.systempreferences:com.apple.Notifications-Settings.extension")
            .map_err(|error| error.to_string())?;
    url.query_pairs_mut()
        .append_pair("id", &app.config().identifier);
    let result = tokio::process::Command::new("/usr/bin/open")
        .arg(url.as_str())
        .status()
        .await
        .map_err(|error| error.to_string())?;
    if result.success() {
        Ok(())
    } else {
        Err("无法打开系统通知设置".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn badge_obeys_both_the_notification_toggle_and_system_badge_authorization() {
        let allowed = Status {
            authorization: Authorization::Authorized,
            badge_enabled: true,
        };
        assert_eq!(allowed.badge_count(true, 3), 3);
        assert_eq!(allowed.badge_count(false, 3), 0);
        assert_eq!(
            Status {
                badge_enabled: false,
                ..allowed
            }
            .badge_count(true, 3),
            0
        );
        for authorization in [
            Authorization::NotDetermined,
            Authorization::Denied,
            Authorization::Unsupported,
        ] {
            assert_eq!(
                Status {
                    authorization,
                    ..allowed
                }
                .badge_count(true, 3),
                0
            );
        }
        assert_eq!(allowed.badge_count(true, 0), 0);
    }
}

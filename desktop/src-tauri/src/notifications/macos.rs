use super::{Authorization, Status};
use block2::RcBlock;
use objc2::runtime::Bool;
use objc2::sel;
use objc2_foundation::{NSBundle, NSError, NSObjectProtocol};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNNotificationSetting, UNNotificationSettings,
    UNUserNotificationCenter,
};
use std::ptr::NonNull;
use std::sync::Mutex;
use tokio::sync::oneshot;

/// A notification center needs an application bundle; asking for one from a bare binary aborts
/// the process. Tauri embeds Info.plist in the binary, so the identifier alone is not enough:
/// `target/release/tandem` opened from Finder has one too, but no `.app` around it.
fn bundled() -> bool {
    let bundle = NSBundle::mainBundle();
    bundle.bundleIdentifier().is_some() && bundle.bundlePath().to_string().ends_with(".app")
}

pub async fn status() -> Result<Status, String> {
    if !bundled() {
        return Ok(Status {
            authorization: Authorization::Unsupported,
            badge_enabled: false,
        });
    }
    let receiver = {
        let (sender, receiver) = oneshot::channel();
        let sender = Mutex::new(Some(sender));
        let completion = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
            // SAFETY: UserNotifications keeps the settings object alive during this callback.
            let settings = unsafe { settings.as_ref() };
            let authorization = match settings.authorizationStatus() {
                UNAuthorizationStatus::NotDetermined => Authorization::NotDetermined,
                UNAuthorizationStatus::Denied => Authorization::Denied,
                UNAuthorizationStatus::Authorized
                | UNAuthorizationStatus::Provisional
                | UNAuthorizationStatus::Ephemeral => Authorization::Authorized,
                _ => Authorization::Unsupported,
            };
            let status = Status {
                authorization,
                badge_enabled: settings.badgeSetting() == UNNotificationSetting::Enabled,
            };
            if let Ok(mut sender) = sender.lock() {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(status);
                }
            }
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .getNotificationSettingsWithCompletionHandler(&completion);
        receiver
    };
    receiver.await.map_err(|_| "读取系统通知设置失败".into())
}

/// macOS 13+ updates the system-owned badge. Earlier systems use Tauri's Dock label.
pub async fn set_badge(count: u32) -> Result<bool, String> {
    if !bundled() {
        return Ok(false);
    }
    let receiver = {
        let center = UNUserNotificationCenter::currentNotificationCenter();
        if !center.respondsToSelector(sel!(setBadgeCount:withCompletionHandler:)) {
            return Ok(false);
        }
        let (sender, receiver) = oneshot::channel();
        let sender = Mutex::new(Some(sender));
        let completion = RcBlock::new(move |error: *mut NSError| {
            // SAFETY: UserNotifications owns the optional NSError for the callback's lifetime.
            let result = unsafe { error.as_ref() }.map_or(Ok(()), |error| {
                Err(error.localizedDescription().to_string())
            });
            if let Ok(mut sender) = sender.lock() {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(result);
                }
            }
        });
        center.setBadgeCount_withCompletionHandler(count as isize, Some(&completion));
        receiver
    };
    receiver
        .await
        .map_err(|_| "更新系统角标失败".to_owned())??;
    Ok(true)
}

pub async fn request_permission() -> Result<(), String> {
    if !bundled() {
        return Err("系统通知需要从 Tandem.app 打开，当前运行的是未打包的程序".into());
    }
    let receiver = {
        let (sender, receiver) = oneshot::channel();
        let sender = Mutex::new(Some(sender));
        let completion = RcBlock::new(move |_granted: Bool, error: *mut NSError| {
            // SAFETY: the optional NSError belongs to UserNotifications and lives through this callback.
            let result = unsafe { error.as_ref() }.map_or(Ok(()), |error| {
                Err(error.localizedDescription().to_string())
            });
            if let Ok(mut sender) = sender.lock() {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(result);
                }
            }
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .requestAuthorizationWithOptions_completionHandler(
                UNAuthorizationOptions::Alert
                    | UNAuthorizationOptions::Sound
                    | UNAuthorizationOptions::Badge,
                &completion,
            );
        receiver
    };
    receiver
        .await
        .map_err(|_| "请求系统通知权限失败".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The test binary is itself a bare binary; reaching the notification center would abort it.
    #[test]
    fn a_bare_binary_skips_the_notification_center() {
        assert!(!bundled());
        assert_eq!(tauri::async_runtime::block_on(set_badge(3)), Ok(false));
        assert!(tauri::async_runtime::block_on(request_permission()).is_err());
        let status = tauri::async_runtime::block_on(status()).unwrap();
        assert!(matches!(status.authorization, Authorization::Unsupported));
    }
}

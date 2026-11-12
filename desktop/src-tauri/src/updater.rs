//! Rust owns update state and scheduling; application replacement always needs a user action.
use std::{sync::{Arc, Mutex as StdMutex}, time::{Duration, Instant}};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::{Mutex, Notify, RwLock, RwLockReadGuard, RwLockWriteGuard};

struct ActivityGate(RwLock<()>);
impl ActivityGate {
    fn enter(&self) -> Result<RwLockReadGuard<'_, ()>, String> {
        self.0.try_read().map_err(|_| "正在安装更新，请等待应用重启".into())
    }
    fn install(&self) -> Result<RwLockWriteGuard<'_, ()>, String> {
        self.0.try_write().map_err(|_| "请先等待运行中的任务、标题生成或 Agent 操作结束，再安装更新".into())
    }
}
static ACTIVITIES: ActivityGate = ActivityGate(RwLock::const_new(()));
const CHANGED: &str = "app-update-changed";
const STARTUP_DELAY: Duration = Duration::from_secs(30);

/// Hold for each task lifecycle so installation cannot race a new local or phone turn.
pub fn activity() -> Result<RwLockReadGuard<'static, ()>, String> {
    ACTIVITIES.enter()
}

#[derive(Default)]
pub struct Updates {
    operation: Mutex<()>,
    pending: StdMutex<Pending>,
    wake: Notify,
}

#[derive(Default)]
struct Pending {
    update: Option<Update>,
    bytes: Option<Arc<Vec<u8>>>,
    view: Snapshot,
    last_attempt: Option<Instant>,
}

#[derive(Clone, serde::Serialize)]
pub struct Available {
    version: String,
    notes: Option<String>,
}

#[derive(Clone, serde::Serialize)]
pub struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

#[derive(Clone, Copy, Default, PartialEq, Eq, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
enum Phase {
    #[default]
    Idle,
    Checking,
    Latest,
    Available,
    Downloading,
    Ready,
    Installing,
}
impl Phase {
    fn busy(self) -> bool { matches!(self, Self::Checking | Self::Downloading | Self::Installing) }
}

#[derive(Clone, Default, serde::Serialize)]
pub struct Snapshot {
    phase: Phase,
    update: Option<Available>,
    progress: Option<Progress>,
    error: Option<String>,
    revision: u64,
}

impl Pending {
    fn fail(&mut self, error: String) {
        crate::diagnostics::error("updater", error.clone());
        self.view.phase = if self.bytes.is_some() { Phase::Ready }
            else if self.update.is_some() { Phase::Available } else { Phase::Idle };
        self.view.error = Some(error);
        self.view.progress = None;
    }
}

impl Updates {
    fn snapshot(&self) -> Snapshot { self.pending.lock().expect("update state mutex").view.clone() }

    fn change(&self, app: &AppHandle, change: impl FnOnce(&mut Pending)) {
        let (view, phase_changed) = {
            let mut pending = self.pending.lock().expect("update state mutex");
            let phase = pending.view.phase;
            change(&mut pending);
            pending.view.revision += 1;
            (pending.view.clone(), phase != pending.view.phase)
        };
        let _ = app.emit_to("main", CHANGED, view);
        if phase_changed { self.wake.notify_one(); }
    }

    async fn check(&self, app: &AppHandle) -> Result<(), String> {
        if self.snapshot().phase == Phase::Ready { return Ok(()); }
        self.change(app, |pending| {
            pending.last_attempt = Some(Instant::now());
            pending.view.phase = Phase::Checking;
            pending.view.error = None;
            pending.view.progress = None;
        });
        let update = app.updater_builder().timeout(Duration::from_secs(30))
            .build().map_err(|error| error.to_string())?
            .check().await.map_err(|error| error.to_string())?;
        if let Some(update) = &update { validate_download(&update.download_url)?; }
        self.change(app, |pending| {
            pending.view.phase = if update.is_some() { Phase::Available } else { Phase::Latest };
            pending.view.update = update.as_ref().map(|update| Available {
                version: update.version.clone(), notes: update.body.clone(),
            });
            pending.update = update;
            pending.bytes = None;
        });
        Ok(())
    }

    async fn refresh(&self, app: &AppHandle) -> Result<(), String> {
        self.check(app).await?;
        if self.snapshot().phase == Phase::Available && app.state::<crate::storage::Store>().snapshot().config.auto_update {
            self.download(app).await?;
        }
        Ok(())
    }

    async fn download(&self, app: &AppHandle) -> Result<(), String> {
        let mut update = self.pending.lock().expect("update state mutex").update.clone().ok_or("请先检查更新")?;
        if self.snapshot().phase == Phase::Ready { return Ok(()); }
        self.change(app, |pending| {
            pending.last_attempt = Some(Instant::now());
            pending.view.phase = Phase::Downloading;
            pending.view.error = None;
            pending.view.progress = Some(Progress { downloaded: 0, total: None });
        });
        update.timeout = Some(Duration::from_secs(600));
        let mut downloaded = 0u64;
        let mut last_emit = Instant::now();
        let bytes = update.download(|chunk, total| {
            downloaded = downloaded.saturating_add(chunk as u64);
            if last_emit.elapsed() >= Duration::from_millis(100) || total == Some(downloaded) {
                self.change(app, |pending| pending.view.progress = Some(Progress { downloaded, total }));
                last_emit = Instant::now();
            }
        }, || {}).await.map_err(|error| error.to_string())?;
        // download() validates the public-key signature and signed version first.
        self.change(app, |pending| {
            pending.bytes = Some(Arc::new(bytes));
            pending.view.phase = Phase::Ready;
            pending.view.progress = None;
        });
        Ok(())
    }
}

fn main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" { Ok(()) } else { Err("更新操作仅在主窗口提供".into()) }
}

fn validate_download(url: &tauri::Url) -> Result<(), String> {
    if url.scheme() == "https" && url.host_str() == Some("github.com")
        && url.path().starts_with("/mingzaily/tandem/releases/download/")
        && url.username().is_empty() && url.password().is_none()
    { Ok(()) } else { Err("更新下载地址需要来自 Tandem 的 GitHub Releases".into()) }
}

#[tauri::command]
pub fn update_state(window: WebviewWindow, state: State<'_, Updates>) -> Result<Snapshot, String> {
    main_window(&window)?;
    Ok(state.snapshot())
}

async fn requested(app: &AppHandle, state: &Updates, download: bool) -> Result<Snapshot, String> {
    let Ok(_operation) = state.operation.try_lock() else { return Ok(state.snapshot()) };
    let result = if download { state.download(app).await } else { state.refresh(app).await };
    if let Err(error) = result { state.change(app, |pending| pending.fail(error)); }
    Ok(state.snapshot())
}

#[tauri::command]
pub async fn check_update(app: AppHandle, window: WebviewWindow, state: State<'_, Updates>) -> Result<Snapshot, String> {
    main_window(&window)?;
    requested(&app, &state, false).await
}

#[tauri::command]
pub async fn download_update(app: AppHandle, window: WebviewWindow, state: State<'_, Updates>) -> Result<Snapshot, String> {
    main_window(&window)?;
    requested(&app, &state, true).await
}

async fn install(app: &AppHandle, state: &Updates) -> Result<(), String> {
    app.state::<crate::storage::Store>().ensure_writable()?;
    let _exclusive = ACTIVITIES.install()?;
    let (update, bytes) = {
        let pending = state.pending.lock().expect("update state mutex");
        (pending.update.clone().ok_or("请先检查更新")?, pending.bytes.clone().ok_or("请先下载更新")?)
    };
    state.change(app, |pending| { pending.view.phase = Phase::Installing; pending.view.error = None; });
    // Keep verified bytes available if extraction or the blocking worker fails.
    tauri::async_runtime::spawn_blocking(move || update.install(bytes.as_slice()).map_err(|error| error.to_string()))
        .await.map_err(|error| error.to_string())??;
    app.restart();
}

#[tauri::command]
pub async fn install_update(app: AppHandle, window: WebviewWindow, state: State<'_, Updates>) -> Result<Snapshot, String> {
    main_window(&window)?;
    let Ok(_operation) = state.operation.try_lock() else { return Ok(state.snapshot()) };
    if let Err(error) = install(&app, &state).await { state.change(&app, |pending| pending.fail(error)); }
    Ok(state.snapshot())
}

/// Monotonic deadlines allow suspension/resume without overlapping or catch-up checks.
fn next_check(enabled: bool, hours: u8, started: Instant, last_attempt: Option<Instant>, phase: Phase, now: Instant) -> Option<Duration> {
    if !enabled || phase.busy() || phase == Phase::Ready { return None; }
    let deadline = last_attempt.map_or(started + STARTUP_DELAY, |last| last + Duration::from_secs(u64::from(hours) * 3600));
    Some(deadline.saturating_duration_since(now))
}

pub fn configuration_changed(app: &AppHandle) {
    if let Some(state) = app.try_state::<Updates>() { state.wake.notify_one(); }
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        let state = app.state::<Updates>();
        loop {
            let notified = state.wake.notified();
            let config = app.state::<crate::storage::Store>().snapshot().config;
            let writable = app.state::<crate::storage::Store>().is_writable();
            let delay = {
                let pending = state.pending.lock().expect("update state mutex");
                next_check(config.auto_update && writable, config.update_check_interval_hours,
                    started, pending.last_attempt, pending.view.phase, Instant::now())
            };
            if let Some(delay) = delay {
                tokio::select! { _ = notified => continue, _ = tokio::time::sleep(delay) => {} }
            } else { notified.await; continue; }
            let config = app.state::<crate::storage::Store>().snapshot().config;
            if !config.auto_update { continue; }
            let Ok(_operation) = state.operation.try_lock() else { continue };
            let result = state.refresh(&app).await;
            if let Err(error) = result { state.change(&app, |pending| pending.fail(error)); }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn automatic_checks_obey_settings_deadlines_and_verified_downloads() {
        let started = Instant::now();
        let now = started + Duration::from_secs(40);
        assert_eq!(next_check(false, 6, started, None, Phase::Idle, now), None);
        assert_eq!(next_check(true, 6, started, None, Phase::Idle, started), Some(STARTUP_DELAY));
        assert_eq!(next_check(true, 6, started, None, Phase::Idle, now), Some(Duration::ZERO));
        let last = Some(now);
        assert_eq!(next_check(true, 6, started, last, Phase::Latest, now), Some(Duration::from_secs(6 * 3600)));
        assert_eq!(next_check(true, 1, started, last, Phase::Available, now + Duration::from_secs(3600)), Some(Duration::ZERO));
        assert_eq!(next_check(true, 24, started, last, Phase::Idle, now + Duration::from_secs(3600)), Some(Duration::from_secs(23 * 3600)));
        for phase in [Phase::Checking, Phase::Downloading, Phase::Installing, Phase::Ready] {
            assert_eq!(next_check(true, 1, started, None, phase, now), None);
        }
        // A failed request follows the chosen interval, rather than retrying in a loop.
        assert_eq!(next_check(true, 1, started, last, Phase::Idle, now), Some(Duration::from_secs(3600)));
        // Resuming after a long suspension triggers one check; its new attempt resets the deadline.
        assert_eq!(next_check(true, 1, started, last, Phase::Latest, now + Duration::from_secs(90000)), Some(Duration::ZERO));
    }

    #[test]
    fn install_failure_keeps_the_verified_package_available_for_retry() {
        let bytes = Arc::new(vec![1, 2, 3]);
        let mut pending = Pending { bytes: Some(bytes.clone()), ..Default::default() };
        pending.view.phase = Phase::Installing;
        pending.fail("任务正在运行".into());
        assert_eq!(pending.view.phase, Phase::Ready);
        assert_eq!(pending.view.error.as_deref(), Some("任务正在运行"));
        assert!(Arc::ptr_eq(pending.bytes.as_ref().unwrap(), &bytes));
        let mut empty = Pending::default();
        empty.fail("HTTP 404".into());
        assert_eq!(empty.view.phase, Phase::Idle);
    }

    #[test]
    fn update_downloads_use_the_fixed_release_repository() {
        let url = "https://github.com/mingzaily/tandem/releases/download/v1/Tandem.app.tar.gz";
        assert!(validate_download(&url.parse().unwrap()).is_ok());
        for url in ["http://github.com/mingzaily/tandem/releases/download/v1/app", "https://evil.test/app",
            "https://github.com/other/repo/releases/download/v1/app", "https://github.com/mingzaily/tandem/releases/download-evil/app",
            "https://user@github.com/mingzaily/tandem/releases/download/v1/app"] {
            assert!(validate_download(&url.parse().unwrap()).is_err());
        }
    }

    #[test]
    fn installation_and_running_activities_exclude_each_other() {
        let gate = ActivityGate(RwLock::new(()));
        let task = gate.enter().unwrap();
        assert!(gate.install().unwrap_err().contains("运行中的任务"));
        drop(task);
        let installation = gate.install().unwrap();
        assert!(gate.enter().unwrap_err().contains("等待应用重启"));
        drop(installation);
        assert!(gate.enter().is_ok());
    }

    #[test]
    fn official_updater_verifies_bytes_and_the_signed_version() {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().plugins.0.insert("updater".into(), serde_json::json!({
            "pubkey": include_str!("../test-data/updater/public-key.txt").trim(),
            "requireSignedVersion": true,
            "endpoints": ["https://example.test/latest.json"]
        }));
        let app = tauri::test::mock_builder().plugin(tauri_plugin_updater::Builder::new().build()).build(context).unwrap();
        let updater = app.updater_builder().target("test").build().unwrap();
        let manifest = serde_json::json!({
            "version": "0.1.2026111102",
            "platforms": { "test": {
                "url": "https://github.com/mingzaily/tandem/releases/download/v0.1.2026111102/Tandem.app.tar.gz",
                "signature": include_str!("../test-data/updater/payload.sig").trim()
            }}
        });
        let update = updater.restore_update(manifest.clone()).unwrap().unwrap();
        assert!(update.verify(include_bytes!("../test-data/updater/payload.txt")).is_ok());
        assert!(update.verify(b"tampered package").is_err());
        let mut wrong_version = manifest;
        wrong_version["version"] = serde_json::json!("0.1.2026111103");
        let update = updater.restore_update(wrong_version).unwrap().unwrap();
        assert!(update.verify(include_bytes!("../test-data/updater/payload.txt")).is_err());
    }
}

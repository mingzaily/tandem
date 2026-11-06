//! Tandem-owned configuration and view state. Native CLI histories and configuration stay put.

pub mod config;
pub mod io;
mod migration;

use config::Config;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fs::{self, File};
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, RwLock, RwLockReadGuard};
use tauri::{AppHandle, Emitter, Manager};

const MIGRATION_VERSION: u32 = 1;
pub const CHANGED: &str = "preferences-changed";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskMeta {
    pub pins: Vec<String>,
    pub archived: Vec<String>,
    pub titles: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct ViewState {
    pub task_meta: TaskMeta,
    pub project_order: Vec<String>,
    pub sidebar_collapsed: bool,
    pub sidebar_width: f64,
    pub projects_seeded: bool,
    /// Written last, after all legacy data has been copied and configuration persisted.
    pub migration_version: u32,
}

impl Default for ViewState {
    fn default() -> Self {
        Self {
            task_meta: TaskMeta::default(),
            project_order: Vec::new(),
            sidebar_collapsed: false,
            sidebar_width: 260.,
            projects_seeded: false,
            migration_version: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub config: Config,
    pub state: ViewState,
    pub revision: u64,
    pub migration_pending: bool,
    pub errors: Vec<String>,
}

impl Snapshot {
    pub fn initialization_script(&self) -> String {
        // A WebView initialization script runs before the document's own scripts.
        format!(
            "window.__TANDEM_PREFERENCES__ = {};\n{}",
            serde_json::to_string(self).expect("preferences serialize"),
            include_str!("../../../src/preload-theme.js")
        )
    }

    pub fn native_theme(&self) -> Option<tauri::Theme> {
        match self.config.theme.as_str() {
            "dark" => Some(tauri::Theme::Dark),
            "light" => Some(tauri::Theme::Light),
            _ => None,
        }
    }
}

struct Data {
    migration_pending: bool,
    config: Config,
    state: ViewState,
    revision: u64,
    seen_config: Result<Option<Vec<u8>>, String>,
    config_error: Option<String>,
    state_error: Option<String>,
    migration_error: Option<String>,
    write_error: Option<String>,
    ownership: Option<File>,
    system_language: Option<String>,
}

pub struct Store {
    root: PathBuf,
    legacy: PathBuf,
    /// Every queue access takes a read permit. Migration takes the exclusive permit before
    /// checking for active work and keeps it until the final state.json commit.
    ready: RwLock<bool>,
    data: Mutex<Data>,
}

impl Store {
    pub fn open(root: PathBuf, legacy: PathBuf) -> Self {
        let ownership = acquire(&root);
        let seen_config = io::read_optional(&root.join("config.toml"));
        let loaded_config = decode_config(&seen_config);
        let loaded_state = read_state(&root.join("state.json"));
        let ready = ownership.is_ok()
            && loaded_state
                .as_ref()
                .is_ok_and(|state| state.migration_version == MIGRATION_VERSION);
        let data = Data {
            migration_pending: !ready,
            config: loaded_config.clone().unwrap_or_default(),
            state: loaded_state.clone().unwrap_or_default(),
            revision: 0,
            seen_config,
            config_error: loaded_config.err(),
            state_error: loaded_state.err(),
            migration_error: ownership.as_ref().err().cloned(),
            write_error: None,
            ownership: ownership.ok(),
            system_language: None,
        };
        Self {
            root,
            legacy,
            ready: RwLock::new(ready),
            data: Mutex::new(data),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn snapshot(&self) -> Snapshot {
        snapshot(&self.data.lock().expect("preferences mutex"))
    }

    pub fn permit(&self) -> Result<RwLockReadGuard<'_, bool>, String> {
        let ready = self.ready.read().map_err(|error| error.to_string())?;
        if !*ready {
            return Err("本地数据尚未就绪，请处理存储提示后重试迁移".into());
        }
        Ok(ready)
    }

    pub fn is_ready(&self) -> bool {
        *self.ready.read().expect("storage gate")
    }

    /// Malformed hand edits stay on disk. Settings writes read and validate that same file,
    /// so an unnoticed invalid edit is protected as well as one the watcher already reported.
    pub fn update(&self, target: &str, patch: Map<String, Value>) -> Result<Snapshot, String> {
        let _permit = self.permit()?;
        let mut data = self.data.lock().map_err(|error| error.to_string())?;
        let result = match target {
            "config" => self.update_config(&mut data, patch),
            "state" => self.update_state(&mut data, patch),
            _ => Err("存储目标使用 config 或 state".into()),
        };
        data.write_error = result
            .as_ref()
            .err()
            .map(|error| format!("保存本地设置失败：{error}"));
        data.revision += 1;
        result
            .map(|()| snapshot(&data))
            .map_err(|error| format!("保存本地设置失败：{error}"))
    }

    fn update_config(&self, data: &mut Data, patch: Map<String, Value>) -> Result<(), String> {
        let bytes = io::read_optional(&self.root.join("config.toml"))?;
        let text = bytes
            .as_deref()
            .map(std::str::from_utf8)
            .transpose()
            .map_err(|error| error.to_string())?
            .unwrap_or(config::TEMPLATE);
        let (mut document, _) = config::parse(text)?;
        let config = config::patch(&mut document, &patch)?;
        let bytes = document.to_string().into_bytes();
        io::atomic_write(&self.root.join("config.toml"), &bytes)?;
        data.config = config;
        data.config_error = None;
        data.seen_config = Ok(Some(bytes));
        Ok(())
    }

    fn update_state(&self, data: &mut Data, patch: Map<String, Value>) -> Result<(), String> {
        if patch.contains_key("migrationVersion") {
            return Err("迁移版本由后端维护".into());
        }
        let mut value = serde_json::to_value(read_state(&self.root.join("state.json"))?)
            .expect("view state serializes");
        config::merge(&mut value, &Value::Object(patch));
        let state: ViewState = serde_json::from_value(value).map_err(|error| error.to_string())?;
        if !state.sidebar_width.is_finite() || !(180.0..=480.0).contains(&state.sidebar_width) {
            return Err("侧栏宽度范围为 180–480".into());
        }
        io::atomic_write(
            &self.root.join("state.json"),
            &serde_json::to_vec_pretty(&state).expect("view state serializes"),
        )?;
        data.state = state;
        data.state_error = None;
        Ok(())
    }

    /// Polls only the small config file. Comparing contents also catches replacements by editors
    /// that preserve a file's timestamp. File IO runs outside the UI thread.
    pub fn poll(&self) -> Option<Snapshot> {
        // The watcher waits outside the data mutex while a migration owns the files.
        let _permit = self.ready.read().expect("storage gate");
        let mut data = self.data.lock().expect("preferences mutex");
        let seen = io::read_optional(&self.root.join("config.toml"));
        if seen == data.seen_config {
            return None;
        }
        match decode_config(&seen) {
            Ok(config) => {
                data.config = config;
                data.config_error = None;
                data.write_error = None;
            }
            Err(error) => {
                data.config_error =
                    Some(format!("{error}。继续使用上次有效配置，修正文件后自动生效"))
            }
        }
        data.seen_config = seen;
        data.revision += 1;
        Some(snapshot(&data))
    }

    pub fn migrate(
        &self,
        legacy_page: HashMap<String, String>,
        idle: impl FnOnce() -> Result<(), String>,
        other_instance: impl Fn() -> Result<(), String>,
        activate: impl FnOnce(),
    ) -> Result<Snapshot, String> {
        let mut ready = self.ready.write().map_err(|error| error.to_string())?;
        let was_ready = *ready;
        let result: Result<Option<(Config, ViewState)>, String> = (|| {
            let mut data = self.data.lock().map_err(|error| error.to_string())?;
            if data.ownership.is_none() {
                data.ownership = Some(acquire(&self.root)?);
                // The previous owner may have changed both files while this window waited.
                data.state = read_state(&self.root.join("state.json"))?;
                data.seen_config = io::read_optional(&self.root.join("config.toml"));
                match decode_config(&data.seen_config) {
                    Ok(config) => {
                        data.config = config;
                        data.config_error = None;
                    }
                    Err(error) => data.config_error = Some(error),
                }
            }
            if data.state.migration_version == MIGRATION_VERSION {
                return Ok(None);
            }
            // Configuration reads and window creation stay available during image copying.
            drop(data);
            idle()?;
            other_instance()?;
            migration::run(&self.root, &self.legacy, legacy_page, other_instance).map(Some)
        })();
        let mut data = self.data.lock().map_err(|error| error.to_string())?;
        if let Ok(Some((config, state))) = &result {
            data.config = config.clone();
            data.state = state.clone();
            data.config_error = None;
            data.state_error = None;
            data.seen_config = io::read_optional(&self.root.join("config.toml"));
        }
        drop(data);
        // Consumers reload their memory while all disk writers are still fenced. Otherwise
        // a waiting remote-settings write could replace the newly migrated pairing keys.
        if result.is_ok() && !was_ready {
            activate();
        }
        let mut data = self.data.lock().map_err(|error| error.to_string())?;
        data.migration_error = result
            .as_ref()
            .err()
            .map(|error| format!("本地数据迁移暂停：{error}。旧数据已保留，可修正后重试"));
        *ready = result.is_ok();
        data.migration_pending = result.is_err();
        data.revision += 1;
        result.map(|_| snapshot(&data)).map_err(|_| {
            data.migration_error
                .clone()
                .expect("failed migration has an error")
        })
    }

    pub fn preview(&self, legacy_page: HashMap<String, String>) -> Result<Snapshot, String> {
        let ready = self.ready.write().map_err(|error| error.to_string())?;
        let mut data = self.data.lock().map_err(|error| error.to_string())?;
        if *ready || data.ownership.is_none() {
            return Ok(snapshot(&data));
        }
        let result = migration::prepare(&self.root, legacy_page).map(|prepared| {
            data.config = prepared.config;
            data.state = prepared.state;
            data.seen_config = io::read_optional(&self.root.join("config.toml"));
            data.config_error = None;
            data.state_error = None;
        });
        data.migration_error = result
            .as_ref()
            .err()
            .map(|error| format!("读取旧配置失败：{error}。旧数据已保留，请修正后重试迁移"));
        data.revision += 1;
        result.map(|()| snapshot(&data)).map_err(|_| {
            data.migration_error
                .clone()
                .expect("failed preview has an error")
        })
    }

    pub fn remote_context(&self) -> crate::remote::Context {
        let data = self.data.lock().expect("preferences mutex");
        let config = &data.config;
        let default = self
            .root
            .join("conversations")
            .to_string_lossy()
            .into_owned();
        let mut roots = config.past_conversation_dirs.clone();
        roots.push(default);
        if !config.conversation_dir.is_empty() {
            roots.push(config.conversation_dir.clone());
        }
        roots.sort();
        roots.dedup();
        crate::remote::Context {
            projects: config.projects.clone(),
            project_order: data.state.project_order.clone(),
            conversation_roots: roots,
            conversation_dir: Some(if config.conversation_dir.is_empty() {
                self.root
                    .join("conversations")
                    .to_string_lossy()
                    .into_owned()
            } else {
                config.conversation_dir.clone()
            }),
            archived: data.state.task_meta.archived.clone(),
            titles: data.state.task_meta.titles.clone(),
            language: match config.language.as_str() {
                "system" => data.system_language.clone(),
                language => Some(language.to_owned()),
            },
        }
    }

    /// The WebView knows the system display language. This observation is runtime state;
    /// the user's language preference remains exclusively in config.toml.
    pub fn set_system_language(&self, language: String) -> Result<(), String> {
        if !["zh", "en"].contains(&language.as_str()) {
            return Err("系统显示语言使用 zh 或 en".into());
        }
        self.data
            .lock()
            .map_err(|error| error.to_string())?
            .system_language = Some(language);
        Ok(())
    }
}

fn decode_config(bytes: &Result<Option<Vec<u8>>, String>) -> Result<Config, String> {
    let bytes = bytes.as_ref().map_err(Clone::clone)?;
    let text = bytes
        .as_deref()
        .map(std::str::from_utf8)
        .transpose()
        .map_err(|error| format!("config.toml 编码错误：{error}"))?
        .unwrap_or("");
    config::parse(text).map(|(_, config)| config)
}

fn read_state(path: &Path) -> Result<ViewState, String> {
    let Some(bytes) = io::read_optional(path)? else {
        return Ok(ViewState::default());
    };
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("state.json 读取失败：{error}，原文件已保留"))
}

fn snapshot(data: &Data) -> Snapshot {
    Snapshot {
        config: data.config.clone(),
        state: data.state.clone(),
        revision: data.revision,
        migration_pending: data.migration_pending,
        errors: [
            &data.config_error,
            &data.state_error,
            &data.migration_error,
            &data.write_error,
        ]
        .into_iter()
        .flatten()
        .cloned()
        .collect(),
    }
}

fn acquire(root: &Path) -> Result<File, String> {
    io::private_dir(root)?;
    let file = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .mode(0o600)
        .open(root.join(".storage.lock"))
        .map_err(|error| error.to_string())?;
    // flock protects all Tandem-owned writers across processes; the open file owns the lock.
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        return Err("另一个 Tandem 正在使用本地数据，请先退出另一个 Tandem，再重试迁移".into());
    }
    migration::ensure_gitignore(root)?;
    match fs::set_permissions(root.join("remote.json"), fs::Permissions::from_mode(0o600)) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("保护 remote.json 失败：{error}")),
    }
    Ok(file)
}

pub fn publish(app: &AppHandle) {
    let store = app.state::<Store>();
    let snapshot = store.snapshot();
    crate::tray::set_keep_running(
        &app.state::<crate::tray::TrayState>(),
        snapshot.config.keep_in_menu_bar,
    );
    app.state::<crate::remote::Remote>()
        .update_context(store.remote_context());
    let _ = app.emit(CHANGED, snapshot);
}

pub fn watch(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(750));
        if app.state::<Store>().poll().is_some() {
            publish(&app);
        }
    });
}

/// Older builds predate the storage lock. Migrating while one is alive could split its queue
/// from the copied queue, so migration waits for that process to exit.
pub fn check_legacy_instance() -> Result<(), String> {
    #[cfg(debug_assertions)]
    if std::env::var_os("TANDEM_DRIVE_DATA_DIR").is_some() {
        return Ok(());
    }
    let output = std::process::Command::new("/bin/ps")
        .args(["-axo", "pid=,comm="])
        .output()
        .map_err(|error| format!("检查旧窗口失败：{error}"))?;
    if !output.status.success() {
        return Err("读取进程列表失败，请重试迁移".into());
    }
    let own = std::process::id().to_string();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let line = line.trim();
        let Some((pid, command)) = line.split_once(char::is_whitespace) else {
            continue;
        };
        if pid != own
            && Path::new(command.trim())
                .file_name()
                .is_some_and(|name| name == "tandem" || name == "Tandem")
        {
            return Err("旧版 Tandem 仍在运行，请先结束其中的任务并退出旧版应用".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;

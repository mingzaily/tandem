//! Tandem-owned configuration and view state. Native CLI histories and configuration stay put.

pub mod config;
pub mod io;

use config::Config;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fs::{self, File};
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

pub const CHANGED: &str = "preferences-changed";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct TaskMeta {
    pub pins: Vec<String>,
    pub archived: Vec<String>,
    pub titles: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct ViewState {
    pub task_meta: TaskMeta,
    pub project_order: Vec<String>,
    pub pinned_projects: Vec<String>,
    /// Project and CLI group keys the user explicitly folded in the sidebar.
    pub collapsed_sidebar_groups: Vec<String>,
    /// Tasks whose turn finished while another task was open, newest first.
    pub unread_tasks: Vec<String>,
    pub sidebar_collapsed: bool,
    pub sidebar_width: f64,
    pub projects_seeded: bool,
}

impl Default for ViewState {
    fn default() -> Self {
        Self {
            task_meta: TaskMeta::default(),
            project_order: Vec::new(),
            pinned_projects: Vec::new(),
            collapsed_sidebar_groups: Vec::new(),
            unread_tasks: Vec::new(),
            sidebar_collapsed: false,
            sidebar_width: 260.,
            projects_seeded: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub config: Config,
    pub state: ViewState,
    pub revision: u64,
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
    config: Config,
    state: ViewState,
    revision: u64,
    seen_config: Result<Option<Vec<u8>>, String>,
    config_error: Option<String>,
    state_error: Option<String>,
    config_warnings: Vec<String>,
    write_error: Option<String>,
    system_language: Option<String>,
}

pub struct Store {
    root: PathBuf,
    // The open file holds the single-writer lock for this process's lifetime.
    ownership: Result<File, String>,
    data: Mutex<Data>,
}

impl Store {
    pub fn open(root: PathBuf) -> Self {
        let ownership = acquire(&root);
        let mut seen_config = io::read_optional(&root.join("config.toml"));
        if ownership.is_ok() && matches!(seen_config, Ok(None)) {
            seen_config = io::atomic_write(&root.join("config.toml"), config::TEMPLATE.as_bytes())
                .map(|()| Some(config::TEMPLATE.as_bytes().to_vec()));
        }
        let (config, config_warnings, config_error) = match decode_config(&seen_config) {
            Ok((config, warnings)) => (config, warnings, None),
            Err(error) => (Config::default(), Vec::new(), Some(error)),
        };
        let (state, state_error) = read_state(&root.join("state.json"), ownership.is_ok())
            .unwrap_or_else(|error| (ViewState::default(), Some(error)));
        Self {
            root,
            ownership,
            data: Mutex::new(Data {
                config,
                state,
                config_warnings,
                config_error,
                state_error,
                revision: 0,
                seen_config,
                write_error: None,
                system_language: None,
            }),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn snapshot(&self) -> Snapshot {
        snapshot(
            &self.data.lock().expect("preferences mutex"),
            self.ownership.as_ref().err(),
        )
    }

    pub fn ensure_writable(&self) -> Result<(), String> {
        self.ownership.as_ref().map(|_| ()).map_err(Clone::clone)
    }

    pub fn is_writable(&self) -> bool {
        self.ownership.is_ok()
    }

    /// Malformed hand edits stay on disk. Settings writes read and validate that same file,
    /// so an unnoticed invalid edit is protected as well as one the watcher already reported.
    pub fn update(&self, target: &str, patch: Map<String, Value>) -> Result<Snapshot, String> {
        self.ensure_writable()?;
        let mut data = self.data.lock().map_err(|error| error.to_string())?;
        let result = match target {
            "config" => self.update_config(&mut data, patch),
            "state" => self.update_state(&mut data, patch),
            _ => Err("存储目标使用 config 或 state".into()),
        };
        self.finish_update(&mut data, target, result)
    }

    fn finish_update(&self, data: &mut Data, target: &str, result: Result<(), String>) -> Result<Snapshot, String> {
        if let Err(error) = &result {
            crate::diagnostics::error("storage", format!("saving {target} failed: {error}"));
        }
        data.write_error = result
            .as_ref()
            .err()
            .map(|error| format!("保存本地设置失败：{error}"));
        data.revision += 1;
        result
            .map(|()| snapshot(data, self.ownership.as_ref().err()))
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
        data.config_warnings = config::warnings(&document);
        data.seen_config = Ok(Some(bytes));
        Ok(())
    }

    /// Only the named task changes; concurrent pins, aliases and other tasks keep their latest values.
    pub fn set_task_archived(&self, id: &str, archived: bool, native: bool) -> Result<Snapshot, String> {
        self.ensure_writable()?;
        let mut data = self.data.lock().map_err(|error| error.to_string())?;
        let result = self.edit_state(&mut data, |mut state| {
            state.task_meta.archived.retain(|task| task != id);
            if archived && !native { state.task_meta.archived.insert(0, id.to_owned()); }
            if archived { state.task_meta.pins.retain(|task| task != id); }
            Ok(state)
        });
        self.finish_update(&mut data, "state", result)
    }

    fn update_state(&self, data: &mut Data, patch: Map<String, Value>) -> Result<(), String> {
        self.edit_state(data, |current| {
            let mut value = serde_json::to_value(current).expect("view state serializes");
            config::merge(&mut value, &Value::Object(patch));
            serde_json::from_value(value).map_err(|error| error.to_string())
        })
    }

    fn edit_state(&self, data: &mut Data, edit: impl FnOnce(ViewState) -> Result<ViewState, String>) -> Result<(), String> {
        let (current, error) = read_state(&self.root.join("state.json"), true)?;
        if error.is_some() {
            data.state_error = error;
        }
        let state = edit(current)?;
        if !state.sidebar_width.is_finite() || !(180.0..=480.0).contains(&state.sidebar_width) {
            return Err("侧栏宽度范围为 180–480".into());
        }
        io::atomic_write(
            &self.root.join("state.json"),
            &serde_json::to_vec_pretty(&state).expect("view state serializes"),
        )?;
        data.state = state;
        Ok(())
    }

    /// Polls only the small config file. Comparing contents also catches replacements by editors
    /// that preserve a file's timestamp. File IO runs outside the UI thread.
    pub fn poll(&self) -> Option<Snapshot> {
        let mut data = self.data.lock().expect("preferences mutex");
        let seen = io::read_optional(&self.root.join("config.toml"));
        if seen == data.seen_config {
            return None;
        }
        match decode_config(&seen) {
            Ok((config, warnings)) => {
                data.config = config;
                data.config_warnings = warnings;
                data.config_error = None;
                data.write_error = None;
            }
            Err(error) => {
                crate::diagnostics::error("config", format!("config.toml rejected: {error}"));
                data.config_error =
                    Some(format!("{error}。继续使用上次有效配置，修正文件后自动生效"))
            }
        }
        data.seen_config = seen;
        data.revision += 1;
        Some(snapshot(&data, self.ownership.as_ref().err()))
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
            hidden_agents: config.hidden_task_agents.clone(),
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

fn decode_config(bytes: &Result<Option<Vec<u8>>, String>) -> Result<(Config, Vec<String>), String> {
    let bytes = bytes.as_ref().map_err(Clone::clone)?;
    let text = bytes
        .as_deref()
        .map(std::str::from_utf8)
        .transpose()
        .map_err(|error| format!("config.toml 编码错误：{error}"))?
        .unwrap_or("");
    config::parse(text).map(|(document, config)| (config, config::warnings(&document)))
}

fn read_state(path: &Path, writable: bool) -> Result<(ViewState, Option<String>), String> {
    let result = io::read_optional(path).and_then(|bytes| match bytes {
        Some(bytes) => serde_json::from_slice(&bytes).map_err(|error| error.to_string()),
        None => Ok(ViewState::default()),
    });
    match result {
        Ok(state) => Ok((state, None)),
        Err(error) => {
            let preservation = if writable {
                let corrupt = path.with_extension(format!("json.{}.corrupt", uuid::Uuid::new_v4()));
                match fs::rename(path, &corrupt) {
                    Ok(()) => format!("已保留到 {}", corrupt.display()),
                    Err(rename_error) => return Err(format!(
                        "读取 {} 失败：{error}。原文件保留，改名失败：{rename_error}。请检查原路径和目录权限，界面状态保存暂不可用",
                        path.display()
                    )),
                }
            } else {
                "原文件保留，此实例为只读".into()
            };
            Ok((
                ViewState::default(),
                Some(format!(
                    "读取 {} 失败：{error}。{preservation}。界面状态已恢复为默认值",
                    path.display()
                )),
            ))
        }
    }
}

fn snapshot(data: &Data, ownership_error: Option<&String>) -> Snapshot {
    Snapshot {
        config: data.config.clone(),
        state: data.state.clone(),
        revision: data.revision,
        errors: [&data.config_error, &data.state_error, &data.write_error]
            .into_iter()
            .flatten()
            .chain(ownership_error)
            .chain(&data.config_warnings)
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
        return Err("另一个 Tandem 正在使用本地数据，请先退出另一个 Tandem，重新打开此窗口".into());
    }
    ensure_gitignore(root)?;
    match fs::set_permissions(root.join("remote.json"), fs::Permissions::from_mode(0o600)) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("保护 remote.json 失败：{error}")),
    }
    Ok(file)
}

pub fn ensure_gitignore(root: &Path) -> Result<(), String> {
    let path = root.join(".gitignore");
    let mut text = io::read_optional(&path)?
        .map(String::from_utf8)
        .transpose()
        .map_err(|error| error.to_string())?
        .unwrap_or_default();
    let original = text.clone();
    for entry in ["/remote.json", "/cache/", "/logs/", "/.storage.lock", ".tmp*"] {
        if !text.lines().any(|line| line == entry) {
            if !text.is_empty() && !text.ends_with('\n') {
                text.push('\n');
            }
            text.push_str(entry);
            text.push('\n');
        }
    }
    if text != original {
        io::atomic_write(&path, text.as_bytes())?;
    }
    Ok(())
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
    crate::notifications::refresh(app);
    crate::updater::configuration_changed(app);
    crate::diagnostics::set_verbose(snapshot.config.debug_log);
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

#[cfg(test)]
mod tests;

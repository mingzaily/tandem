use super::{config, io, read_state, Config, ViewState, MIGRATION_VERSION};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

pub fn ensure_gitignore(root: &Path) -> Result<(), String> {
    let path = root.join(".gitignore");
    let mut text = io::read_optional(&path)?
        .map(String::from_utf8)
        .transpose()
        .map_err(|error| error.to_string())?
        .unwrap_or_default();
    let original = text.clone();
    for entry in ["/remote.json", "/cache/", "/.storage.lock", ".tmp*"] {
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

/// Only copies. Old WebView keys and Application Support files remain as the previous version.
/// A partial attempt can be retried: existing target files must match before they are reused.
pub struct Prepared {
    pub config: Config,
    pub state: ViewState,
    document: toml_edit::DocumentMut,
}

/// The small preference merge is available before moving any queue images, so the first page
/// can paint with the user's existing appearance while the migration runs in the background.
pub fn prepare(root: &Path, page: HashMap<String, String>) -> Result<Prepared, String> {
    let config_bytes = io::read_optional(&root.join("config.toml"))?;
    let config_text = config_bytes
        .as_deref()
        .map(std::str::from_utf8)
        .transpose()
        .map_err(|error| error.to_string())?;
    let (mut document, _) = config::parse(config_text.unwrap_or(config::TEMPLATE))?;
    let mut state = read_state(&root.join("state.json"))?;
    let (changes, old_state) = page_preferences(page)?;
    // An explicit config.toml setting takes precedence over the old page value.
    let existing = config_text
        .map(|text| config::parse(text).map(|(doc, _)| doc))
        .transpose()?;
    let changes = missing_fields(changes, existing.as_ref().map(|doc| doc.as_item()));
    let config = config::patch(&mut document, &changes)?;
    if state.migration_version == 0 {
        for id in old_state.task_meta.pins {
            if !state.task_meta.pins.contains(&id) {
                state.task_meta.pins.push(id);
            }
        }
        for id in old_state.task_meta.archived {
            if !state.task_meta.archived.contains(&id) {
                state.task_meta.archived.push(id);
            }
        }
        for (id, title) in old_state.task_meta.titles {
            state.task_meta.titles.entry(id).or_insert(title);
        }
        if state.project_order.is_empty() {
            state.project_order = old_state.project_order;
        }
        state.sidebar_collapsed = old_state.sidebar_collapsed;
        state.sidebar_width = old_state.sidebar_width;
        state.projects_seeded |= old_state.projects_seeded;
    }
    Ok(Prepared {
        config,
        state,
        document,
    })
}

pub fn run(
    root: &Path,
    legacy: &Path,
    page: HashMap<String, String>,
    check_idle: impl Fn() -> Result<(), String>,
) -> Result<(Config, ViewState), String> {
    prepare(root, page.clone())?;
    // A content digest detects writes even on a filesystem with coarse timestamps.
    let before = inventory(legacy)?;
    let stage = tempfile::tempdir_in(root).map_err(|error| error.to_string())?;
    for (relative, digest) in &before {
        let bytes = fs::read(legacy.join(relative)).map_err(|error| error.to_string())?;
        if Sha256::digest(&bytes).as_slice() != digest {
            return Err("旧队列在读取期间发生变化，请结束旧任务后重试".into());
        }
        io::atomic_write(&stage.path().join(relative), &bytes)?;
    }
    check_idle()?;
    if inventory(legacy)? != before {
        return Err("旧队列在迁移期间发生变化，请结束旧任务后重试".into());
    }
    for relative in before.keys() {
        let target = root.join(relative);
        let bytes = fs::read(stage.path().join(relative)).map_err(|error| error.to_string())?;
        match io::read_optional(&target)? {
            Some(current) if current != bytes => {
                return Err(format!(
                    "{} 与旧数据不同，两个版本均已保留，请核对后重试",
                    target.display()
                ))
            }
            Some(_) => fs::set_permissions(&target, fs::Permissions::from_mode(0o600))
                .map_err(|error| error.to_string())?,
            None => io::atomic_write(&target, &bytes)?,
        }
    }
    check_idle()?;
    if inventory(legacy)? != before {
        return Err("旧队列在提交迁移前发生变化，请结束旧任务后重试".into());
    }
    // File copying can take seconds. Read again here to preserve hand edits made meanwhile.
    let Prepared {
        config,
        mut state,
        document,
    } = prepare(root, page)?;
    io::atomic_write(&root.join("config.toml"), document.to_string().as_bytes())?;
    state.migration_version = MIGRATION_VERSION;
    // The completion marker is committed after config, queue images and pairing keys.
    io::atomic_write(
        &root.join("state.json"),
        &serde_json::to_vec_pretty(&state).expect("view state serializes"),
    )?;
    Ok((config, state))
}

fn missing_fields(
    changes: Map<String, Value>,
    existing: Option<&toml_edit::Item>,
) -> Map<String, Value> {
    changes
        .into_iter()
        .filter_map(|(key, value)| {
            let item = existing.and_then(|item| item.get(&key));
            match (value, item) {
                (Value::Object(fields), Some(item)) => {
                    let fields = missing_fields(fields, Some(item));
                    (!fields.is_empty()).then_some((key, Value::Object(fields)))
                }
                (_, Some(_)) => None,
                (value, None) => Some((key, value)),
            }
        })
        .collect()
}

fn page_preferences(
    page: HashMap<String, String>,
) -> Result<(Map<String, Value>, ViewState), String> {
    let mut config = Map::new();
    let mut state = ViewState::default();
    let parse = |key: &str| -> Result<Option<Value>, String> {
        page.get(key)
            .map(|raw| {
                serde_json::from_str(raw)
                    .map_err(|error| format!("旧页面设置 {key} 解析失败：{error}"))
            })
            .transpose()
    };
    if let Some(Value::Object(settings)) = parse("tandem.settings")? {
        for (old, new) in [
            ("theme", "theme"),
            ("lightTheme", "light_theme"),
            ("darkTheme", "dark_theme"),
            ("language", "language"),
            ("uiFontSize", "ui_font_size"),
            ("sendWithCmdEnter", "send_with_cmd_enter"),
            ("translucentSidebar", "translucent_sidebar"),
            ("keepInMenuBar", "keep_in_menu_bar"),
            ("notifyWhenDone", "notify_when_done"),
            ("conversationDir", "conversation_dir"),
            ("pastConversationDirs", "past_conversation_dirs"),
        ] {
            if let Some(value) = settings.get(old) {
                config.insert(
                    new.into(),
                    if new == "conversation_dir" && value.is_null() {
                        json!("")
                    } else {
                        value.clone()
                    },
                );
            }
        }
    }
    for (key, target, field) in [
        ("tandem.extraProjects", "projects", "cwds"),
        ("tandem.newTaskAgent", "new_task_agent", "agent"),
    ] {
        if let Some(value) = parse(key)?.and_then(|value| value.get(field).cloned()) {
            config.insert(target.into(), value);
        }
    }
    let mut agents = Map::new();
    for (agent, key) in [
        ("claude", "tandem.turnPrefs"),
        ("codex", "tandem.codexPrefs"),
        ("pi", "tandem.piPrefs"),
    ] {
        if let Some(Value::Object(prefs)) = parse(key)? {
            let mut fields = Map::new();
            for (old, new) in [
                ("model", "model"),
                ("effort", "effort"),
                ("permissionMode", "permission_mode"),
            ] {
                if let Some(value) = prefs.get(old) {
                    fields.insert(
                        new.into(),
                        if value.is_null() {
                            json!("")
                        } else {
                            value.clone()
                        },
                    );
                }
            }
            agents.insert(agent.into(), Value::Object(fields));
        }
    }
    config.insert("agents".into(), Value::Object(agents));
    if let Some(meta) = parse("tandem.taskMeta")? {
        state.task_meta = serde_json::from_value(meta).map_err(|error| error.to_string())?;
    }
    if let Some(order) = parse("tandem.projectOrder")?.and_then(|value| value.get("cwds").cloned())
    {
        state.project_order = serde_json::from_value(order).map_err(|error| error.to_string())?;
    }
    if let Some(collapsed) =
        parse("tandem.sidebar")?.and_then(|value| value.get("collapsed").and_then(Value::as_bool))
    {
        state.sidebar_collapsed = collapsed;
    }
    if let Some(width) =
        parse("tandem.sidebarWidth")?.and_then(|value| value.get("width").and_then(Value::as_f64))
    {
        state.sidebar_width = width;
    }
    if let Some(seeded) = parse("tandem.projectsSeeded")?
        .and_then(|value| value.get("seeded").and_then(Value::as_bool))
    {
        state.projects_seeded = seeded;
    }
    Ok((config, state))
}

fn inventory(legacy: &Path) -> Result<BTreeMap<PathBuf, Vec<u8>>, String> {
    let mut result = BTreeMap::new();
    for name in ["queues", "remote.json"] {
        collect(legacy, Path::new(name), &mut result)?;
    }
    Ok(result)
}

fn collect(
    base: &Path,
    relative: &Path,
    result: &mut BTreeMap<PathBuf, Vec<u8>>,
) -> Result<(), String> {
    let path = base.join(relative);
    let meta = match fs::symlink_metadata(&path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    if meta.is_dir() {
        for entry in fs::read_dir(&path).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            collect(base, &relative.join(entry.file_name()), result)?;
        }
    } else if meta.is_file() {
        let bytes = fs::read(&path).map_err(|error| error.to_string())?;
        result.insert(relative.to_owned(), Sha256::digest(&bytes).to_vec());
    } else {
        return Err(format!(
            "{} 需要是普通文件或目录，原路径已保留",
            path.display()
        ));
    }
    Ok(())
}

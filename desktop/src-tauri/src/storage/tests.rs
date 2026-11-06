use super::*;
use serde_json::json;
use std::os::unix::fs::PermissionsExt;
use std::sync::{mpsc, Arc};
use std::time::Duration;

fn ready_store(root: PathBuf, legacy: PathBuf) -> Store {
    let store = Store::open(root, legacy);
    store
        .migrate(HashMap::new(), || Ok(()), || Ok(()), || {})
        .unwrap();
    store
}

#[test]
fn migrates_page_files_images_and_keys_once_and_keeps_the_previous_version() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join(".tandem");
    let legacy = dir.path().join("Application Support");
    fs::create_dir_all(legacy.join("queues/images/task")).unwrap();
    fs::write(legacy.join("queues/task.json"), "pending draft").unwrap();
    fs::write(legacy.join("queues/images/task/image"), b"image bytes").unwrap();
    fs::write(legacy.join("remote.json"), b"test-only private key").unwrap();
    let store = Store::open(root.clone(), legacy.clone());
    assert!(store.permit().is_err());
    let page = HashMap::from([
        (
            "tandem.settings".into(),
            json!({"theme":"dark", "conversationDir":null,"uiFontSize":16}).to_string(),
        ),
        (
            "tandem.codexPrefs".into(),
            json!({"model":"local-model", "effort":"xhigh", "permissionMode":"ask"}).to_string(),
        ),
        (
            "tandem.taskMeta".into(),
            json!({"pins":["task"],"archived":["old"],"titles":{"task":"别名"}}).to_string(),
        ),
        (
            "tandem.extraProjects".into(),
            json!({"cwds":["/code/app"]}).to_string(),
        ),
        (
            "tandem.projectOrder".into(),
            json!({"cwds":["/code/app"]}).to_string(),
        ),
    ]);
    let migrated = store.migrate(page, || Ok(()), || Ok(()), || {}).unwrap();
    assert_eq!(migrated.config.theme, "dark");
    assert_eq!(migrated.config.agents.codex.effort, "xhigh");
    assert_eq!(migrated.state.task_meta.titles["task"], "别名");
    assert_eq!(migrated.state.project_order, ["/code/app"]);
    assert!(store.permit().is_ok());
    for file in [
        "queues/task.json",
        "queues/images/task/image",
        "remote.json",
    ] {
        assert_eq!(
            fs::read(root.join(file)).unwrap(),
            fs::read(legacy.join(file)).unwrap()
        );
        assert_eq!(
            fs::metadata(root.join(file)).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    assert_eq!(
        fs::metadata(&root).unwrap().permissions().mode() & 0o777,
        0o700
    );
    assert!(!root.join("cache").exists());
    let ignore = fs::read_to_string(root.join(".gitignore")).unwrap();
    assert!(ignore.contains("/remote.json\n/cache/"));
    fs::write(legacy.join("queues/task.json"), "old app changed").unwrap();
    store
        .migrate(
            HashMap::new(),
            || panic!("completed migration must skip checks"),
            || Ok(()),
            || {},
        )
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.join("queues/task.json")).unwrap(),
        "pending draft"
    );
    drop(store);
    assert!(!Store::open(root, legacy).snapshot().migration_pending);
}

#[test]
fn a_busy_task_or_old_process_defers_migration_without_writing_new_data() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("new");
    let store = Store::open(root.clone(), dir.path().join("old"));
    assert!(store
        .migrate(
            HashMap::new(),
            || Err("任务正在运行".into()),
            || Ok(()),
            || {}
        )
        .is_err());
    assert!(store
        .migrate(
            HashMap::new(),
            || Ok(()),
            || Err("旧窗口正在运行".into()),
            || {}
        )
        .is_err());
    assert!(!root.join("config.toml").exists());
    assert!(!root.join("state.json").exists());
    assert!(store.snapshot().errors[0].contains("旧窗口"));
    store
        .migrate(HashMap::new(), || Ok(()), || Ok(()), || {})
        .unwrap();
}

#[test]
fn failed_copy_keeps_sources_and_can_retry_after_a_partial_attempt() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("new");
    let legacy = dir.path().join("old");
    fs::create_dir_all(legacy.join("queues")).unwrap();
    fs::write(legacy.join("queues/task.json"), "original").unwrap();
    fs::create_dir_all(root.join("queues")).unwrap();
    fs::write(root.join("queues/task.json"), "conflict").unwrap();
    let store = Store::open(root.clone(), legacy.clone());
    assert!(store
        .migrate(HashMap::new(), || Ok(()), || Ok(()), || {})
        .unwrap_err()
        .contains("两个版本"));
    assert!(!root.join("state.json").exists());
    assert_eq!(
        fs::read_to_string(legacy.join("queues/task.json")).unwrap(),
        "original"
    );
    assert_eq!(
        fs::read_to_string(root.join("queues/task.json")).unwrap(),
        "conflict"
    );
    fs::remove_file(root.join("queues/task.json")).unwrap();
    store
        .migrate(HashMap::new(), || Ok(()), || Ok(()), || {})
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.join("queues/task.json")).unwrap(),
        "original"
    );
}

#[test]
fn manual_edits_apply_and_invalid_files_stay_intact_until_the_user_repairs_them() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("new");
    let store = ready_store(root.clone(), dir.path().join("old"));
    let path = root.join("config.toml");
    fs::write(
        &path,
        "# 用户手改\ntheme = 'dark' # 保留\nui_font_size = 16\n",
    )
    .unwrap();
    assert_eq!(store.poll().unwrap().config.theme, "dark");
    fs::write(&path, "theme = [").unwrap();
    let invalid = store.poll().unwrap();
    assert_eq!(invalid.config.theme, "dark");
    assert!(!invalid.errors.is_empty());
    assert!(store
        .update(
            "config",
            json!({"theme":"light"}).as_object().unwrap().clone()
        )
        .is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), "theme = [");
    assert!(store.poll().is_none());
    fs::write(
        &path,
        "# 用户手改\ntheme = 'dark' # 保留\nui_font_size = 16\n",
    )
    .unwrap();
    assert!(store.poll().unwrap().errors.is_empty());
    let saved = store
        .update(
            "config",
            json!({"theme":"light"}).as_object().unwrap().clone(),
        )
        .unwrap();
    assert_eq!(saved.config.ui_font_size, 16);
    let text = fs::read_to_string(path).unwrap();
    assert!(text.contains("# 用户手改") && text.contains("# 保留"));
    assert!(store.poll().is_none());
}

#[test]
fn settings_writes_read_unobserved_edits_and_refuse_invalid_unobserved_edits() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("new");
    let store = ready_store(root.clone(), dir.path().join("old"));
    let path = root.join("config.toml");
    fs::write(&path, "ui_font_size = 17\n").unwrap();
    let saved = store
        .update(
            "config",
            json!({"theme":"dark"}).as_object().unwrap().clone(),
        )
        .unwrap();
    assert_eq!(saved.config.ui_font_size, 17);
    fs::write(&path, "ui_font_size = 'broken'\n").unwrap();
    assert!(store
        .update(
            "config",
            json!({"theme":"light"}).as_object().unwrap().clone()
        )
        .is_err());
    assert_eq!(
        fs::read_to_string(path).unwrap(),
        "ui_font_size = 'broken'\n"
    );
}

#[test]
fn state_commits_are_private_and_remote_context_comes_directly_from_backend_state() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("new");
    let store = ready_store(root.clone(), dir.path().join("old"));
    store
        .update(
            "config",
            json!({"projects":["/code/app"],"language":"en"})
                .as_object()
                .unwrap()
                .clone(),
        )
        .unwrap();
    store.update("state", json!({"taskMeta":{"pins":["task"],"archived":["old"],"titles":{"task":"title"}},"projectOrder":["/code/app"]}).as_object().unwrap().clone()).unwrap();
    let context = store.remote_context();
    assert_eq!(context.projects, ["/code/app"]);
    assert_eq!(context.archived, ["old"]);
    assert_eq!(context.titles["task"], "title");
    assert_eq!(context.language.as_deref(), Some("en"));
    assert_eq!(
        fs::metadata(root.join("state.json"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    assert_eq!(
        fs::read_dir(root)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().starts_with(".tmp"))
            .count(),
        0
    );
}

#[test]
fn exclusive_migration_blocks_queue_writers_and_a_second_app_cannot_write() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("new");
    let store = Arc::new(Store::open(root.clone(), dir.path().join("old")));
    let second = Store::open(root.clone(), dir.path().join("old"));
    assert!(second
        .migrate(HashMap::new(), || Ok(()), || Ok(()), || {})
        .is_err());
    let (entered, wait) = mpsc::channel();
    let (resume, released) = mpsc::channel();
    let migrating = store.clone();
    let migration = std::thread::spawn(move || {
        migrating.migrate(
            HashMap::new(),
            || {
                entered.send(()).unwrap();
                released.recv().unwrap();
                Ok(())
            },
            || Ok(()),
            || {},
        )
    });
    wait.recv().unwrap();
    let (seen, observation) = mpsc::channel();
    let reading = store.clone();
    let observer = std::thread::spawn(move || seen.send(reading.snapshot()).unwrap());
    assert!(
        observation
            .recv_timeout(Duration::from_millis(100))
            .unwrap()
            .migration_pending
    );
    observer.join().unwrap();
    let (attempt, outcome) = mpsc::channel();
    let writing = store.clone();
    let writer = std::thread::spawn(move || {
        let _permit = writing.permit().unwrap();
        attempt.send(()).unwrap();
    });
    assert!(outcome.recv_timeout(Duration::from_millis(30)).is_err());
    resume.send(()).unwrap();
    migration.join().unwrap().unwrap();
    outcome.recv_timeout(Duration::from_secs(2)).unwrap();
    writer.join().unwrap();
    drop(store);
    assert!(second
        .migrate(HashMap::new(), || Ok(()), || Ok(()), || {})
        .is_ok());
}

#[test]
fn existing_toml_values_win_and_injected_configuration_is_safely_serialized() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("new");
    fs::create_dir(&root).unwrap();
    fs::write(
        root.join("config.toml"),
        "# 新配置\ntheme = 'light'\n[agents.codex]\nmodel = 'new'\n",
    )
    .unwrap();
    let store = Store::open(root.clone(), dir.path().join("old"));
    let page = HashMap::from([
        (
            "tandem.settings".into(),
            json!({"theme":"dark","uiFontSize":16}).to_string(),
        ),
        (
            "tandem.codexPrefs".into(),
            json!({"model":"old","effort":"xhigh"}).to_string(),
        ),
    ]);
    let saved = store.migrate(page, || Ok(()), || Ok(()), || {}).unwrap();
    assert_eq!(saved.config.theme, "light");
    assert_eq!(saved.config.ui_font_size, 16);
    assert_eq!(saved.config.agents.codex.model, "new");
    assert_eq!(saved.config.agents.codex.effort, "xhigh");
    let script = store.snapshot().initialization_script();
    assert!(matches!(
        store.snapshot().native_theme(),
        Some(tauri::Theme::Light)
    ));
    let json = script
        .lines()
        .next()
        .unwrap()
        .strip_prefix("window.__TANDEM_PREFERENCES__ = ")
        .unwrap()
        .strip_suffix(';')
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(json).unwrap()["config"]["theme"],
        "light"
    );
    assert!(fs::read_to_string(root.join("config.toml"))
        .unwrap()
        .contains("# 新配置"));
}

#[test]
fn removing_an_alias_and_unpinning_are_saved_without_reintroducing_old_state() {
    let dir = tempfile::tempdir().unwrap();
    let store = ready_store(dir.path().join("new"), dir.path().join("old"));
    store
        .update(
            "state",
            json!({"taskMeta":{"pins":["a"],"titles":{"a":"local","b":"keep"}}})
                .as_object()
                .unwrap()
                .clone(),
        )
        .unwrap();
    let saved = store
        .update(
            "state",
            json!({"taskMeta":{"pins":[],"titles":{"a":null}}})
                .as_object()
                .unwrap()
                .clone(),
        )
        .unwrap();
    assert!(saved.state.task_meta.pins.is_empty());
    assert_eq!(
        saved.state.task_meta.titles,
        HashMap::from([("b".into(), "keep".into())])
    );
}

#[test]
fn a_corrupt_source_or_state_never_gets_a_completion_marker_or_overwrites_user_data() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("new");
    let store = Store::open(root.clone(), dir.path().join("old"));
    let broken = HashMap::from([("tandem.settings".into(), "{half".into())]);
    assert!(store.migrate(broken, || Ok(()), || Ok(()), || {}).is_err());
    assert!(!root.join("state.json").exists());
    assert!(store.snapshot().migration_pending);
    fs::write(root.join("state.json"), b"{half").unwrap();
    assert!(store
        .migrate(HashMap::new(), || Ok(()), || Ok(()), || {})
        .is_err());
    assert_eq!(fs::read(root.join("state.json")).unwrap(), b"{half");
    fs::remove_file(root.join("state.json")).unwrap();
    store
        .migrate(HashMap::new(), || Ok(()), || Ok(()), || {})
        .unwrap();
}

#[test]
fn a_waiting_window_reloads_the_previous_owners_configuration_and_view_state() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("new");
    let first = ready_store(root.clone(), dir.path().join("old"));
    let waiting = Store::open(root, dir.path().join("old"));
    first
        .update(
            "config",
            json!({"theme":"dark"}).as_object().unwrap().clone(),
        )
        .unwrap();
    first
        .update(
            "state",
            json!({"taskMeta":{"pins":["new-pin"]}})
                .as_object()
                .unwrap()
                .clone(),
        )
        .unwrap();
    drop(first);
    let resumed = waiting
        .migrate(HashMap::new(), || Ok(()), || Ok(()), || {})
        .unwrap();
    assert_eq!(resumed.config.theme, "dark");
    assert_eq!(resumed.state.task_meta.pins, ["new-pin"]);
    assert!(waiting.permit().is_ok());
}

#[test]
fn system_language_is_memory_only_and_explicit_language_remains_authoritative() {
    let dir = tempfile::tempdir().unwrap();
    let store = ready_store(dir.path().join("new"), dir.path().join("old"));
    store.set_system_language("en".into()).unwrap();
    assert_eq!(store.remote_context().language.as_deref(), Some("en"));
    assert_eq!(store.snapshot().config.language, "system");
    store
        .update(
            "config",
            json!({"language":"zh"}).as_object().unwrap().clone(),
        )
        .unwrap();
    assert_eq!(store.remote_context().language.as_deref(), Some("zh"));
}

#[test]
fn manual_config_edits_during_migration_are_reloaded_before_commit() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("new");
    let store = Store::open(root.clone(), dir.path().join("old"));
    let checks = std::sync::atomic::AtomicUsize::new(0);
    let snapshot = store
        .migrate(
            HashMap::from([(
                "tandem.settings".into(),
                json!({"theme":"dark"}).to_string(),
            )]),
            || Ok(()),
            || {
                if checks.fetch_add(1, std::sync::atomic::Ordering::Relaxed) == 1 {
                    fs::write(root.join("config.toml"), "# 迁移时手改\ntheme = 'light'\n").unwrap();
                }
                Ok(())
            },
            || {},
        )
        .unwrap();
    assert_eq!(snapshot.config.theme, "light");
    assert!(fs::read_to_string(root.join("config.toml"))
        .unwrap()
        .contains("# 迁移时手改"));
}

#[test]
fn preference_preview_keeps_the_original_appearance_without_committing_migration() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("new");
    let store = Store::open(root.clone(), dir.path().join("old"));
    let page = HashMap::from([(
        "tandem.settings".into(),
        json!({"theme":"dark","uiFontSize":16}).to_string(),
    )]);
    let preview = store.preview(page.clone()).unwrap();
    assert_eq!(preview.config.theme, "dark");
    assert_eq!(preview.config.ui_font_size, 16);
    assert!(preview.migration_pending);
    assert!(store.permit().is_err());
    assert!(!root.join("config.toml").exists());
    assert!(!root.join("state.json").exists());
    assert!(
        !store
            .migrate(page, || Ok(()), || Ok(()), || {})
            .unwrap()
            .migration_pending
    );
}

#[test]
fn migrated_consumers_are_activated_before_waiting_writers_resume() {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(Store::open(dir.path().join("new"), dir.path().join("old")));
    let (activating, entered) = mpsc::channel();
    let (resume, wait) = mpsc::channel();
    let active = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let migrating = store.clone();
    let initialized = active.clone();
    let migration = std::thread::spawn(move || {
        migrating.migrate(
            HashMap::new(),
            || Ok(()),
            || Ok(()),
            || {
                assert_eq!(
                    migrating.snapshot().state.migration_version,
                    MIGRATION_VERSION
                );
                assert!(migrating.snapshot().migration_pending);
                activating.send(()).unwrap();
                wait.recv().unwrap();
                initialized.store(true, std::sync::atomic::Ordering::SeqCst);
            },
        )
    });
    entered.recv().unwrap();
    let (finished, outcome) = mpsc::channel();
    let writing = store.clone();
    let writer = std::thread::spawn(move || {
        let _permit = writing.permit().unwrap();
        assert!(active.load(std::sync::atomic::Ordering::SeqCst));
        finished.send(()).unwrap();
    });
    assert!(outcome.recv_timeout(Duration::from_millis(30)).is_err());
    resume.send(()).unwrap();
    migration.join().unwrap().unwrap();
    outcome.recv_timeout(Duration::from_secs(2)).unwrap();
    writer.join().unwrap();
}

#[test]
#[ignore = "explicit filesystem performance measurement"]
fn measure_large_queue_migration() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("new");
    let legacy = dir.path().join("old");
    let task = uuid::Uuid::new_v4().to_string();
    let images = legacy.join("queues/images").join(&task);
    fs::create_dir_all(&images).unwrap();
    // Valid tiny PNGs padded to 5 MiB measure copying/hashing costs, not raster decoding.
    use base64::Engine;
    let mut image = base64::engine::general_purpose::STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPwnnPiPwAFlAKv6q9jUgAAAABJRU5ErkJggg==").unwrap();
    let ending = image.split_off(image.len() - 12);
    let payload_size = 5 * 1024 * 1024 - image.len() - ending.len() - 12;
    image.extend_from_slice(&(payload_size as u32).to_be_bytes());
    image.extend_from_slice(b"npAd");
    image.resize(image.len() + payload_size, 0);
    image.extend_from_slice(&0x6f8c937f_u32.to_be_bytes());
    image.extend_from_slice(&ending);
    let mut entries = Vec::new();
    for _ in 0..20 {
        let id = uuid::Uuid::new_v4().to_string();
        fs::write(images.join(&id), &image).unwrap();
        entries.push(json!({"id":uuid::Uuid::new_v4(),"prompt":"measurement", "options":{}, "attachments":[{"id":id,"stored":{"ImageFile":{"name":"measurement.png","media_type":"image/png"}}}]}));
    }
    fs::write(legacy.join("queues").join(format!("{task}.json")), json!({"taskId":task,"agent":"claude","entries":entries,"paused":true,"error":null,"revision":1}).to_string()).unwrap();
    let store = Store::open(root.clone(), legacy.clone());
    let started = std::time::Instant::now();
    store
        .migrate(HashMap::new(), || Ok(()), || Ok(()), || {})
        .unwrap();
    let elapsed = started.elapsed();
    for entry in fs::read_dir(&images).unwrap() {
        let entry = entry.unwrap();
        assert_eq!(
            fs::read(
                root.join("queues/images")
                    .join(&task)
                    .join(entry.file_name())
            )
            .unwrap(),
            image
        );
    }
    println!(
        "migration_20x5MiB_ms={} source_preserved=true cache_created={}",
        elapsed.as_millis(),
        root.join("cache").exists()
    );
}

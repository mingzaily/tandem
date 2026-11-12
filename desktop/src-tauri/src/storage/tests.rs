use super::*;
use serde_json::json;
use std::os::unix::fs::PermissionsExt;

#[test]
fn collapsed_sidebar_groups_survive_restart_and_other_preference_updates() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_owned();
    let store = Store::open(root.clone());
    let groups = ["/code/app", "tandem:conversation", "/code/other:pi"];
    let saved = store.update("state", json!({"collapsedSidebarGroups":groups, "sidebarWidth":300}).as_object().unwrap().clone()).unwrap();
    assert_eq!(serde_json::to_value(&saved.state).unwrap()["collapsedSidebarGroups"], json!(groups));
    store.update("config", json!({"theme":"dark"}).as_object().unwrap().clone()).unwrap();
    store.update("state", json!({"pinnedProjects":["/code/other"]}).as_object().unwrap().clone()).unwrap();
    drop(store);
    let reopened = Store::open(root);
    let snapshot = reopened.snapshot();
    assert_eq!(serde_json::to_value(&snapshot.state).unwrap()["collapsedSidebarGroups"], json!(groups));
    assert_eq!(snapshot.state.sidebar_width, 300.);
    assert_eq!(snapshot.state.pinned_projects, ["/code/other"]);
    assert_eq!(snapshot.config.theme, "dark");
}

#[test]
fn previous_sidebar_state_defaults_new_groups_to_expanded() {
    let state: ViewState = serde_json::from_value(json!({"sidebarWidth":300, "projectOrder":["/code/app"]})).unwrap();
    assert_eq!(serde_json::to_value(&state).unwrap()["collapsedSidebarGroups"], json!([]));
    assert_eq!(state.project_order, ["/code/app"]);
    assert_eq!(state.sidebar_width, 300.);
}

#[test]
fn update_settings_survive_restart_and_accept_valid_hand_edits() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_owned();
    let store = Store::open(root.clone());
    store.update("config", json!({"auto_update":true,"update_check_interval_hours":12}).as_object().unwrap().clone()).unwrap();
    drop(store);
    let store = Store::open(root.clone());
    assert!(store.snapshot().config.auto_update);
    assert_eq!(store.snapshot().config.update_check_interval_hours, 12);
    let text = fs::read_to_string(root.join("config.toml")).unwrap();
    fs::write(root.join("config.toml"), text.replace("auto_update = true", "auto_update = false").replace("update_check_interval_hours = 12", "update_check_interval_hours = 24")).unwrap();
    assert!(store.poll().is_some());
    assert!(!store.snapshot().config.auto_update);
    assert_eq!(store.snapshot().config.update_check_interval_hours, 24);
    fs::write(root.join("config.toml"), "auto_update = true\nupdate_check_interval_hours = 0").unwrap();
    assert!(store.poll().is_some());
    assert!(!store.snapshot().config.auto_update);
    assert_eq!(store.snapshot().config.update_check_interval_hours, 24);
    assert!(!store.snapshot().errors.is_empty());
}

#[test]
fn damaged_state_is_preserved_and_keeps_sending_available() {
    for unreadable in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        if unreadable {
            fs::create_dir(&path).unwrap();
        } else {
            fs::write(&path, b"{broken state").unwrap();
        }
        let store = Store::open(dir.path().to_owned());
        assert!(
            store.ensure_writable().is_ok(),
            "view state must not block sending"
        );
        assert_eq!(store.snapshot().state.task_meta, TaskMeta::default());
        let preserved: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(Result::unwrap)
            .filter(|e| e.file_name().to_string_lossy().ends_with(".corrupt"))
            .collect();
        assert_eq!(preserved.len(), 1);
        assert!(!path.exists());
        assert!(
            store
                .snapshot()
                .errors
                .iter()
                .any(|error| error.contains(&path.display().to_string())
                    && error.contains(".corrupt"))
        );
    }
}

#[test]
fn missing_state_and_new_directory_are_immediately_writable() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("fresh");
    let store = Store::open(root.clone());
    assert!(store.ensure_writable().is_ok());
    assert!(root.join("config.toml").is_file());
    assert!(root.join(".gitignore").is_file());
    assert!(!root.join("cache").exists());
}

#[test]
fn a_second_instance_is_read_only_and_cannot_quarantine_the_owners_state() {
    let dir = tempfile::tempdir().unwrap();
    let owner = Store::open(dir.path().to_owned());
    owner
        .update(
            "config",
            json!({"theme":"dark"}).as_object().unwrap().clone(),
        )
        .unwrap();
    let path = dir.path().join("state.json");
    fs::write(&path, "{broken state").unwrap();
    let config_before = fs::read(dir.path().join("config.toml")).unwrap();
    let second = Store::open(dir.path().to_owned());
    assert_eq!(second.snapshot().config.theme, "dark");
    assert!(second
        .snapshot()
        .errors
        .iter()
        .any(|e| e.contains("另一个 Tandem")));
    assert!(second.ensure_writable().is_err());
    assert!(second
        .update(
            "state",
            json!({"sidebarWidth":300}).as_object().unwrap().clone()
        )
        .is_err());
    assert!(second
        .update(
            "config",
            json!({"theme":"light"}).as_object().unwrap().clone()
        )
        .is_err());
    assert_eq!(fs::read(&path).unwrap(), b"{broken state");
    assert_eq!(
        fs::read(dir.path().join("config.toml")).unwrap(),
        config_before
    );
    assert!(!fs::read_dir(dir.path()).unwrap().any(|e| e
        .unwrap()
        .file_name()
        .to_string_lossy()
        .ends_with(".corrupt")));
    drop(second);
    drop(owner);
    assert!(Store::open(dir.path().to_owned()).ensure_writable().is_ok());
}

#[test]
fn state_damaged_after_startup_is_preserved_before_a_new_view_write() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().to_owned());
    fs::write(dir.path().join("state.json"), "{broken state").unwrap();
    let saved = store
        .update(
            "state",
            json!({"sidebarWidth":300}).as_object().unwrap().clone(),
        )
        .unwrap();
    assert_eq!(saved.state.sidebar_width, 300.);
    assert!(saved.errors.iter().any(|e| e.contains(".corrupt")));
    assert!(store.ensure_writable().is_ok());
}

#[test]
fn a_failed_state_quarantine_keeps_the_original_instead_of_replacing_it() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().to_owned());
    let path = dir.path().join("state.json");
    fs::write(&path, "{broken state").unwrap();
    // atomic_write restores directory permissions. It must only run after preservation succeeds.
    fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o500)).unwrap();
    let saved = store.update(
        "state",
        json!({"sidebarWidth":300}).as_object().unwrap().clone(),
    );
    fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
    assert!(
        saved.is_err(),
        "a failed quarantine must preserve the original"
    );
    assert_eq!(fs::read_to_string(path).unwrap(), "{broken state");
    assert!(
        store.ensure_writable().is_ok(),
        "state persistence must not block sending"
    );
}

#[test]
fn gitignore_keeps_user_entries_and_adds_private_paths_once() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join(".gitignore"), "# user entry\nnotes/").unwrap();
    drop(Store::open(dir.path().to_owned()));
    drop(Store::open(dir.path().to_owned()));
    let text = fs::read_to_string(dir.path().join(".gitignore")).unwrap();
    assert!(text.starts_with("# user entry\nnotes/\n"));
    for line in ["/remote.json", "/cache/", "/logs/", "/.storage.lock", ".tmp*"] {
        assert_eq!(text.lines().filter(|value| *value == line).count(), 1);
    }
}

#[test]
fn unknown_state_fields_are_discarded_without_losing_known_values() {
    let state: ViewState = serde_json::from_value(json!({
        "migrationVersion": 1, "futureView": true,
        "taskMeta": {"pins":["keep"], "futureTask": true}, "sidebarWidth":300
    }))
    .unwrap();
    assert_eq!(state.task_meta.pins, ["keep"]);
    assert_eq!(state.sidebar_width, 300.);
    assert!(serde_json::to_value(state)
        .unwrap()
        .get("migrationVersion")
        .is_none());
}

#[test]
fn unknown_config_fields_warn_while_known_fields_apply_and_comments_survive() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("new");
    let store = Store::open(root.clone());
    let path = root.join("config.toml");
    fs::write(&path, "theme = 'dark'\nthem = 'light' # typo\n[agents.codex]\nefort = 'high' # typo too\nmodel = 'custom'\n").unwrap();
    let snapshot = store.poll().unwrap();
    assert_eq!(snapshot.config.theme, "dark");
    assert_eq!(snapshot.config.agents.codex.model, "custom");
    let errors = snapshot.errors.join("\n");
    assert!(
        errors.contains("them") && errors.contains("agents.codex.efort"),
        "{errors}"
    );
    let saved = store
        .update(
            "config",
            json!({"ui_font_size":16}).as_object().unwrap().clone(),
        )
        .unwrap();
    assert_eq!(saved.config.theme, "dark");
    assert!(saved.errors.join("\n").contains("agents.codex.efort"));
    assert!(fs::read_to_string(&path).unwrap().contains("# typo too"));
    fs::write(&path, "theme = 'light'\n").unwrap();
    assert!(store.poll().unwrap().errors.is_empty());
}

#[test]
fn manual_edits_apply_and_invalid_files_stay_intact_until_the_user_repairs_them() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("new");
    let store = Store::open(root.clone());
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
    let store = Store::open(root.clone());
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
    let store = Store::open(root.clone());
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
fn removing_an_alias_and_unpinning_are_saved_without_reintroducing_old_state() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("new"));
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
fn system_language_is_memory_only_and_explicit_language_remains_authoritative() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("new"));
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

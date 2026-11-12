use super::*;
use serde_json::json;

fn write(path: &Path, text: &str) { fs::create_dir_all(path.parent().unwrap()).unwrap(); fs::write(path, text).unwrap(); }

#[test]
fn inventories_each_cli_with_global_and_project_provenance_and_keeps_configuration_bytes() {
    let temp = tempfile::tempdir().unwrap();
    let paths = Locations::at(temp.path().join("home"));
    let project = temp.path().join("project");
    fs::create_dir_all(project.join(".git")).unwrap();
    let files = [
        (paths.home.join(".claude.json"), json!({"mcpServers":{"global-claude":{"command":"npx","args":["secret-token"],"env":{"TOKEN":"private"}}},"projects":{project.to_str().unwrap():{"mcpServers":{"local-claude":{"type":"http","url":"https://host?token=private"}}}}}).to_string()),
        (project.join(".mcp.json"), json!({"mcpServers":{"shared-claude":{"type":"sse"}}}).to_string()),
        (paths.codex.join("config.toml"), "[mcp_servers.global-codex]\ncommand = 'uvx'\n[mcp_servers.global-codex.env]\nKEY = 'private'\n".into()),
        (project.join(".codex/config.toml"), "[mcp_servers.project-codex]\nurl = 'https://host'\n".into()),
        (paths.pi.join("mcp.json"), json!({"mcpServers":{"global-pi":{"command":"pi-tool"}}}).to_string()),
        (project.join(".pi/mcp.json"), json!({"mcpServers":{"project-pi":{"url":"https://host"}}}).to_string()),
        (paths.global_lock.clone(), json!({"version":3,"skills":{"shared":{"source":"owner/global-skills"}}}).to_string()),
        (project.join("skills-lock.json"), json!({"version":1,"skills":{"project-skill":{"source":"owner/project-skills"}}}).to_string()),
    ];
    for (path, text) in &files { write(path, text); }
    for dir in [paths.claude.join("skills"), paths.codex.join("skills"), paths.pi.join("skills")] {
        write(&dir.join("shared/SKILL.md"), "---\nname: shared\ndescription: >-\n  First line\n  second line\n---\nPrivate body\n");
    }
    for dir in [".claude", ".codex", ".pi"] { write(&project.join(dir).join("skills/project-skill/SKILL.md"), "---\nname: project-skill\ndescription: 'Project: metadata'\n---\n"); }
    let result = read(&paths, Some(&project));
    assert_eq!(result.iter().map(|item| item.mcp_servers.len()).collect::<Vec<_>>(), [3, 2, 2]);
    for item in &result {
        assert!(item.errors.is_empty(), "{}", serde_json::to_string(&item.errors).unwrap());
        let global = item.skills.iter().find(|skill| skill.scope == Scope::Global).unwrap();
        assert_eq!(global.description, "First line second line");
        assert_eq!(global.repository.as_deref(), Some("owner/global-skills"));
        let local = item.skills.iter().find(|skill| skill.scope == Scope::Project).unwrap();
        assert_eq!(local.repository.as_deref(), Some("owner/project-skills"));
        assert!(global.managed && local.managed);
    }
    let visible = serde_json::to_string(&result).unwrap();
    for private in ["private", "secret-token", "Private body"] { assert!(!visible.contains(private)); }
    for (path, text) in &files { assert_eq!(fs::read_to_string(path).unwrap(), *text); }
}

#[test]
fn malformed_files_report_errors_in_their_cli_section_and_other_sections_continue() {
    let temp = tempfile::tempdir().unwrap();
    let paths = Locations::at(temp.path().join("home"));
    write(&paths.home.join(".claude.json"), "{broken private");
    write(&paths.codex.join("config.toml"), "[mcp_servers\nTOKEN='private'");
    write(&paths.pi.join("skills/bad/SKILL.md"), "---\nname: bad\ndescription: [\n---\n");
    write(&paths.global_lock, "{broken private");
    let result = read(&paths, None);
    assert!(result[0].errors.iter().any(|error| error.section == "mcp"));
    assert!(result[1].errors.iter().any(|error| error.section == "mcp"));
    assert!(result[2].errors.iter().any(|error| error.section == "skills" && error.path.ends_with("SKILL.md")));
    assert!(!serde_json::to_string(&result).unwrap().contains("private"));
}

#[test]
fn custom_claude_configuration_home_and_pi_skill_paths_use_their_actual_roots() {
    let temp = tempfile::tempdir().unwrap();
    let mut paths = Locations::at(temp.path().join("home"));
    paths.claude = temp.path().join("claude-profile");
    paths.claude_config = paths.claude.join(".claude.json");
    write(&paths.claude_config, r#"{"mcpServers":{"profile":{"command":"tool"}}}"#);
    write(&paths.pi.join("settings.json"), r#"{"skills":["custom"]}"#);
    write(&paths.pi.join("custom/example.md"), "---\nname: example\ndescription: Standalone skill\n---\n");
    let result = read(&paths, None);
    assert_eq!(result[0].mcp_servers[0].name, "profile");
    assert_eq!(result[2].skills[0].name, "example");
    assert!(!result[2].skills[0].managed);
}

#[test]
fn symlinked_shared_skills_are_deduplicated_and_ancestor_scans_stop_at_the_repository() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let paths = Locations::at(temp.path().join("home"));
    let project = temp.path().join("project");
    let cwd = project.join("nested");
    fs::create_dir_all(project.join(".git")).unwrap();
    fs::create_dir_all(&cwd).unwrap();
    let skill = paths.home.join(".agents/skills/shared");
    write(&skill.join("SKILL.md"), "---\nname: shared\ndescription: Shared\n---\n");
    fs::create_dir_all(paths.codex.join("skills")).unwrap();
    symlink(&skill, paths.codex.join("skills/shared")).unwrap();
    symlink(paths.home.join(".agents/skills"), skill.join("cycle")).unwrap();
    write(&project.join(".agents/skills/project/SKILL.md"), "---\nname: project\ndescription: Project\n---\n");
    write(&temp.path().join(".agents/skills/outside/SKILL.md"), "---\nname: outside\ndescription: Outside\n---\n");
    let result = read(&paths, Some(&cwd));
    assert_eq!(result[1].skills.len(), 2);
    assert_eq!(result[2].skills.len(), 2);
    assert!(result.iter().flat_map(|item| &item.skills).all(|skill| skill.name != "outside"));
}

#[test]
fn pi_with_the_mcp_adapter_lists_its_shared_sources_and_imports() {
    let temp = tempfile::tempdir().unwrap();
    let paths = Locations::at(temp.path().join("home"));
    let project = temp.path().join("project");
    fs::create_dir_all(project.join(".git")).unwrap();
    write(&paths.pi.join("settings.json"), &json!({"extensions":["-builtin:mcp"],"packages":["npm:pi-mcp-adapter"]}).to_string());
    write(&paths.home.join(".config/mcp/mcp.json"), &json!({"mcpServers":{"devtools":{"command":"npx"},"shadowed":{"command":"old"}}}).to_string());
    write(&paths.pi.join("mcp-adapter.json"), &json!({"imports":["claude-code","codex","opencode"],"mcpServers":{"computer-use":{"command":"cu"}}}).to_string());
    write(&project.join(".pi/mcp-adapter.json"), &json!({"imports":["codex"],"mcpServers":{"shadowed":{"url":"https://new"}}}).to_string());
    // Imported entries rank below the adapter's own: its computer-use replaces Claude's.
    write(&paths.home.join(".claude.json"), &json!({"mcpServers":{"context7":{"command":"npx"},"computer-use":{"command":"claude-cu"}}}).to_string());
    write(&paths.home.join(".codex/config.toml"), "[mcp_servers.fetch]\ncommand = \"uvx\"\n");
    let pi = read(&paths, Some(&project)).pop().unwrap();
    let servers: Vec<_> = pi.mcp_servers.iter().map(|server| (server.name.as_str(), server.command.as_deref(), server.imported_from.as_deref())).collect();
    assert_eq!(servers, [
        ("fetch", Some("uvx"), Some("codex")),
        ("context7", Some("npx"), Some("claude-code")),
        ("devtools", Some("npx"), None),
        ("computer-use", Some("cu"), None),
        ("shadowed", None, None),
    ]);
    // OpenCode's merged files are not followed, so it stays a note.
    assert_eq!(pi.notes.len(), 1);
    assert_eq!((pi.notes[0].kind, pi.notes[0].detail.as_str()), ("mcpImports", "opencode"));
    assert!(pi.mcp_servers.iter().all(|server| server.provider == Some("pi-mcp-adapter")));
    assert!(pi.errors.is_empty());
}

#[test]
fn pi_without_built_in_mcp_or_an_adapter_says_so() {
    let temp = tempfile::tempdir().unwrap();
    let paths = Locations::at(temp.path().join("home"));
    write(&paths.pi.join("settings.json"), &json!({"extensions":["-builtin:mcp"]}).to_string());
    write(&paths.pi.join("mcp.json"), &json!({"mcpServers":{"ignored":{"command":"x"}}}).to_string());
    let pi = read(&paths, None).pop().unwrap();
    assert!(pi.mcp_servers.is_empty());
    assert_eq!(pi.notes[0].kind, "piMcpDisabled");
}


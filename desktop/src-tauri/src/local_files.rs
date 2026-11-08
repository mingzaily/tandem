use std::path::{Component, Path, PathBuf};

/// Markdown links are local path references; only open_external accepts network URLs.
pub fn resolve(cwd: &Path, home: &Path, target: &str) -> Result<PathBuf, String> {
    if target.is_empty() || target.starts_with("//") || target.contains("://") || target.contains('\0') {
        return Err("文件链接需要本机路径".into());
    }
    let path = if let Some(relative) = target.strip_prefix("~/") {
        home.join(relative)
    } else if Path::new(target).is_absolute() {
        target.into()
    } else {
        cwd.join(target)
    };
    let mut result = PathBuf::new();
    for part in path.components() {
        match part {
            Component::ParentDir => { result.pop(); }
            Component::CurDir => {}
            part => result.push(part.as_os_str()),
        }
    }
    Ok(result)
}

/// Links come from model output. Opening these would launch something, so they are shown in Finder instead.
pub fn runs_when_opened(path: &Path) -> bool {
    const LAUNCHING: [&str; 9] = ["app", "command", "tool", "terminal", "workflow", "pkg", "mpkg", "scpt", "applescript"];
    path.extension().and_then(|extension| extension.to_str())
        .is_some_and(|extension| LAUNCHING.contains(&extension.to_ascii_lowercase().as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_native_task_paths_and_preserves_shell_characters_as_path_text() {
        let cwd = Path::new("/project/worktree");
        let home = Path::new("/user");
        assert_eq!(resolve(cwd, home, "../a b's.md").unwrap(), Path::new("/project/a b's.md"));
        assert_eq!(resolve(cwd, home, "~/a.ts").unwrap(), Path::new("/user/a.ts"));
        for target in ["https://host/a", "//host/a", ""] { assert!(resolve(cwd, home, target).is_err()); }
    }

    #[test]
    fn launching_files_are_revealed_instead_of_opened() {
        for path in ["/A.app", "/run.command", "/x.Terminal", "/i.pkg"] { assert!(runs_when_opened(Path::new(path)), "{path}"); }
        for path in ["/a.ts", "/README.md", "/dir"] { assert!(!runs_when_opened(Path::new(path)), "{path}"); }
    }
}

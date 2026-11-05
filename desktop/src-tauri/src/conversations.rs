//! Tasks that belong to no project. Each conversation gets its own folder under `~/.tandem`, so
//! files an agent writes for one do not land next to another's.

use crate::sessions::{is_under, DiscoveredProject};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

pub fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME").map(Into::into).ok_or_else(|| "HOME is not set".to_owned())
}

pub fn default_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".tandem").join("conversations"))
}

pub fn create_dir(base: Option<&str>) -> Result<String, String> {
    let base = match base {
        Some(base) if Path::new(base).is_absolute() => PathBuf::from(base),
        Some(_) => return Err("The conversation folder must be an absolute path".to_owned()),
        None => default_dir()?,
    };
    let id = uuid::Uuid::new_v4().simple().to_string();
    let dir = base.join(&id[..12]);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let dir = fs::canonicalize(&dir).map_err(|error| error.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Codex filters by exact folder, so each conversation has to be named.
pub fn expand_roots(mut roots: Vec<String>, conversation_roots: &[String]) -> Vec<String> {
    for root in conversation_roots {
        let Ok(entries) = fs::read_dir(root) else { continue };
        roots.extend(
            entries
                .flatten()
                .filter(|entry| entry.path().is_dir())
                .filter_map(|entry| entry.path().to_str().map(str::to_owned)),
        );
    }
    roots
}

const WORKTREE_FOLDER: &str = "/.claude/worktrees/";

/// One row per real project: no worktrees, no conversations, no temp or missing folders.
pub fn usable_projects(found: Vec<DiscoveredProject>, home: &Path) -> Vec<DiscoveredProject> {
    let is_temp = |cwd: &str| ["/tmp", "/private/tmp", "/private/var", "/var/folders"].iter().any(|root| is_under(cwd, root));
    distinct_projects(found, home, is_temp)
}

fn distinct_projects(found: Vec<DiscoveredProject>, home: &Path, is_temp: impl Fn(&str) -> bool) -> Vec<DiscoveredProject> {
    let own_data = home.join(".tandem");
    let own_data = own_data.to_string_lossy();
    let mut newest: HashMap<String, u64> = HashMap::new();
    for project in found {
        let cwd = project.cwd.split(WORKTREE_FOLDER).next().unwrap_or(&project.cwd).to_owned();
        if is_temp(&cwd) || is_under(&cwd, &own_data) || !Path::new(&cwd).is_dir() {
            continue;
        }
        let latest = newest.entry(cwd).or_default();
        *latest = (*latest).max(project.last_active_ms);
    }
    let mut projects: Vec<DiscoveredProject> = newest
        .into_iter()
        .map(|(cwd, last_active_ms)| DiscoveredProject { cwd, last_active_ms })
        .collect();
    projects.sort_by(|a, b| b.last_active_ms.cmp(&a.last_active_ms));
    projects
}

pub fn file_stamp(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis();
    Some(format!("{modified}:{}", metadata.len()))
}

pub fn written_within(path: &Path, window: Duration) -> bool {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.elapsed().ok())
        .is_some_and(|age| age < window)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn found(cwd: &str, last_active_ms: u64) -> DiscoveredProject {
        DiscoveredProject { cwd: cwd.to_owned(), last_active_ms }
    }

    #[test]
    fn creates_one_folder_per_conversation() {
        let base = tempfile::tempdir().unwrap();
        let base_path = base.path().to_str().unwrap();
        let first = create_dir(Some(base_path)).unwrap();
        let second = create_dir(Some(base_path)).unwrap();
        assert_ne!(first, second);
        assert!(Path::new(&first).is_dir());
        assert!(create_dir(Some("relative/path")).is_err());
    }

    #[test]
    fn names_each_conversation_folder_for_codex() {
        let base = tempfile::tempdir().unwrap();
        fs::create_dir(base.path().join("one")).unwrap();
        fs::write(base.path().join("note.txt"), "").unwrap();
        let roots = expand_roots(vec!["/code/app".to_owned()], &[base.path().to_str().unwrap().to_owned()]);
        assert_eq!(roots.len(), 2);
        assert!(roots[1].ends_with("/one"));
    }

    #[test]
    fn offers_real_projects_once_and_newest_first() {
        let home = tempfile::tempdir().unwrap();
        let old = home.path().join("old");
        let new = home.path().join("new");
        fs::create_dir(&old).unwrap();
        fs::create_dir(&new).unwrap();
        let old = old.to_str().unwrap().to_owned();
        let new = new.to_str().unwrap().to_owned();
        let projects = distinct_projects(
            vec![
                found(&old, 1),
                found(&new, 2),
                found(&format!("{new}/.claude/worktrees/w"), 9),
                found(&format!("{new}/scratch"), 99),
                found("/does/not/exist", 99),
                found(home.path().join(".tandem/conversations/a").to_str().unwrap(), 99),
            ],
            home.path(),
            |cwd| cwd.ends_with("/scratch"),
        );
        assert_eq!(projects, vec![found(&new, 9), found(&old, 1)]);
    }

    #[test]
    fn a_stamp_changes_with_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("task");
        fs::write(&path, "a").unwrap();
        let first = file_stamp(&path).unwrap();
        fs::write(&path, "ab").unwrap();
        assert_ne!(first, file_stamp(&path).unwrap());
        assert!(file_stamp(&dir.path().join("none")).is_none());
    }

    #[test]
    fn temp_folders_are_not_offered() {
        assert!(usable_projects(vec![found("/private/tmp", 1), found("/tmp/x", 1)], Path::new("/nowhere")).is_empty());
    }
}

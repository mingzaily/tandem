//! Reads the current branch from Git's files. Running `git` in a project could run its
//! configured programs, and this needs none of that.

use std::fs;
use std::path::{Path, PathBuf};

const SHORT_SHA_LENGTH: usize = 7;

/// The Git directory for `start`, following the `.git` file a worktree has in place of a folder.
fn git_dir(start: &Path) -> Option<PathBuf> {
    start.ancestors().find_map(|dir| {
        let candidate = dir.join(".git");
        if candidate.is_dir() {
            return Some(candidate);
        }
        let pointer = fs::read_to_string(&candidate).ok()?;
        let target = pointer.trim().strip_prefix("gitdir: ")?;
        Some(dir.join(target))
    })
}

pub fn current_branch(cwd: &Path) -> Option<String> {
    let head = fs::read_to_string(git_dir(cwd)?.join("HEAD")).ok()?;
    let head = head.trim();
    if let Some(branch) = head.strip_prefix("ref: refs/heads/") {
        return Some(branch.to_owned());
    }
    // A detached HEAD holds a commit id.
    let is_commit = head.len() > SHORT_SHA_LENGTH && head.chars().all(|c| c.is_ascii_hexdigit());
    is_commit.then(|| head[..SHORT_SHA_LENGTH].to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(head: &str) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".git/HEAD"), head).unwrap();
        dir
    }

    #[test]
    fn reads_a_branch_from_a_subfolder() {
        let dir = repo("ref: refs/heads/feat/a-b\n");
        let nested = dir.path().join("src/deep");
        fs::create_dir_all(&nested).unwrap();
        assert_eq!(current_branch(&nested).unwrap(), "feat/a-b");
    }

    #[test]
    fn shortens_a_detached_head() {
        let dir = repo("b4fda30aa11223344556677889900aabbccddeeff\n");
        assert_eq!(current_branch(dir.path()).unwrap(), "b4fda30");
    }

    #[test]
    fn follows_a_worktree_pointer() {
        let main = repo("ref: refs/heads/main\n");
        let linked = main.path().join(".git/worktrees/w");
        fs::create_dir_all(&linked).unwrap();
        fs::write(linked.join("HEAD"), "ref: refs/heads/worktree-w\n").unwrap();
        let checkout = tempfile::tempdir().unwrap();
        fs::write(checkout.path().join(".git"), format!("gitdir: {}\n", linked.display())).unwrap();
        assert_eq!(current_branch(checkout.path()).unwrap(), "worktree-w");
    }

    #[test]
    fn a_folder_outside_git_has_no_branch() {
        let dir = tempfile::tempdir().unwrap();
        // The temp folder's own parents are not repositories on a normal machine.
        assert!(git_dir(dir.path()).is_none_or(|found| !found.starts_with(dir.path())));
    }
}

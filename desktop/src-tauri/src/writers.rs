//! Other processes that have a task open. The CLI lists each running session in
//! `<config>/sessions/<pid>.json`. Two writers on one task split its history into branches, and
//! the file format cannot prevent that, so Tandem has to look first.

use serde::{Deserialize, Serialize};
use std::fs;
use std::os::fd::AsRawFd;
use std::path::Path;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryEntry {
    pid: i32,
    session_id: String,
    status: Option<String>,
    entrypoint: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalWriter {
    pub task_id: String,
    pub pid: i32,
    /// Working now, rather than open and waiting for its user.
    pub is_busy: bool,
    /// Started by a person in a terminal, rather than by another program.
    pub from_terminal: bool,
    /// Claude lets a second process write anyway. Codex refuses, so offering would be pointless.
    pub can_override: bool,
}

/// A crash leaves its entry behind, so an entry only counts while its process is alive. A reused
/// pid can still pass this, which costs at most one warning the user can dismiss.
fn is_alive(pid: i32) -> bool {
    if pid <= 0 {
        return false;
    }
    // Signal 0 checks without sending anything. EPERM means alive but owned by someone else.
    let answered = unsafe { libc::kill(pid, 0) } == 0;
    answered || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

pub fn read_writers(sessions_dir: &Path) -> Vec<ExternalWriter> {
    let Ok(entries) = fs::read_dir(sessions_dir) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|extension| extension == "json"))
        // A file being rewritten can fail to parse. The next look will see it.
        .filter_map(|entry| serde_json::from_slice::<RegistryEntry>(&fs::read(entry.path()).ok()?).ok())
        .filter(|entry| is_alive(entry.pid))
        .map(|entry| ExternalWriter {
            task_id: entry.session_id,
            pid: entry.pid,
            is_busy: entry.status.as_deref() == Some("busy"),
            from_terminal: entry.entrypoint.as_deref() == Some("cli"),
            can_override: true,
        })
        .collect()
}

/// Codex holds an flock on `<id>.lock` while a process has the thread open. This takes a shared
/// lock for an instant to see, because the files carry nothing else. A writer starting in that
/// same instant could be refused once, and its next attempt would succeed.
pub fn read_codex_writers(locks_dir: &Path) -> Vec<ExternalWriter> {
    let Ok(entries) = fs::read_dir(locks_dir) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension()? != "lock" {
                return None;
            }
            let task_id = path.file_stem()?.to_str()?.to_owned();
            let file = fs::File::open(&path).ok()?;
            let is_free = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_SH | libc::LOCK_NB) } == 0;
            if is_free {
                unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_UN) };
                return None;
            }
            Some(ExternalWriter { task_id, pid: 0, is_busy: false, from_terminal: false, can_override: false })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn dead_pid() -> i32 {
        let mut child = std::process::Command::new("true").spawn().unwrap();
        let pid = child.id() as i32;
        child.wait().unwrap();
        pid
    }

    #[test]
    fn lists_live_sessions_and_skips_dead_ones_and_other_files() {
        let dir = tempfile::tempdir().unwrap();
        let me = std::process::id() as i32;
        let write = |name: &str, value: serde_json::Value| fs::write(dir.path().join(name), value.to_string()).unwrap();
        write("1.json", json!({"pid": me, "sessionId": "busy-cli", "status": "busy", "entrypoint": "cli"}));
        write("2.json", json!({"pid": me, "sessionId": "idle-sdk", "status": "idle", "entrypoint": "sdk-cli"}));
        write("3.json", json!({"pid": dead_pid(), "sessionId": "gone", "status": "busy", "entrypoint": "cli"}));
        write("1.abc.key", json!({"pid": me, "sessionId": "key-file"}));
        fs::write(dir.path().join("4.json"), "{half").unwrap();

        let mut writers = read_writers(dir.path());
        writers.sort_by(|a, b| a.task_id.cmp(&b.task_id));
        assert_eq!(writers.len(), 2);
        assert_eq!(writers[0], ExternalWriter { task_id: "busy-cli".into(), pid: me, is_busy: true, from_terminal: true, can_override: true });
        assert_eq!(writers[1], ExternalWriter { task_id: "idle-sdk".into(), pid: me, is_busy: false, from_terminal: false, can_override: true });
    }

    #[test]
    fn a_held_codex_lock_is_a_writer_and_a_free_one_is_not() {
        let dir = tempfile::tempdir().unwrap();
        let held = dir.path().join("held.lock");
        fs::write(&held, "").unwrap();
        fs::write(dir.path().join("free.lock"), "").unwrap();
        fs::write(dir.path().join("note.txt"), "").unwrap();
        let holder = fs::File::open(&held).unwrap();
        assert_eq!(unsafe { libc::flock(holder.as_raw_fd(), libc::LOCK_EX) }, 0);

        let writers = read_codex_writers(dir.path());
        assert_eq!(writers.len(), 1);
        assert_eq!(writers[0].task_id, "held");
        assert!(!writers[0].can_override);
    }

    #[test]
    fn a_missing_folder_means_no_writers() {
        assert!(read_writers(Path::new("/nonexistent/tandem")).is_empty());
    }
}

//! Other processes that have a task open: Claude's PID registry, Codex's native locks and
//! Pi's explicit session arguments. Two writers can branch one task, so Tandem checks before
//! sending and follows the active external writer's native file.

mod pi;
pub use pi::read_pi_writers;

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::os::fd::AsRawFd;
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryEntry {
    pid: i32,
    session_id: String,
    status: Option<String>,
    entrypoint: Option<String>,
    kind: Option<String>,
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
    /// Claude and Pi allow a second writer; Codex holds a native file lock.
    /// An explicit override remains a user choice.
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
            // Wrappers can start the interactive CLI through the SDK entry point; `kind` still says a person has it open.
            from_terminal: entry.entrypoint.as_deref() == Some("cli") || entry.kind.as_deref() == Some("interactive"),
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

/// A long read of the end of a large file would run every few seconds, so this gives up early.
const ROLLOUT_TAIL_BYTES: u64 = 4 * 1024 * 1024;
/// A turn the CLI never closed, such as after a crash, should not read as running forever.
const STUCK_TURN: Duration = Duration::from_secs(30 * 60);
/// With no turn marker in reach, a recent write is the next best sign.
const RECENT_WRITE: Duration = Duration::from_secs(20);

fn last_turn_marker(tail: &[u8]) -> Option<bool> {
    for line in tail.rsplit(|byte| *byte == b'\n') {
        // Most lines hold neither marker, and some hold whole images, so parsing is left until here.
        let text = String::from_utf8_lossy(line);
        let is_marker = ["task_started", "task_complete", "turn_aborted"].iter().any(|marker| text.contains(marker));
        if !is_marker {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        if value.get("type").and_then(serde_json::Value::as_str) != Some("event_msg") {
            continue;
        }
        match value.pointer("/payload/type").and_then(serde_json::Value::as_str) {
            Some("task_started") => return Some(true),
            Some("task_complete" | "turn_aborted") => return Some(false),
            _ => {}
        }
    }
    None
}

/// Codex writes nothing while it waits for a long reply, so the time of the last write cannot tell
/// a quiet turn from an idle thread. The file's turn markers can.
pub fn codex_turn_running(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    let age = metadata.modified().ok().and_then(|modified| modified.elapsed().ok()).unwrap_or(Duration::MAX);
    if age > STUCK_TURN {
        return false;
    }
    let tail = (|| {
        let mut file = fs::File::open(path).ok()?;
        file.seek(SeekFrom::Start(metadata.len().saturating_sub(ROLLOUT_TAIL_BYTES))).ok()?;
        let mut tail = Vec::new();
        file.read_to_end(&mut tail).ok()?;
        Some(tail)
    })();
    tail.and_then(|tail| last_turn_marker(&tail)).unwrap_or(age < RECENT_WRITE)
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
        write("5.json", json!({"pid": me, "sessionId": "wrapped-cli", "status": "busy", "entrypoint": "sdk-cli", "kind": "interactive"}));
        write("1.abc.key", json!({"pid": me, "sessionId": "key-file"}));
        fs::write(dir.path().join("4.json"), "{half").unwrap();

        let mut writers = read_writers(dir.path());
        writers.sort_by(|a, b| a.task_id.cmp(&b.task_id));
        assert_eq!(writers.len(), 3);
        assert_eq!(writers[0], ExternalWriter { task_id: "busy-cli".into(), pid: me, is_busy: true, from_terminal: true, can_override: true });
        assert_eq!(writers[1], ExternalWriter { task_id: "idle-sdk".into(), pid: me, is_busy: false, from_terminal: false, can_override: true });
        assert_eq!(writers[2], ExternalWriter { task_id: "wrapped-cli".into(), pid: me, is_busy: true, from_terminal: true, can_override: true });
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
        assert!(!writers[0].is_busy);
        // A cloned descriptor also models the copy briefly inherited by a concurrent child
        // before exec. Unlock the shared file description explicitly before checking release.
        let inherited = holder.try_clone().unwrap();
        drop(holder);
        assert_eq!(read_codex_writers(dir.path()).len(), 1);
        assert_eq!(unsafe { libc::flock(inherited.as_raw_fd(), libc::LOCK_UN) }, 0);
        drop(inherited);
        assert!(read_codex_writers(dir.path()).is_empty());
    }

    #[test]
    fn a_missing_folder_means_no_writers() {
        assert!(read_writers(Path::new("/nonexistent/tandem")).is_empty());
    }

    fn rollout_line(kind: &str) -> String {
        json!({"type": "event_msg", "payload": {"type": kind}}).to_string()
    }

    #[test]
    fn a_quiet_codex_turn_still_counts_as_running() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rollout.jsonl");
        let lines = [rollout_line("task_started"), rollout_line("agent_message")].join("\n");
        fs::write(&path, &lines).unwrap();
        assert!(codex_turn_running(&path));
        fs::write(&path, [lines, rollout_line("task_complete")].join("\n")).unwrap();
        assert!(!codex_turn_running(&path));
    }

    #[test]
    fn only_real_markers_count() {
        let quoted = json!({"type": "response_item", "payload": {"text": "task_started"}}).to_string();
        let tail = [rollout_line("task_complete"), quoted].join("\n");
        assert_eq!(last_turn_marker(tail.as_bytes()), Some(false));
        assert_eq!(last_turn_marker(rollout_line("turn_aborted").as_bytes()), Some(false));
        assert_eq!(last_turn_marker(b"{half"), None);
    }
}

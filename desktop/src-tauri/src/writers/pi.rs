//! Live Pi processes with an explicit native session. Pi has no file lock or PID registry.

use super::{is_alive, ExternalWriter, ROLLOUT_TAIL_BYTES};
use serde_json::Value;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;

pub fn read_pi_writers(sessions: &Path) -> Vec<ExternalWriter> {
    if !sessions.is_dir() {
        return Vec::new();
    }
    let Ok(output) = Command::new("/bin/ps")
        .args(["-axo", "pid=,comm="])
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let (pid, command) = line.trim().split_once(char::is_whitespace)?;
            let program = Path::new(command.trim()).file_name()?.to_str()?;
            if !matches!(program, "pi" | "node" | "bun") {
                return None;
            }
            let pid = pid.parse().ok()?;
            writer_for_args(pid, &process_args(pid)?, sessions)
        })
        .collect()
}

/// KERN_PROCARGS2 preserves argument boundaries even when a session path contains spaces.
/// Only argc arguments are returned; the environment after them stays inside the buffer.
#[cfg(any(target_os = "macos", test))]
fn decode_process_args(bytes: &[u8]) -> Option<Vec<String>> {
    let argc = usize::try_from(i32::from_ne_bytes(bytes.get(..4)?.try_into().ok()?)).ok()?;
    if argc == 0 {
        return None;
    }
    let tail = bytes.get(4..)?;
    let mut rest = tail.get(tail.iter().position(|byte| *byte == 0)? + 1..)?;
    rest = rest.get(rest.iter().position(|byte| *byte != 0)?..)?;
    let mut args = Vec::new();
    for _ in 0..argc {
        let end = rest.iter().position(|byte| *byte == 0)?;
        args.push(String::from_utf8_lossy(&rest[..end]).into_owned());
        rest = &rest[end + 1..];
    }
    Some(args)
}

#[cfg(target_os = "macos")]
fn process_args(pid: i32) -> Option<Vec<String>> {
    let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid];
    let mut size = 0;
    // SAFETY: the first call queries size; the second writes into a buffer of that size.
    // Processes can exit between calls, in which case the failed query is skipped.
    unsafe {
        if libc::sysctl(
            mib.as_mut_ptr(),
            mib.len() as _,
            std::ptr::null_mut(),
            &mut size,
            std::ptr::null_mut(),
            0,
        ) != 0
        {
            return None;
        }
        let mut bytes = vec![0u8; size];
        if libc::sysctl(
            mib.as_mut_ptr(),
            mib.len() as _,
            bytes.as_mut_ptr().cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        ) != 0
        {
            return None;
        }
        decode_process_args(&bytes[..size])
    }
}

#[cfg(not(target_os = "macos"))]
fn process_args(pid: i32) -> Option<Vec<String>> {
    let bytes = fs::read(format!("/proc/{pid}/cmdline")).ok()?;
    Some(
        bytes
            .split(|byte| *byte == 0)
            .filter(|arg| !arg.is_empty())
            .map(|arg| String::from_utf8_lossy(arg).into_owned())
            .collect(),
    )
}

fn pi_args(args: &[String]) -> Option<&[String]> {
    match Path::new(args.first()?).file_name()?.to_str()? {
        "pi" => Some(&args[1..]),
        "node" | "bun" => {
            let script = PathBuf::from(args.get(1)?);
            let script = fs::canonicalize(&script).unwrap_or(script);
            let is_pi = script.file_name().is_some_and(|name| name == "pi")
                || script.ends_with("pi-coding-agent/dist/cli.js")
                || script.ends_with("pi-coding-agent/dist/bundle/cli.js");
            is_pi.then_some(&args[2..])
        }
        _ => None,
    }
}

fn writer_for_args(pid: i32, args: &[String], sessions: &Path) -> Option<ExternalWriter> {
    if !is_alive(pid) {
        return None;
    }
    let args = pi_args(args)?;
    let mut target = None;
    let mut from_terminal = true;
    for (index, arg) in args.iter().enumerate() {
        match arg.as_str() {
            "--" => break,
            "--session" | "--session-id" => target = args.get(index + 1).map(String::as_str),
            "--mode" => {
                from_terminal = args
                    .get(index + 1)
                    .is_some_and(|mode| mode == "interactive")
            }
            "--print" | "-p" => from_terminal = false,
            _ => {}
        }
    }
    let target = Path::new(target?);
    let id = target.file_stem()?.to_str()?.rsplit('_').next()?;
    uuid::Uuid::parse_str(id).ok()?;
    // Resolve through native discovery, including symlinks to managed sessions.
    let path = crate::pi::find_task_file(sessions, id).ok()?;
    if target.is_absolute() && fs::canonicalize(target).ok()? != fs::canonicalize(&path).ok()? {
        return None;
    }
    Some(ExternalWriter {
        task_id: id.to_owned(),
        pid,
        is_busy: turn_running(&path),
        from_terminal,
        can_override: true,
    })
}

fn turn_running(path: &Path) -> bool {
    let tail = (|| {
        let mut file = fs::File::open(path).ok()?;
        file.seek(SeekFrom::Start(
            file.metadata()
                .ok()?
                .len()
                .saturating_sub(ROLLOUT_TAIL_BYTES),
        ))
        .ok()?;
        let mut tail = Vec::new();
        file.read_to_end(&mut tail).ok()?;
        Some(String::from_utf8_lossy(&tail).into_owned())
    })();
    tail.and_then(|tail| {
        tail.lines()
            .rev()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .find_map(|entry| {
                let message = entry.get("message")?;
                match message.get("role")?.as_str()? {
                    "user" | "toolResult" => Some(true),
                    "assistant" => Some(!matches!(
                        message.get("stopReason").and_then(Value::as_str),
                        Some("stop" | "length" | "error" | "aborted")
                    )),
                    _ => None,
                }
            })
    })
    .unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    const ID: &str = "81d48872-3b07-418f-956c-34561171e65e";
    const NATIVE_ID: &str = "01a1c871-510f-7598-b688-fddeab659a63";
    const SCRIPT: &str = "/opt/node_modules/@earendil-works/pi-coding-agent/dist/cli.js";

    fn fixture() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("project");
        fs::create_dir(&project).unwrap();
        let path = project.join(format!("{ID}.jsonl"));
        fs::write(&path, [
            json!({"type":"session","id":NATIVE_ID,"cwd":"/project"}).to_string(),
            json!({"type":"message","id":"user","message":{"role":"user","content":[]}}).to_string(),
            json!({"type":"message","id":"assistant","message":{"role":"assistant","stopReason":"toolUse","content":[]}}).to_string(),
            json!({"type":"message","id":"tool","message":{"role":"toolResult","content":[]}}).to_string(),
        ].join("\n")).unwrap();
        (dir, path)
    }

    fn args(path: &Path) -> Vec<String> {
        [
            "/usr/bin/node",
            SCRIPT,
            "--mode",
            "rpc",
            "--session",
            path.to_str().unwrap(),
        ]
        .map(str::to_owned)
        .to_vec()
    }

    #[test]
    fn a_managed_session_symlink_maps_to_the_discovery_task_id_and_preserves_spaces() {
        let (dir, path) = fixture();
        let managed = dir.path().join("managed sessions");
        fs::create_dir(&managed).unwrap();
        let actual = managed.join(format!("{ID}.jsonl"));
        fs::rename(&path, &actual).unwrap();
        std::os::unix::fs::symlink(&actual, &path).unwrap();
        let writer =
            writer_for_args(std::process::id() as i32, &args(&actual), dir.path()).unwrap();
        assert_eq!(writer.task_id, ID);
        assert_ne!(writer.task_id, NATIVE_ID);
        assert!(writer.is_busy);
    }

    #[test]
    fn completion_and_failure_remain_open_but_idle_until_the_process_exits() {
        let (dir, path) = fixture();
        for reason in ["stop", "length", "error", "aborted"] {
            let line = json!({"type":"message","message":{"role":"assistant","stopReason":reason,"content":[]}});
            fs::write(
                &path,
                format!("{line}\n{}", json!({"type":"session_info","name":"Title"})),
            )
            .unwrap();
            let writer =
                writer_for_args(std::process::id() as i32, &args(&path), dir.path()).unwrap();
            assert!(!writer.is_busy, "{reason}");
        }
    }

    #[test]
    fn an_explicit_session_id_and_an_interactive_process_keep_the_native_identity() {
        let (dir, _) = fixture();
        let args = ["pi", "--session-id", ID].map(str::to_owned);
        let writer = writer_for_args(std::process::id() as i32, &args, dir.path()).unwrap();
        assert!(writer.is_busy && writer.from_terminal);
    }

    #[test]
    fn unrelated_commands_dead_processes_and_sessions_outside_discovery_are_skipped() {
        let (dir, path) = fixture();
        let pid = std::process::id() as i32;
        assert!(writer_for_args(0, &args(&path), dir.path()).is_none());
        let mut unrelated = args(&path);
        unrelated[1] = "/project/server.js".into();
        assert!(writer_for_args(pid, &unrelated, dir.path()).is_none());
        let other = dir.path().join(format!("outside_{ID}.jsonl"));
        fs::write(&other, "{}").unwrap();
        assert!(writer_for_args(pid, &args(&other), dir.path()).is_none());
    }

    #[test]
    fn macos_arguments_preserve_empty_and_spaced_values_and_skip_environment() {
        let expected = [
            "node",
            SCRIPT,
            "--session",
            "/project with spaces/session.jsonl",
            "",
        ];
        let mut bytes = (expected.len() as i32).to_ne_bytes().to_vec();
        bytes.extend_from_slice(b"/usr/bin/node\0\0\0");
        for arg in expected {
            bytes.extend_from_slice(arg.as_bytes());
            bytes.push(0);
        }
        bytes.extend_from_slice(b"SECRET=not-an-argument\0");
        assert_eq!(decode_process_args(&bytes).unwrap(), expected);
        assert!(decode_process_args(&bytes[..4]).is_none());
    }

    #[test]
    fn reads_this_process_arguments_from_the_operating_system() {
        let args = process_args(std::process::id() as i32).unwrap();
        assert_eq!(args, std::env::args().collect::<Vec<_>>());
    }

    #[test]
    fn discovers_a_live_pi_process_and_releases_it_after_exit() {
        use std::io::{BufRead, BufReader};
        use std::process::Stdio;
        let (dir, path) = fixture();
        let script = dir.path().join("pi");
        fs::write(
            &script,
            "process.stdout.write('ready\\n'); process.stdin.resume();",
        )
        .unwrap();
        let mut child = Command::new("node")
            .arg(&script)
            .args(["--mode", "rpc", "--session"])
            .arg(&path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut ready = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut ready)
            .unwrap();
        assert_eq!(ready, "ready\n");
        let pid = child.id() as i32;
        let detected = read_pi_writers(dir.path());
        child.kill().unwrap();
        child.wait().unwrap();
        assert!(detected.iter().any(|writer| writer.pid == pid
            && writer.task_id == ID
            && writer.is_busy
            && !writer.from_terminal));
        assert!(read_pi_writers(dir.path())
            .iter()
            .all(|writer| writer.pid != pid));
    }

    #[test]
    fn externally_running_pi_is_visible_while_a_tool_result_waits_for_the_next_reply() {
        let (dir, path) = fixture();
        let pid = std::process::id() as i32;
        assert_eq!(
            writer_for_args(pid, &args(&path), dir.path()),
            Some(ExternalWriter {
                task_id: ID.into(),
                pid,
                is_busy: true,
                from_terminal: false,
                can_override: true,
            })
        );
    }
}

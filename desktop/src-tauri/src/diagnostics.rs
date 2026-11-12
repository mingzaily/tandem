//! Tandem's own diagnostic log in `~/.tandem/logs/`. Nothing here leaves the machine: users
//! attach a file to a report themselves. Errors and lifecycle lines are always kept; details
//! only while the user has debug logging on. Callers pass identifiers, flag names, exit codes and
//! error text, never prompts, replies or attachment contents.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Files untouched for this long are removed when a new day's file opens.
const KEEP: Duration = Duration::from_secs(7 * 24 * 60 * 60);
/// A runaway loop or a hostile page cannot fill the disk: later lines that day are dropped.
const DAY_LIMIT: u64 = 10 * 1024 * 1024;
const MESSAGE_LIMIT: usize = 4000;
const PREFIX: &str = "tandem-";
const SUFFIX: &str = ".log";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Error,
    Info,
    Debug,
}

impl Level {
    fn name(self) -> &'static str {
        match self {
            Level::Error => "ERROR",
            Level::Info => "INFO ",
            Level::Debug => "DEBUG",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Stamp {
    date: String,
    time: String,
}

impl Stamp {
    pub fn now() -> Self {
        let elapsed = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        let seconds = elapsed.as_secs() as libc::time_t;
        // SAFETY: an all-zero `tm` is a valid value, and `localtime_r` only writes into it.
        let mut tm: libc::tm = unsafe { std::mem::zeroed() };
        unsafe { libc::localtime_r(&seconds, &mut tm) };
        let offset = tm.tm_gmtoff / 60;
        let date = format!("{:04}-{:02}-{:02}", tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday);
        let time = format!(
            "{:02}:{:02}:{:02}.{:03}{}{:02}{:02}",
            tm.tm_hour,
            tm.tm_min,
            tm.tm_sec,
            elapsed.subsec_millis(),
            if offset < 0 { '-' } else { '+' },
            offset.abs() / 60,
            offset.abs() % 60
        );
        Self { date, time }
    }
}

struct Day {
    date: String,
    file: File,
    size: u64,
    full: bool,
}

/// Owns the files. Only the writer thread uses it, so writes stay off async and UI threads.
pub struct Writer {
    dir: PathBuf,
    header: String,
    home: Option<String>,
    day: Option<Day>,
}

impl Writer {
    pub fn new(dir: PathBuf, header: String, home: Option<String>) -> Self {
        Self { dir, header, home, day: None }
    }

    pub fn write(&mut self, level: Level, scope: &str, message: &str, stamp: &Stamp) {
        let line = format!("{} {} {} {scope}: {}\n", stamp.date, stamp.time, level.name(), clean(message, self.home.as_deref()));
        if self.day.as_ref().is_none_or(|day| day.date != stamp.date) {
            self.day = self.open(&stamp.date).ok();
            self.prune(SystemTime::now());
        }
        let Some(day) = self.day.as_mut() else { return };
        if day.full {
            return;
        }
        if day.size + line.len() as u64 > DAY_LIMIT {
            day.full = true;
            let _ = day.file.write_all(b"... daily log limit reached, later lines are dropped\n");
            return;
        }
        if day.file.write_all(line.as_bytes()).is_ok() {
            day.size += line.len() as u64;
        }
    }

    fn open(&self, date: &str) -> Result<Day, String> {
        crate::storage::io::private_dir(&self.dir)?;
        let path = self.dir.join(format!("{PREFIX}{date}{SUFFIX}"));
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .mode(0o600)
            .open(&path)
            .map_err(|error| error.to_string())?;
        let mut size = file.metadata().map_err(|error| error.to_string())?.len();
        if size == 0 {
            let header = format!("# {}\n", self.header);
            file.write_all(header.as_bytes()).map_err(|error| error.to_string())?;
            size = header.len() as u64;
        }
        Ok(Day { date: date.to_owned(), file, size, full: size >= DAY_LIMIT })
    }

    fn prune(&self, now: SystemTime) {
        for path in log_files(&self.dir) {
            let old = fs::metadata(&path)
                .and_then(|metadata| metadata.modified())
                .is_ok_and(|modified| now.duration_since(modified).is_ok_and(|age| age > KEEP));
            if old {
                let _ = fs::remove_file(path);
            }
        }
    }

    /// Removes every log file. The next line starts a fresh file with its header.
    pub fn clear(&mut self) -> Result<(), String> {
        self.day = None;
        for path in log_files(&self.dir) {
            fs::remove_file(&path).map_err(|error| format!("删除 {} 失败：{error}", path.display()))?;
        }
        Ok(())
    }
}

fn log_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(PREFIX) && name.ends_with(SUFFIX))
        })
        .collect()
}

/// One line per entry: continuation lines are indented so a reader can tell entries apart, and
/// the home folder becomes `~` so a shared file does not carry the account name.
fn clean(message: &str, home: Option<&str>) -> String {
    let mut text = message.trim_end().replace('\r', "");
    if let Some(home) = home.filter(|home| home.len() > 1) {
        text = text.replace(home, "~");
    }
    if text.len() > MESSAGE_LIMIT {
        let mut end = MESSAGE_LIMIT;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
        text.push_str(" …");
    }
    text.replace('\n', "\n    ")
}

/// Keeps option names and drops their values: values can carry prompts, paths and rules.
pub fn flag_names(args: &[String]) -> String {
    args.iter()
        .filter(|arg| arg.starts_with('-'))
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join(" ")
}

enum Command {
    Line(Level, String, String, Stamp),
    Clear(Sender<Result<(), String>>),
}

struct Global {
    dir: PathBuf,
    sender: Mutex<Sender<Command>>,
}

static GLOBAL: OnceLock<Global> = OnceLock::new();
static VERBOSE: AtomicBool = AtomicBool::new(false);

/// Starts the writer. Only the instance that owns `~/.tandem` calls this; a second, read-only
/// instance leaves the files alone and logs nothing.
pub fn start(dir: PathBuf, version: &str, verbose: bool) {
    let header = format!("Tandem {version} · macOS {} · {}", macos_version(), std::env::consts::ARCH);
    let home = std::env::var("HOME").ok();
    let (sender, receiver) = mpsc::channel::<Command>();
    let mut writer = Writer::new(dir.clone(), header, home);
    let spawned = std::thread::Builder::new().name("tandem-log".into()).spawn(move || {
        for command in receiver {
            match command {
                Command::Line(level, scope, message, stamp) => writer.write(level, &scope, &message, &stamp),
                Command::Clear(reply) => {
                    let _ = reply.send(writer.clear());
                }
            }
        }
    });
    if spawned.is_ok() && GLOBAL.set(Global { dir, sender: Mutex::new(sender) }).is_ok() {
        VERBOSE.store(verbose, Ordering::Relaxed);
        info("app", format!("started, pid {}, debug logging {}", std::process::id(), if verbose { "on" } else { "off" }));
    }
}

pub fn set_verbose(on: bool) {
    if VERBOSE.swap(on, Ordering::Relaxed) != on {
        info("app", format!("debug logging {}", if on { "on" } else { "off" }));
    }
}

pub fn verbose() -> bool {
    VERBOSE.load(Ordering::Relaxed)
}

pub fn dir() -> Option<PathBuf> {
    GLOBAL.get().map(|global| global.dir.clone())
}

fn send(level: Level, scope: &str, message: String) {
    #[cfg(debug_assertions)]
    eprintln!("{} {scope}: {message}", level.name());
    if let Some(global) = GLOBAL.get() {
        if let Ok(sender) = global.sender.lock() {
            let _ = sender.send(Command::Line(level, scope.to_owned(), message, Stamp::now()));
        }
    }
}

pub fn error(scope: &str, message: impl Into<String>) {
    send(Level::Error, scope, message.into());
}

pub fn info(scope: &str, message: impl Into<String>) {
    send(Level::Info, scope, message.into());
}

/// The message is only built while debug logging is on.
pub fn debug(scope: &str, message: impl FnOnce() -> String) {
    if verbose() {
        send(Level::Debug, scope, message());
    }
}

pub fn clear() -> Result<(), String> {
    let global = GLOBAL.get().ok_or("日志不可用：另一个 Tandem 正在使用本地数据")?;
    let (reply, result) = mpsc::channel();
    global
        .sender
        .lock()
        .map_err(|error| error.to_string())?
        .send(Command::Clear(reply))
        .map_err(|error| error.to_string())?;
    result.recv().map_err(|error| error.to_string())?
}

fn macos_version() -> String {
    let mut buffer = [0u8; 32];
    let mut length = buffer.len();
    // SAFETY: the pointer and length describe the same writable buffer.
    let status = unsafe {
        libc::sysctlbyname(c"kern.osproductversion".as_ptr(), buffer.as_mut_ptr().cast(), &mut length, std::ptr::null_mut(), 0)
    };
    if status != 0 {
        return "unknown".into();
    }
    String::from_utf8_lossy(&buffer[..length]).trim_end_matches('\0').to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stamp(date: &str) -> Stamp {
        Stamp { date: date.into(), time: "10:00:00.000+0800".into() }
    }

    fn read(dir: &Path, date: &str) -> String {
        fs::read_to_string(dir.join(format!("tandem-{date}.log"))).unwrap_or_default()
    }

    #[test]
    fn each_day_gets_a_private_file_with_a_header_and_one_entry_per_line() {
        let dir = tempfile::tempdir().unwrap();
        let logs = dir.path().join("logs");
        let mut writer = Writer::new(logs.clone(), "Tandem 1.0".into(), Some("/Users/someone".into()));
        writer.write(Level::Error, "runner", "claude exited\nat /Users/someone/project", &stamp("2026-11-12"));
        writer.write(Level::Debug, "queue", "dispatch", &stamp("2026-11-13"));
        let first = read(&logs, "2026-11-12");
        assert_eq!(first, "# Tandem 1.0\n2026-11-12 10:00:00.000+0800 ERROR runner: claude exited\n    at ~/project\n");
        assert!(read(&logs, "2026-11-13").ends_with("DEBUG queue: dispatch\n"));
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(logs.join("tandem-2026-11-12.log")).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        assert_eq!(fs::metadata(&logs).unwrap().permissions().mode() & 0o777, 0o700);
    }

    #[test]
    fn a_full_day_stops_growing_and_long_messages_are_cut() {
        let dir = tempfile::tempdir().unwrap();
        let mut writer = Writer::new(dir.path().to_owned(), "Tandem".into(), None);
        let long = "错".repeat(MESSAGE_LIMIT);
        writer.write(Level::Error, "page", &long, &stamp("2026-11-12"));
        let text = read(dir.path(), "2026-11-12");
        assert!(text.len() < MESSAGE_LIMIT + 100, "{}", text.len());
        assert!(text.trim_end().ends_with('…'));
        for _ in 0..(DAY_LIMIT as usize / MESSAGE_LIMIT + 10) {
            writer.write(Level::Error, "page", &"x".repeat(MESSAGE_LIMIT), &stamp("2026-11-12"));
        }
        let size = fs::metadata(dir.path().join("tandem-2026-11-12.log")).unwrap().len();
        assert!(size <= DAY_LIMIT + 100, "{size}");
        assert!(read(dir.path(), "2026-11-12").ends_with("later lines are dropped\n"));
    }

    #[test]
    fn old_files_are_pruned_and_clear_removes_only_logs() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("tandem-2026-10-01.log");
        fs::write(&old, "old").unwrap();
        File::options().write(true).open(&old).unwrap()
            .set_modified(SystemTime::now() - KEEP - Duration::from_secs(60)).unwrap();
        fs::write(dir.path().join("notes.txt"), "keep").unwrap();
        let mut writer = Writer::new(dir.path().to_owned(), "Tandem".into(), None);
        writer.write(Level::Info, "app", "started", &stamp("2026-11-12"));
        assert!(!old.exists());
        assert!(dir.path().join("tandem-2026-11-12.log").exists());
        writer.clear().unwrap();
        assert!(!dir.path().join("tandem-2026-11-12.log").exists());
        assert!(dir.path().join("notes.txt").exists());
        writer.write(Level::Info, "app", "again", &stamp("2026-11-12"));
        assert!(read(dir.path(), "2026-11-12").starts_with("# Tandem\n"));
    }

    #[test]
    fn flag_names_drop_values_that_can_hold_prompts_or_paths() {
        let args: Vec<String> = ["-p", "--model", "opus", "--allowedTools", "Read(//Users/a/secret.txt)", "--resume-drops-turn", "my prompt"]
            .map(str::to_owned)
            .to_vec();
        assert_eq!(flag_names(&args), "-p --model --allowedTools --resume-drops-turn");
    }
}

use crate::protocol::{Grant, decode, valid_hash};
use std::{
    collections::HashMap,
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};
use tokio::sync::{mpsc, oneshot};

type Snapshot = Vec<(String, Grant)>;
pub type Receipt = oneshot::Receiver<io::Result<()>>;
struct WriteRequest {
    snapshot: Snapshot,
    done: oneshot::Sender<io::Result<()>>,
}

#[derive(Clone)]
pub struct Store {
    writes: mpsc::UnboundedSender<WriteRequest>,
}

impl Store {
    pub async fn open(
        path: PathBuf,
    ) -> io::Result<(Self, HashMap<String, Grant>, tokio::task::JoinHandle<()>)> {
        if path.file_name().is_none() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "TANDEM_RELAY_DATA_FILE 必须包含文件名",
            ));
        }
        let source = path.clone();
        let grants = tokio::task::spawn_blocking(move || load(&source))
            .await
            .map_err(io::Error::other)??;
        ensure_writable(&path)?;
        let (writes, mut receiver) = mpsc::unbounded_channel::<WriteRequest>();
        let task = tokio::spawn(async move {
            while let Some(request) = receiver.recv().await {
                let file = path.clone();
                let logged = file.display().to_string();
                let result =
                    tokio::task::spawn_blocking(move || atomic_write(&file, &request.snapshot))
                        .await
                        .map_err(io::Error::other)
                        .and_then(|r| r);
                if let Err(error) = &result {
                    eprintln!("准入文件写入失败：{logged}：{error}");
                }
                let _ = request.done.send(result);
            }
        });
        Ok((Self { writes }, grants, task))
    }

    // Enqueue under the hub lock, preserving the order of mutations across hosts.
    pub fn persist(&self, grants: &HashMap<String, Grant>) -> Receipt {
        let snapshot = grants
            .iter()
            .filter(|(_, g)| !g.one_time)
            .map(|(h, g)| (h.clone(), g.clone()))
            .collect();
        let (done, receipt) = oneshot::channel();
        self.writes
            .send(WriteRequest { snapshot, done })
            .expect("persistence worker lives until shutdown");
        receipt
    }
}

fn load(path: &Path) -> io::Result<HashMap<String, Grant>> {
    let data = match fs::read(path) {
        Ok(data) => data,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(HashMap::new()),
        Err(e) => {
            return Err(io::Error::new(
                e.kind(),
                format!(
                    "读取准入文件 {} 失败：{e}；请检查文件权限，或将该路径改名保留后重启中转；桌面端重连会重新登记已配对设备的令牌，请保留电脑上的配对配置",
                    path.display()
                ),
            ));
        }
    };
    let entries: Snapshot = serde_json::from_slice(&data).map_err(|_| invalid_data(path))?;
    if entries.iter().any(|(h, g)| {
        !valid_hash(h) || decode(&g.room, 16).is_none() || g.one_time || g.expires_at.is_some()
    }) {
        return Err(invalid_data(path));
    }
    Ok(entries.into_iter().collect())
}

fn ensure_writable(path: &Path) -> io::Result<()> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(parent)
        .map_err(|error| write_access_error(parent, error))?;
    let probe = parent.join(".tandem-write-probe");
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(&probe)
        .and_then(|mut file| file.write_all(b"ok"))
        .and_then(|_| fs::remove_file(&probe))
        .map_err(|error| write_access_error(parent, error))
}

fn write_access_error(directory: &Path, error: io::Error) -> io::Error {
    io::Error::new(
        error.kind(),
        format!(
            "数据目录不可写：{}。请确认这个目录存在，并且容器可以写入。{error}",
            directory.display()
        ),
    )
}

fn invalid_data(path: &Path) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        format!(
            "准入文件 {} 已损坏；请从备份恢复该文件，或先将该文件移到备份位置再启动中转；桌面端连接后会重新登记设备准入",
            path.display()
        ),
    )
}

fn atomic_write(path: &Path, snapshot: &[(String, Grant)]) -> io::Result<()> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(parent)?;
    let temporary = path.with_file_name(format!(
        "{}.tmp",
        path.file_name()
            .expect("data file has a filename")
            .to_string_lossy()
    ));
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    serde_json::to_writer(&mut file, snapshot)?;
    file.flush()?;
    file.sync_all()?;
    fs::rename(&temporary, path)?;
    fs::File::open(parent)?.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn unreadable_grants_report_path_and_recovery_without_exposing_contents() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tokens.json");
        fs::create_dir(&path).unwrap();
        let error = match Store::open(path.clone()).await {
            Ok(_) => panic!("a directory cannot be read as grants"),
            Err(error) => error.to_string(),
        };
        assert!(error.contains(&path.display().to_string()), "{error}");
        assert!(
            error.contains("改名") && error.contains("重启") && error.contains("重新登记"),
            "{error}"
        );
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn startup_requires_a_writable_data_directory() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let restore = dir.path().to_path_buf();
        struct Restore(std::path::PathBuf);
        impl Drop for Restore {
            fn drop(&mut self) {
                let _ = fs::set_permissions(&self.0, fs::Permissions::from_mode(0o755));
            }
        }
        let _restore = Restore(restore.clone());
        fs::set_permissions(&restore, fs::Permissions::from_mode(0o555)).unwrap();
        let error = match Store::open(restore.join("tokens.json")).await {
            Ok(_) => panic!("a read-only data directory must not start"),
            Err(error) => error.to_string(),
        };
        assert!(error.contains("不可写"), "{error}");
    }
    #[tokio::test]
    async fn failed_write_does_not_poison_the_next_write() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tokens.json");
        let (store, _, task) = Store::open(path.clone()).await.unwrap();
        fs::create_dir(&path).unwrap();
        assert!(store.persist(&HashMap::new()).await.unwrap().is_err());
        fs::remove_dir(&path).unwrap();
        assert!(store.persist(&HashMap::new()).await.unwrap().is_ok());
        assert_eq!(fs::read_to_string(&path).unwrap(), "[]");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        drop(store);
        task.await.unwrap();
    }
    #[test]
    fn loads_node_file_format_and_rejects_pairing_grants() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tokens.json");
        let entry = (
            "a".repeat(64),
            Grant {
                room: "AQEBAQEBAQEBAQEBAQEBAQ".into(),
                one_time: false,
                expires_at: None,
            },
        );
        atomic_write(&path, std::slice::from_ref(&entry)).unwrap();
        assert_eq!(load(&path).unwrap().len(), 1);
        let mut pairing = entry;
        pairing.1.one_time = true;
        atomic_write(&path, &[pairing]).unwrap();
        assert!(load(&path).is_err());
    }
}

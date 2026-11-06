//! Tandem owns unsent messages. Only a claimed turn crosses the native CLI boundary.

use crate::attachments::{Attachment, Prepared, SavedAttachment};
use crate::remote::Remote;
use crate::runner::{Runs, TurnEvent, TurnOptions, TurnSink};
use crate::sessions::Agent;
use crate::{codex, pi, runner};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

pub const CHANGED_EVENT: &str = "queue-changed";
pub const TURN_EVENT: &str = "queued-turn";
const UNCERTAIN_DELIVERY: &str =
    "上次发送中断，无法确定 CLI 是否已接收。消息已回到队首，队列暂停，请确认后继续发送。";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueError {
    task_id: Option<String>,
    error: String,
}

// A writer override authorizes the immediate attempt and is never restored from disk.
fn queued_options<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<TurnOptions, D::Error> {
    let mut options = TurnOptions::deserialize(deserializer)?;
    options.ignore_external_writer = false;
    Ok(options)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    id: String,
    prompt: String,
    attachments: Vec<SavedAttachment>,
    #[serde(deserialize_with = "queued_options")]
    options: TurnOptions,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryView {
    id: String,
    prompt: String,
    attachments: Vec<Attachment>,
    options: TurnOptions,
}

impl Entry {
    pub fn new(
        prompt: String,
        attachments: Vec<SavedAttachment>,
        options: TurnOptions,
    ) -> Result<Self, String> {
        validate_content(&prompt, attachments.len())?;
        Ok(Self {
            id: Uuid::new_v4().to_string(),
            prompt,
            attachments,
            options,
        })
    }

    fn view(&self, task_id: &str) -> EntryView {
        EntryView {
            id: self.id.clone(),
            prompt: self.prompt.clone(),
            options: self.options.clone(),
            attachments: self
                .attachments
                .iter()
                .map(|attachment| attachment.presentation(task_id))
                .collect(),
        }
    }

    fn prepare(&self, image_dir: &Path) -> Result<(Prepared, EntryView), String> {
        let prepared = Prepared::from_saved(&self.attachments, image_dir)?;
        let view = EntryView {
            id: self.id.clone(),
            prompt: self.prompt.clone(),
            options: self.options.clone(),
            attachments: prepared.live_attachments(&self.attachments),
        };
        Ok((prepared, view))
    }
}

fn validate_content(prompt: &str, attachment_count: usize) -> Result<(), String> {
    if prompt.trim().is_empty() && attachment_count == 0 {
        return Err("请输入消息或添加附件".into());
    }
    Ok(())
}

pub fn validate_task_id(id: &str) -> Result<(), String> {
    Uuid::parse_str(id).map_err(|_| "任务 ID 必须是 UUID".to_owned())?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskQueue {
    task_id: String,
    agent: Agent,
    entries: Vec<Entry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    in_flight: Option<Entry>,
    paused: bool,
    error: Option<String>,
    revision: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    task_id: String,
    agent: Agent,
    entries: Vec<EntryView>,
    paused: bool,
    error: Option<String>,
    revision: u64,
}

impl TaskQueue {
    fn all_entries(&self) -> impl Iterator<Item = &Entry> {
        self.entries.iter().chain(self.in_flight.iter())
    }
    fn all_entries_mut(&mut self) -> impl Iterator<Item = &mut Entry> {
        self.entries.iter_mut().chain(self.in_flight.iter_mut())
    }

    fn snapshot(&self) -> Snapshot {
        Snapshot {
            task_id: self.task_id.clone(),
            agent: self.agent,
            entries: self
                .entries
                .iter()
                .map(|entry| entry.view(&self.task_id))
                .collect(),
            paused: self.paused,
            error: self.error.clone(),
            revision: self.revision,
        }
    }
}

struct Active {
    agent: Agent,
    stopped: bool,
    resume_requested: bool,
}

#[derive(Default)]
struct State {
    loaded: bool,
    queues: HashMap<String, TaskQueue>,
    active: HashMap<String, Active>,
    /// A drag holds the whole queue; an editor holds only its own entry.
    locks: HashMap<String, HashMap<String, Option<String>>>,
    errors: Vec<QueueError>,
    preserved_images: HashSet<String>,
}

pub struct Store {
    root: PathBuf,
    state: Mutex<State>,
}

impl Store {
    pub fn ensure_idle(&self) -> Result<(), String> {
        let state = self.state.lock().map_err(|error| error.to_string())?;
        if state.active.is_empty() && state.locks.is_empty() && state.queues.values().all(|queue| queue.in_flight.is_none()) { Ok(()) }
        else { Err("队列仍在发送或编辑，结束后再迁移本地数据".into()) }
    }

    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            state: Mutex::default(),
        }
    }

    fn state(&self) -> Result<std::sync::MutexGuard<'_, State>, String> {
        let mut state = self.state.lock().map_err(|error| error.to_string())?;
        if !state.loaded {
            let paths = match fs::read_dir(&self.root) {
                Ok(paths) => Some(paths),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => return Err(format!("读取待发送队列失败：{error}")),
            };
            let mut queues = HashMap::new();
            for path in paths.into_iter().flatten() {
                let path = match path {
                    Ok(path) => path.path(),
                    Err(error) => {
                        state.errors.push(QueueError {
                            task_id: None,
                            error: format!("读取队列目录项失败：{error}"),
                        });
                        continue;
                    }
                };
                if path.extension().and_then(|ext| ext.to_str()) == Some("corrupt") {
                    if let Some(id) = path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .and_then(|name| name.split('.').next())
                        .filter(|id| Uuid::parse_str(id).is_ok())
                    {
                        state.preserved_images.insert(id.to_owned());
                    }
                }
                if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                    continue;
                }
                let mut queue = match Self::read_queue(&path) {
                    Ok(queue) => queue,
                    Err(error) => {
                        let corrupt =
                            path.with_extension(format!("json.{}.corrupt", Uuid::new_v4()));
                        let preservation = match fs::rename(&path, &corrupt) {
                            Ok(()) => format!("已保留到 {}", corrupt.display()),
                            Err(error) => {
                                format!("原文件保留在 {}，隔离失败：{error}", path.display())
                            }
                        };
                        if let Some(id) = path
                            .file_stem()
                            .and_then(|name| name.to_str())
                            .filter(|id| Uuid::parse_str(id).is_ok())
                        {
                            state.preserved_images.insert(id.to_owned());
                        }
                        state.errors.push(QueueError {
                            task_id: path
                                .file_stem()
                                .and_then(|name| name.to_str())
                                .filter(|id| Uuid::parse_str(id).is_ok())
                                .map(str::to_owned),
                            error: format!(
                                "读取待发送队列 {} 失败：{error}。{preservation}",
                                path.display()
                            ),
                        });
                        continue;
                    }
                };
                let recovering = queue.in_flight.is_some();
                if let Some(entry) = queue.in_flight.take() {
                    queue.entries.insert(0, entry);
                    queue.error = Some(UNCERTAIN_DELIVERY.into());
                }
                // Pending messages need an explicit resume after restart. Empty queues stay ready.
                queue.paused |= !queue.entries.is_empty();
                queue.revision += 1;
                let empty = queue.entries.is_empty() && queue.in_flight.is_none();
                if empty {
                    queue.paused = false;
                    queue.error = None;
                }
                let migrating = queue
                    .all_entries()
                    .flat_map(|entry| &entry.attachments)
                    .any(SavedAttachment::has_inline_image);
                if recovering || migrating || empty {
                    let save_error = self.save(&mut queue).err();
                    if let Some(error) = &save_error {
                        queue.paused = true;
                        queue.error = Some(error.clone());
                    }
                    let warning = match save_error {
                        Some(error) => Some(if recovering {
                            format!("{UNCERTAIN_DELIVERY} {error}")
                        } else {
                            error
                        }),
                        None => recovering.then(|| UNCERTAIN_DELIVERY.to_owned()),
                    };
                    if let Some(error) = warning {
                        state.errors.push(QueueError {
                            task_id: Some(queue.task_id.clone()),
                            error,
                        });
                    }
                }

                queues.insert(queue.task_id.clone(), queue);
            }
            state.queues = queues;
            self.clean_orphan_images(&mut state);
            state.loaded = true;
        }
        Ok(state)
    }

    fn read_queue(path: &Path) -> Result<TaskQueue, String> {
        let bytes = fs::read(path).map_err(|error| error.to_string())?;
        let queue: TaskQueue = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
        validate_task_id(&queue.task_id)?;
        if path.file_stem().and_then(|stem| stem.to_str()) != Some(queue.task_id.as_str()) {
            return Err("队列任务 ID 与文件名不一致".into());
        }
        let image_dir = path
            .parent()
            .expect("queue file has a parent")
            .join("images")
            .join(&queue.task_id);
        for attachment in queue.all_entries().flat_map(|entry| &entry.attachments) {
            attachment.validate_image_file(&image_dir)?;
        }
        Ok(queue)
    }

    fn take_errors(&self) -> Result<Vec<QueueError>, String> {
        Ok(std::mem::take(
            &mut self.state.lock().map_err(|error| error.to_string())?.errors,
        ))
    }

    fn image_dir(&self, task_id: &str) -> PathBuf {
        self.root.join("images").join(task_id)
    }

    fn clean_orphan_images(&self, state: &mut State) {
        let dirs = match fs::read_dir(self.root.join("images")) {
            Ok(dirs) => dirs,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
            Err(error) => {
                state.errors.push(QueueError {
                    task_id: None,
                    error: format!("读取队列图片目录失败：{error}"),
                });
                return;
            }
        };
        for dir in dirs {
            match dir {
                Ok(dir) => {
                    let id = dir.file_name().to_string_lossy().into_owned();
                    if Uuid::parse_str(&id).is_ok() {
                        self.clean_images(state, &id);
                    }
                }
                Err(error) => state.errors.push(QueueError {
                    task_id: None,
                    error: format!("读取队列图片目录项失败：{error}"),
                }),
            }
        }
    }

    fn clean_images(&self, state: &mut State, id: &str) {
        // Corrupt manifests retain their image files so the original draft can be recovered.
        if state.preserved_images.contains(id) {
            return;
        }
        if let Err(error) = self.remove_unused_images(state.queues.get(id), id) {
            state.errors.push(QueueError {
                task_id: Some(id.to_owned()),
                error,
            });
        }
    }

    fn remove_unused_images(&self, queue: Option<&TaskQueue>, id: &str) -> Result<(), String> {
        let dir = self.image_dir(id);
        let files = match fs::read_dir(&dir) {
            Ok(files) => files,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(format!("读取队列图片失败：{error}")),
        };
        let live: HashSet<&str> = queue
            .into_iter()
            .flat_map(TaskQueue::all_entries)
            .flat_map(|entry| &entry.attachments)
            .filter_map(SavedAttachment::image_id)
            .collect();
        for file in files {
            let file = file.map_err(|error| format!("读取队列图片失败：{error}"))?;
            if !live.contains(file.file_name().to_string_lossy().as_ref()) {
                fs::remove_file(file.path())
                    .map_err(|error| format!("清理队列图片失败：{error}"))?;
            }
        }
        if live.is_empty() {
            fs::remove_dir(&dir).map_err(|error| format!("清理队列图片目录失败：{error}"))?;
        }
        Ok(())
    }

    pub fn image(&self, path: &str) -> Result<(&'static str, Vec<u8>), String> {
        let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
        if parts.len() != 2 {
            return Err("队列图片路径需要任务 ID 和图片 ID".into());
        }
        validate_task_id(parts[0])?;
        Uuid::parse_str(parts[1]).map_err(|_| "队列图片 ID 必须是 UUID".to_owned())?;
        let bytes = fs::read(self.image_dir(parts[0]).join(parts[1]))
            .map_err(|error| format!("读取队列图片失败：{error}"))?;
        let media_type = crate::attachments::image_media_type(&bytes).ok_or("队列图片格式无效")?;
        Ok((media_type, bytes))
    }

    fn save(&self, queue: &mut TaskQueue) -> Result<(), String> {
        let path = self.root.join(format!("{}.json", queue.task_id));
        if queue.entries.is_empty() && queue.in_flight.is_none() {
            return match fs::remove_file(&path) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(format!("清理空队列文件失败：{error}")),
            };
        }
        let image_dir = self.image_dir(&queue.task_id);
        for attachment in queue
            .all_entries_mut()
            .flat_map(|entry| &mut entry.attachments)
        {
            attachment.persist_image(&image_dir)?;
        }
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&self.root)
            .map_err(|error| format!("创建队列目录失败：{error}"))?;
        let path = self.root.join(format!("{}.json", queue.task_id));
        let temp = path.with_extension("tmp");
        let bytes = serde_json::to_vec(queue).map_err(|error| error.to_string())?;
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&temp)
            .map_err(|error| format!("保存待发送队列失败：{error}"))?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("保存待发送队列失败：{error}"))?;
        fs::rename(&temp, &path).map_err(|error| format!("保存待发送队列失败：{error}"))
    }

    pub fn list(&self) -> Result<Vec<Snapshot>, String> {
        Ok(self
            .state()?
            .queues
            .values()
            .map(TaskQueue::snapshot)
            .collect())
    }

    pub fn active_agent(&self, id: &str) -> Result<Option<Agent>, String> {
        Ok(self
            .state
            .lock()
            .map_err(|error| error.to_string())?
            .active
            .get(id)
            .map(|active| active.agent))
    }

    pub fn enqueue(&self, id: &str, agent: Agent, mut entry: Entry) -> Result<Snapshot, String> {
        validate_task_id(id)?;
        entry.options.validate_for(agent)?;
        let mut state = self.state()?;
        let mut queue = state.queues.get(id).cloned().unwrap_or_else(|| TaskQueue {
            task_id: id.to_owned(),
            agent,
            entries: Vec::new(),
            in_flight: None,
            paused: state.active.get(id).is_some_and(|active| active.stopped),
            error: None,
            revision: 0,
        });
        if queue.agent != agent {
            return Err("排队消息的 Agent 必须与任务一致".into());
        }
        // With no pending messages or process left, Send starts a fresh conversation turn.
        if queue.entries.is_empty() && !state.active.contains_key(id) {
            queue.paused = false;
            queue.error = None;
        }
        if state.active.contains_key(id) || !queue.entries.is_empty() || queue.paused {
            entry.options.ignore_external_writer = false;
        }
        queue.entries.push(entry);
        self.commit(&mut state, queue)
    }

    fn commit(&self, state: &mut State, mut queue: TaskQueue) -> Result<Snapshot, String> {
        queue.revision += 1;
        self.save(&mut queue)?;
        let snapshot = queue.snapshot();
        let id = queue.task_id.clone();
        state.queues.insert(id.clone(), queue);
        self.clean_images(state, &id);
        Ok(snapshot)
    }

    fn change(
        &self,
        id: &str,
        work: impl FnOnce(&mut TaskQueue) -> Result<(), String>,
    ) -> Result<Snapshot, String> {
        validate_task_id(id)?;
        let mut state = self.state()?;
        let mut queue = state.queues.get(id).cloned().ok_or("任务没有待发送队列")?;
        work(&mut queue)?;
        self.commit(&mut state, queue)
    }

    pub fn edit(&self, id: &str, entry_id: &str, prompt: String) -> Result<Snapshot, String> {
        self.change(id, |queue| {
            let entry = queue
                .entries
                .iter_mut()
                .find(|entry| entry.id == entry_id)
                .ok_or("这条消息已发送或已删除")?;
            validate_content(&prompt, entry.attachments.len())?;
            entry.prompt = prompt;
            Ok(())
        })
    }

    pub fn remove(&self, id: &str, entry_id: &str) -> Result<Snapshot, String> {
        self.change(id, |queue| {
            let index = queue
                .entries
                .iter()
                .position(|entry| entry.id == entry_id)
                .ok_or("这条消息已发送或已删除")?;
            queue.entries.remove(index);
            Ok(())
        })
    }

    /// The target is the final zero-based index, after removing the moved entry.
    pub fn reorder(&self, id: &str, entry_id: &str, target: usize) -> Result<Snapshot, String> {
        self.change(id, |queue| {
            if target >= queue.entries.len() {
                return Err("排序位置超出队列范围".into());
            }
            let index = queue
                .entries
                .iter()
                .position(|entry| entry.id == entry_id)
                .ok_or("这条消息已发送或已删除")?;
            let entry = queue.entries.remove(index);
            queue.entries.insert(target, entry);
            Ok(())
        })
    }

    pub fn resume(&self, id: &str) -> Result<Snapshot, String> {
        validate_task_id(id)?;
        let mut state = self.state()?;
        let mut queue = state.queues.get(id).cloned().ok_or("任务没有待发送队列")?;
        queue.paused = false;
        queue.error = None;
        for entry in &mut queue.entries {
            entry.options.ignore_external_writer = false;
        }
        let snapshot = self.commit(&mut state, queue)?;
        if let Some(active) = state.active.get_mut(id) {
            active.resume_requested = true;
        }
        Ok(snapshot)
    }

    pub fn pause(&self, id: &str) -> Result<Option<Snapshot>, String> {
        validate_task_id(id)?;
        let mut state = self.state()?;
        if let Some(active) = state.active.get_mut(id) {
            active.stopped = true;
            active.resume_requested = false;
        }
        let Some(mut queue) = state.queues.get(id).cloned() else {
            return Ok(None);
        };
        queue.paused = true;
        self.commit(&mut state, queue).map(Some)
    }

    pub fn set_lock(
        &self,
        id: &str,
        owner: String,
        entry_id: Option<String>,
        locked: bool,
    ) -> Result<(), String> {
        validate_task_id(id)?;
        let mut state = self.state()?;
        if locked {
            if let Some(entry_id) = &entry_id {
                if !state
                    .queues
                    .get(id)
                    .is_some_and(|queue| queue.entries.iter().any(|entry| &entry.id == entry_id))
                {
                    return Err("这条消息已发送或已删除".into());
                }
            }
            state
                .locks
                .entry(id.to_owned())
                .or_default()
                .insert(owner, entry_id);
        } else if let Some(locks) = state.locks.get_mut(id) {
            locks.remove(&owner);
            if locks.is_empty() {
                state.locks.remove(id);
            }
        }
        Ok(())
    }

    fn reserve(&self, id: &str, agent: Agent) -> Result<Option<Snapshot>, String> {
        validate_task_id(id)?;
        let mut state = self.state()?;
        if state.active.contains_key(id) {
            return Err("任务正在运行".into());
        }
        if state
            .queues
            .get(id)
            .is_some_and(|queue| !queue.entries.is_empty() || queue.in_flight.is_some())
        {
            return Err("任务有待发送消息，请通过队列继续发送".into());
        }
        let snapshot = if let Some(mut queue) = state.queues.get(id).cloned() {
            queue.paused = false;
            queue.error = None;
            Some(self.commit(&mut state, queue)?)
        } else {
            None
        };
        state.active.insert(
            id.to_owned(),
            Active {
                agent,
                stopped: false,
                resume_requested: false,
            },
        );
        Ok(snapshot)
    }

    fn started(&self, id: &str, agent: Agent) -> Result<bool, String> {
        let mut state = self.state.lock().map_err(|error| error.to_string())?;
        let active = state.active.entry(id.to_owned()).or_insert(Active {
            agent,
            stopped: false,
            resume_requested: false,
        });
        Ok(active.stopped)
    }

    /// An idle CLI can save title metadata while the next conversation turn waits here.
    pub fn reserve_metadata(&self, id: &str, agent: Agent) -> Result<(), String> {
        validate_task_id(id)?;
        let mut state = self.state()?;
        if state.active.contains_key(id) {
            return Err("任务进程正在启动或结束，请稍后保存标题".into());
        }
        state.active.insert(
            id.to_owned(),
            Active {
                agent,
                stopped: false,
                resume_requested: false,
            },
        );
        Ok(())
    }

    pub fn release_metadata(&self, id: &str) -> Result<(), String> {
        self.state()?.active.remove(id);
        Ok(())
    }

    fn claim(&self, id: &str) -> Result<Option<(Agent, Entry, Snapshot)>, String> {
        let mut state = self.state()?;
        if state.active.contains_key(id) {
            return Ok(None);
        }
        let Some(mut queue) = state.queues.get(id).cloned() else {
            return Ok(None);
        };
        if queue.paused || queue.entries.is_empty() || queue.in_flight.is_some() {
            return Ok(None);
        }
        let head = &queue.entries[0].id;
        if state.locks.get(id).is_some_and(|locks| {
            locks
                .values()
                .any(|entry| entry.as_ref().is_none_or(|entry| entry == head))
        }) {
            return Ok(None);
        }
        let entry = queue.entries.remove(0);
        queue.in_flight = Some(entry.clone());
        let agent = queue.agent;
        let snapshot = self.commit(&mut state, queue)?;
        state.active.insert(
            id.to_owned(),
            Active {
                agent,
                stopped: false,
                resume_requested: false,
            },
        );
        Ok(Some((agent, entry, snapshot)))
    }

    fn accepted(&self, id: &str) -> Result<Option<Snapshot>, String> {
        let mut state = self.state()?;
        let Some(mut queue) = state.queues.get(id).cloned() else {
            return Ok(None);
        };
        if queue.in_flight.take().is_some() {
            return self.commit(&mut state, queue).map(Some);
        }
        Ok(None)
    }

    fn complete(
        &self,
        id: &str,
        success: bool,
        cancelled: bool,
        error: Option<String>,
        restore: Option<Entry>,
    ) -> Result<Option<Snapshot>, String> {
        let mut state = self.state()?;
        let active = state.active.remove(id);
        let stopped = active.as_ref().is_some_and(|active| active.stopped);
        let resumed = active
            .as_ref()
            .is_some_and(|active| active.resume_requested);
        let Some(mut queue) = state.queues.get(id).cloned() else {
            return Ok(None);
        };
        queue.in_flight = None;
        if let Some(mut entry) = restore {
            entry.options.ignore_external_writer = false;
            queue.entries.insert(0, entry);
        }
        let continue_sending = success || (cancelled && resumed);
        if !continue_sending || (stopped && !resumed) {
            queue.paused = true;
            queue.error = error;
        }
        match self.commit(&mut state, queue.clone()) {
            Ok(snapshot) => Ok(Some(snapshot)),
            Err(error) => {
                queue.paused = true;
                queue.error = Some(error.clone());
                state.queues.insert(id.to_owned(), queue);
                Err(error)
            }
        }
    }

    fn finish_claim(
        &self,
        id: &str,
        entry: Entry,
        result: Result<(), String>,
        observed: Observed,
    ) -> Result<Option<Snapshot>, String> {
        let success = observed.accepted && result.is_ok() && observed.success;
        let error = observed.error.or_else(|| result.err()).or_else(|| {
            (!observed.accepted).then(|| "CLI 未确认接收，消息已保留在队首".to_owned())
        });
        self.complete(
            id,
            success,
            observed.cancelled,
            error,
            (!observed.accepted).then_some(entry),
        )
    }
}

pub async fn access<T: Send + 'static>(
    app: &AppHandle,
    work: impl FnOnce(&Store) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let storage = app.state::<crate::storage::Store>();
        let _permit = storage.permit()?;
        let store = app.state::<Store>();
        let result = work(store.inner());
        for error in store.take_errors()? {
            let _ = app.emit_to("main", "queue-error", error);
        }
        result
    })
    .await
    .map_err(|error| error.to_string())?
}

pub fn announce(app: &AppHandle, snapshot: &Snapshot) {
    let _ = app.emit_to("main", CHANGED_EVENT, snapshot);
}

#[derive(Default)]
struct Observed {
    task_id: Option<String>,
    accepted: bool,
    success: bool,
    cancelled: bool,
    error: Option<String>,
}

impl Observed {
    fn record(&mut self, event: &TurnEvent) {
        match event {
            TurnEvent::Started { task_id } => self.task_id = Some(task_id.clone()),
            TurnEvent::Finished {
                is_error,
                cancelled,
                message,
            } => {
                self.success = !is_error && !cancelled;
                self.cancelled = *cancelled;
                self.error.clone_from(message);
            }
            _ => {}
        }
    }
}

/// Every sender uses this lifecycle, including the existing phone operations.
pub async fn dispatch(
    app: &AppHandle,
    agent: Agent,
    task_id: Option<String>,
    cwd: Option<String>,
    prompt: String,
    attachments: Prepared,
    options: TurnOptions,
    sink: TurnSink,
) -> Result<(), String> {
    // New tasks have no queue to reserve yet, but obey the same migration gate.
    { let storage = app.state::<crate::storage::Store>(); let _permit = storage.permit()?; }
    if let Some(id) = task_id.clone() {
        if let Some(snapshot) = access(app, move |store| store.reserve(&id, agent)).await? {
            announce(app, &snapshot);
        }
    }
    let (result, observed) =
        run_reserved(app, agent, task_id, cwd, prompt, attachments, options, sink).await?;
    if let Some(id) = observed.task_id {
        let next = id.clone();
        let success = observed.success && result.is_ok();
        let error = observed.error.or_else(|| result.as_ref().err().cloned());
        let snapshot = access(app, move |store| {
            store.complete(&id, success, observed.cancelled, error, None)
        })
        .await?;
        if let Some(snapshot) = snapshot {
            announce(app, &snapshot);
        }
        kick(app.clone(), next);
    }
    result
}

async fn run_reserved(
    app: &AppHandle,
    agent: Agent,
    task_id: Option<String>,
    cwd: Option<String>,
    prompt: String,
    attachments: Prepared,
    options: TurnOptions,
    sink: TurnSink,
) -> Result<(Result<(), String>, Observed), String> {
    let observed = Arc::new(Mutex::new(Observed {
        task_id: task_id.clone(),
        ..Default::default()
    }));
    let capture = observed.clone();
    let sender = app.clone();
    let sink = TurnSink::new(move |event| {
        {
            let mut observed = capture.lock().map_err(|error| error.to_string())?;
            if let TurnEvent::Started { task_id } = &event {
                if sender.state::<Store>().started(task_id, agent)? {
                    sender.state::<Runs>().cancel(task_id);
                }
            }
            observed.record(&event);
        }
        sink.send(event)
    });
    let receipt = observed.clone();
    let sender = app.clone();
    let sink = sink.with_acceptance(move |id| {
        // A disk write failure keeps recovery evidence, but cannot undo the CLI's receipt.
        receipt.lock().map_err(|error| error.to_string())?.accepted = true;
        if let Some(snapshot) = sender.state::<Store>().accepted(&id)? {
            announce(&sender, &snapshot);
        }
        Ok(())
    });
    let runs = app.state::<Runs>();
    let result = match agent {
        Agent::Claude => {
            runner::send_turn(
                runs.inner(),
                task_id,
                cwd,
                prompt,
                attachments,
                options,
                sink,
            )
            .await
        }
        Agent::Codex => {
            codex::send_turn(
                runs.inner(),
                codex::TurnRequest {
                    task_id,
                    cwd,
                    prompt,
                    attachments,
                    options,
                },
                sink,
            )
            .await
        }
        Agent::Pi => {
            pi::send_turn(
                runs.inner(),
                codex::TurnRequest {
                    task_id,
                    cwd,
                    prompt,
                    attachments,
                    options,
                },
                sink,
            )
            .await
        }
    };
    let observed = std::mem::take(&mut *observed.lock().map_err(|error| error.to_string())?);
    Ok((result, observed))
}

pub fn kick(app: AppHandle, id: String) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = drain(&app, &id).await {
            // Persistence errors keep the queue intact and visible as an actionable failure.
            let _ = app.emit_to(
                "main",
                "queue-error",
                serde_json::json!({"taskId": id, "error": error}),
            );
        }
    });
}

async fn drain(app: &AppHandle, id: &str) -> Result<(), String> {
    loop {
        let target = id.to_owned();
        let Some((agent, entry, snapshot)) = access(app, move |store| store.claim(&target)).await?
        else {
            return Ok(());
        };
        announce(app, &snapshot);
        let outgoing = entry.clone();
        let target = id.to_owned();
        let prepared = access(app, move |store| {
            outgoing.prepare(&store.image_dir(&target))
        })
        .await;
        let (prepared, view) = match prepared {
            Ok((prepared, view)) => (Ok(prepared), view),
            Err(error) => (Err(error), entry.view(id)),
        };
        let sender = app.clone();
        let task_id = id.to_owned();
        let page_sink = TurnSink::new(move |event| {
            let source = matches!(event, TurnEvent::Started { .. }).then_some(&view);
            sender.emit_to("main", TURN_EVENT, serde_json::json!({
                "taskId": task_id, "agent": agent, "entryId": view.id, "entry": source, "event": event,
            })).map_err(|error| error.to_string())
        });
        let remote = app.state::<Remote>();
        let (run_id, sink) = remote.track(agent, page_sink.clone());
        let (result, observed) = match prepared {
            Ok(prepared) => {
                run_reserved(
                    app,
                    agent,
                    Some(id.to_owned()),
                    None,
                    entry.prompt.clone(),
                    prepared,
                    entry.options.clone(),
                    sink,
                )
                .await?
            }
            Err(error) => (Err(error), Observed::default()),
        };
        remote.end_run(&run_id, &result);
        if let Err(error) = &result {
            page_sink.send(TurnEvent::Finished {
                is_error: true,
                cancelled: false,
                message: Some(error.clone()),
            })?;
        }
        let target = id.to_owned();
        let snapshot = access(app, move |store| {
            store.finish_claim(&target, entry, result, observed)
        })
        .await?;
        if let Some(snapshot) = snapshot {
            announce(app, &snapshot);
        }
    }
}

#[cfg(test)]
#[path = "queue_delivery_tests.rs"]
mod delivery_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::attachments::Attachments;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::os::unix::fs::PermissionsExt;

    fn id() -> String {
        Uuid::new_v4().to_string()
    }
    fn entry(prompt: &str) -> Entry {
        Entry::new(prompt.into(), Vec::new(), TurnOptions::default()).unwrap()
    }
    fn store(dir: &tempfile::TempDir) -> Store {
        Store::new(dir.path().join("queues"))
    }

    #[test]
    fn writer_override_is_transient_and_older_queue_files_recheck_writers() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        let mut head = entry("one shot");
        head.options.ignore_external_writer = true;
        queue.enqueue(&task, Agent::Claude, head).unwrap();
        let path = queue.root.join(format!("{task}.json"));
        let bytes = fs::read(&path).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("ignoreExternalWriter"));
        let mut older: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        older["entries"][0]["options"]["ignoreExternalWriter"] = serde_json::json!(true);
        fs::write(&path, serde_json::to_vec(&older).unwrap()).unwrap();
        drop(queue);
        let restarted = store(&dir);
        restarted.resume(&task).unwrap();
        assert!(
            !restarted
                .claim(&task)
                .unwrap()
                .unwrap()
                .1
                .options
                .ignore_external_writer
        );
    }

    #[test]
    fn a_failed_attempt_consumes_its_writer_override() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        let mut head = entry("one attempt");
        head.options.ignore_external_writer = true;
        queue.enqueue(&task, Agent::Claude, head).unwrap();
        let (_, head, _) = queue.claim(&task).unwrap().unwrap();
        assert!(head.options.ignore_external_writer);
        queue
            .finish_claim(
                &task,
                head,
                Err("startup failed".into()),
                Observed::default(),
            )
            .unwrap();
        queue.resume(&task).unwrap();
        assert!(
            !queue
                .claim(&task)
                .unwrap()
                .unwrap()
                .1
                .options
                .ignore_external_writer
        );
    }

    #[test]
    fn future_queued_turns_and_explicit_resume_recheck_external_writers() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        queue.reserve(&task, Agent::Claude).unwrap();
        let mut future = entry("later");
        future.options.ignore_external_writer = true;
        queue.enqueue(&task, Agent::Claude, future).unwrap();
        queue.complete(&task, true, false, None, None).unwrap();
        assert!(
            !queue
                .claim(&task)
                .unwrap()
                .unwrap()
                .1
                .options
                .ignore_external_writer
        );
        let task = id();
        let mut head = entry("paused before sending");
        head.options.ignore_external_writer = true;
        queue.enqueue(&task, Agent::Claude, head).unwrap();
        queue.pause(&task).unwrap();
        queue.resume(&task).unwrap();
        assert!(
            !queue
                .claim(&task)
                .unwrap()
                .unwrap()
                .1
                .options
                .ignore_external_writer
        );
    }

    #[test]
    fn empty_queue_files_are_deleted_after_removal_and_receipt() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        let head = entry("remove");
        let entry_id = head.id.clone();
        queue.enqueue(&task, Agent::Claude, head).unwrap();
        queue.remove(&task, &entry_id).unwrap();
        let path = queue.root.join(format!("{task}.json"));
        assert!(
            !path.exists(),
            "empty queue file was retained after removal"
        );
        queue
            .enqueue(&task, Agent::Claude, entry("accepted"))
            .unwrap();
        queue.claim(&task).unwrap().unwrap();
        assert!(
            path.exists(),
            "unacknowledged message needs its durable record"
        );
        queue.accepted(&task).unwrap();
        assert!(
            !path.exists(),
            "empty queue file was retained after receipt"
        );
        queue.complete(&task, true, false, None, None).unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn loading_cleans_legacy_empty_queue_files() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        let path = queue.root.join(format!("{task}.json"));
        fs::create_dir_all(&queue.root).unwrap();
        fs::write(
            &path,
            serde_json::to_vec(&TaskQueue {
                task_id: task.clone(),
                agent: Agent::Claude,
                entries: vec![],
                in_flight: None,
                paused: true,
                error: Some("old".into()),
                revision: 2,
            })
            .unwrap(),
        )
        .unwrap();
        let loaded = queue.list().unwrap();
        assert!(!path.exists());
        assert!(loaded
            .iter()
            .all(|q| q.task_id != task || (!q.paused && q.error.is_none())));
    }

    #[test]
    fn image_payloads_are_immutable_files_and_survive_restart_until_receipt() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        let attachments = Attachments::default();
        let bytes = [0x89, b'P', b'N', b'G', 13, 10, 26, 10];
        let image = serde_json::to_value(
            attachments
                .add_pasted_image(&STANDARD.encode(bytes))
                .unwrap(),
        )
        .unwrap();
        let attachment_id = image["id"].as_str().unwrap().to_owned();
        let head = Entry::new(
            "image".into(),
            attachments.capture(&[attachment_id.clone()]).unwrap(),
            TurnOptions::default(),
        )
        .unwrap();
        let entry_id = head.id.clone();
        let snapshot = queue.enqueue(&task, Agent::Claude, head).unwrap();
        let path = queue.root.join(format!("{task}.json"));
        assert!(
            !fs::read_to_string(&path)
                .unwrap()
                .contains(&STANDARD.encode(bytes)),
            "metadata contains image bytes"
        );
        let image_path = queue.root.join("images").join(&task).join(&attachment_id);
        assert_eq!(fs::read(&image_path).unwrap(), bytes);
        let modified = fs::metadata(&image_path).unwrap().modified().unwrap();
        let preview = serde_json::to_value(&snapshot.entries[0].attachments[0]).unwrap();
        assert_eq!(
            preview["preview"],
            format!("queue-image://localhost/{task}/{attachment_id}")
        );
        queue.edit(&task, &entry_id, "edited".into()).unwrap();
        assert_eq!(
            fs::metadata(&image_path).unwrap().modified().unwrap(),
            modified
        );
        drop(queue);
        let restarted = store(&dir);
        restarted.resume(&task).unwrap();
        restarted.claim(&task).unwrap().unwrap();
        assert!(image_path.exists(), "unacknowledged image was deleted");
        restarted.accepted(&task).unwrap();
        assert!(!image_path.exists(), "accepted image payload was retained");
    }

    #[test]
    fn a_sent_image_preview_survives_queue_cache_cleanup() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        let attachments = Attachments::default();
        let bytes = [0x89, b'P', b'N', b'G', 13, 10, 26, 10];
        let image = serde_json::to_value(
            attachments.add_pasted_image(&STANDARD.encode(bytes)).unwrap(),
        ).unwrap();
        let image_id = image["id"].as_str().unwrap().to_owned();
        queue.enqueue(&task, Agent::Claude, Entry::new(
            "live image".into(), attachments.capture(&[image_id.clone()]).unwrap(), TurnOptions::default(),
        ).unwrap()).unwrap();
        let (_, sent, _) = queue.claim(&task).unwrap().unwrap();
        let (_prepared, view) = sent.prepare(&queue.image_dir(&task)).unwrap();
        queue.accepted(&task).unwrap();
        assert!(!queue.image_dir(&task).exists());
        let preview = serde_json::to_value(&view.attachments[0]).unwrap();
        assert_eq!(preview["preview"], format!("data:image/png;base64,{}", STANDARD.encode(bytes)));
    }

    #[test]
    fn quarantining_metadata_preserves_its_image_payloads_across_new_sends() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        let attachments = Attachments::default();
        let image = serde_json::to_value(
            attachments
                .add_pasted_image(&STANDARD.encode([0x89, b'P', b'N', b'G', 13, 10]))
                .unwrap(),
        )
        .unwrap();
        let attachment_id = image["id"].as_str().unwrap().to_owned();
        queue
            .enqueue(
                &task,
                Agent::Claude,
                Entry::new(
                    "keep image".into(),
                    attachments.capture(&[attachment_id.clone()]).unwrap(),
                    TurnOptions::default(),
                )
                .unwrap(),
            )
            .unwrap();
        let image_path = queue.root.join("images").join(&task).join(&attachment_id);
        assert!(image_path.exists());
        fs::write(queue.root.join(format!("{task}.json")), b"{broken").unwrap();
        drop(queue);
        let restarted = store(&dir);
        assert!(restarted.list().unwrap().is_empty());
        restarted
            .enqueue(&task, Agent::Claude, entry("new send"))
            .unwrap();
        assert!(image_path.exists(), "quarantined metadata lost its image");
    }

    #[test]
    fn legacy_inline_images_migrate_once_and_use_the_restricted_preview_protocol() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        let attachments = Attachments::default();
        let bytes = [0x89, b'P', b'N', b'G', 13, 10];
        let image = serde_json::to_value(
            attachments
                .add_pasted_image(&STANDARD.encode(bytes))
                .unwrap(),
        )
        .unwrap();
        let image_id = image["id"].as_str().unwrap().to_owned();
        let legacy = TaskQueue {
            task_id: task.clone(),
            agent: Agent::Claude,
            entries: vec![Entry::new(
                "legacy".into(),
                attachments.capture(&[image_id.clone()]).unwrap(),
                TurnOptions::default(),
            )
            .unwrap()],
            in_flight: None,
            paused: false,
            error: None,
            revision: 1,
        };
        fs::create_dir_all(&queue.root).unwrap();
        let path = queue.root.join(format!("{task}.json"));
        fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
        let snapshot = queue.list().unwrap().remove(0);
        assert!(snapshot.paused);
        assert!(!fs::read_to_string(&path)
            .unwrap()
            .contains(&STANDARD.encode(bytes)));
        assert_eq!(
            queue.image(&format!("/{task}/{image_id}")).unwrap(),
            ("image/png", bytes.to_vec())
        );
        assert!(queue.image("/../secret").is_err());
        assert!(queue.image(&format!("/{task}/../secret")).is_err());
        assert!(queue.image(&format!("/{task}/%2Fsecret")).is_err());
    }

    #[test]
    fn image_migration_failure_pauses_only_its_queue_and_keeps_legacy_data() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        let healthy = id();
        let attachments = Attachments::default();
        let image = serde_json::to_value(
            attachments
                .add_pasted_image(&STANDARD.encode([0x89, b'P', b'N', b'G']))
                .unwrap(),
        )
        .unwrap();
        let image_id = image["id"].as_str().unwrap().to_owned();
        let legacy = TaskQueue {
            task_id: task.clone(),
            agent: Agent::Claude,
            entries: vec![Entry::new(
                "legacy".into(),
                attachments.capture(&[image_id]).unwrap(),
                TurnOptions::default(),
            )
            .unwrap()],
            in_flight: None,
            paused: false,
            error: None,
            revision: 1,
        };
        queue
            .enqueue(&healthy, Agent::Claude, entry("healthy"))
            .unwrap();
        let path = queue.root.join(format!("{task}.json"));
        let bytes = serde_json::to_vec(&legacy).unwrap();
        fs::write(&path, &bytes).unwrap();
        fs::write(queue.root.join("images"), b"blocked").unwrap();
        drop(queue);
        let restarted = store(&dir);
        let snapshots = restarted.list().unwrap();
        assert_eq!(snapshots.len(), 2);
        assert!(snapshots
            .iter()
            .find(|q| q.task_id == task)
            .unwrap()
            .error
            .is_some());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        restarted.resume(&healthy).unwrap();
        assert_eq!(
            restarted.claim(&healthy).unwrap().unwrap().1.prompt,
            "healthy"
        );
    }

    #[test]
    fn orphaned_images_are_cleaned_after_an_interrupted_first_enqueue() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        let image_dir = queue.image_dir(&task);
        fs::create_dir_all(&image_dir).unwrap();
        fs::write(image_dir.join(id()), b"uncommitted image").unwrap();
        assert!(queue.list().unwrap().is_empty());
        assert!(!image_dir.exists());
    }

    /// Run explicitly with an isolated fixture directory; regular tests stay small.
    #[test]
    #[ignore]
    fn measure_large_image_queue_operations() {
        let fixture = PathBuf::from(std::env::var_os("TANDEM_QUEUE_BENCH_DIR").unwrap());
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        let attachments = Attachments::default();
        let mut enqueue_ms = Vec::new();
        for index in 0..20 {
            let added = serde_json::to_value(
                attachments.add_paths(&[fixture.join(format!("{index}.png"))]),
            )
            .unwrap();
            let attachment_id = added["added"][0]["id"].as_str().unwrap().to_owned();
            let head = Entry::new(
                format!("image {index}"),
                attachments.capture(&[attachment_id.clone()]).unwrap(),
                TurnOptions::default(),
            )
            .unwrap();
            let start = std::time::Instant::now();
            queue.enqueue(&task, Agent::Claude, head).unwrap();
            enqueue_ms.push(start.elapsed().as_secs_f64() * 1000.0);
            attachments.release(&[attachment_id]);
        }
        queue.pause(&task).unwrap();
        let mut edit_ms = Vec::new();
        let mut reorder_ms = Vec::new();
        let head_id = queue.list().unwrap()[0].entries[0].id.clone();
        for index in 0..3 {
            let start = std::time::Instant::now();
            queue
                .edit(&task, &head_id, format!("changed {index}"))
                .unwrap();
            edit_ms.push(start.elapsed().as_secs_f64() * 1000.0);
            let start = std::time::Instant::now();
            queue.reorder(&task, &head_id, index + 1).unwrap();
            reorder_ms.push(start.elapsed().as_secs_f64() * 1000.0);
        }
        fn bytes_in(dir: &Path) -> u64 {
            fs::read_dir(dir)
                .unwrap()
                .map(|path| {
                    let path = path.unwrap().path();
                    if path.is_dir() {
                        bytes_in(&path)
                    } else {
                        fs::metadata(path).unwrap().len()
                    }
                })
                .sum()
        }
        let bytes = bytes_in(&queue.root);
        if let Some(target) = std::env::var_os("TANDEM_QUEUE_BENCH_FIXTURE_OUT") {
            fn copy_dir(from: &Path, to: &Path) {
                fs::create_dir_all(to).unwrap();
                for path in fs::read_dir(from).unwrap() {
                    let path = path.unwrap().path();
                    let dest = to.join(path.file_name().unwrap());
                    if path.is_dir() {
                        copy_dir(&path, &dest);
                    } else {
                        fs::copy(&path, &dest).unwrap();
                    }
                }
            }
            copy_dir(&queue.root, Path::new(&target));
        }
        drop(queue);
        let start = std::time::Instant::now();
        let restarted = store(&dir);
        let loaded = restarted.list().unwrap();
        let load_ms = start.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(loaded[0].entries.len(), 20);
        let report = serde_json::json!({"enqueueMs":enqueue_ms,"editMs":edit_ms,"reorderMs":reorder_ms,"loadMs":load_ms,"diskBytes":bytes});
        fs::write(
            std::env::var_os("TANDEM_QUEUE_BENCH_OUT").unwrap(),
            serde_json::to_vec_pretty(&report).unwrap(),
        )
        .unwrap();
        eprintln!("{report}");
    }

    #[test]
    fn a_corrupt_queue_is_preserved_while_healthy_tasks_keep_working() {
        let dir = tempfile::tempdir().unwrap();
        let task = id();
        store(&dir)
            .enqueue(&task, Agent::Claude, entry("healthy"))
            .unwrap();
        let bad = dir.path().join("queues").join(format!("{}.json", id()));
        fs::write(&bad, b"{broken queue").unwrap();
        let queue = store(&dir);
        let snapshots = queue.list().unwrap();
        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].task_id, task);
        assert!(!bad.exists());
        let quarantined = fs::read_dir(&queue.root)
            .unwrap()
            .map(|p| p.unwrap().path())
            .find(|p| p.extension().is_some_and(|ext| ext == "corrupt"))
            .unwrap();
        assert_eq!(fs::read(quarantined).unwrap(), b"{broken queue");
        let errors = queue.take_errors().unwrap();
        assert_eq!(errors.len(), 1);
        assert_eq!(
            errors[0].task_id.as_deref(),
            bad.file_stem().and_then(|s| s.to_str())
        );
        assert!(errors[0].error.contains(".corrupt"));
        assert!(queue.take_errors().unwrap().is_empty());
        queue.resume(&task).unwrap();
        assert_eq!(queue.claim(&task).unwrap().unwrap().1.prompt, "healthy");
        queue.reserve(&id(), Agent::Codex).unwrap();
    }

    #[test]
    fn an_unreadable_queue_does_not_block_other_queues() {
        let dir = tempfile::tempdir().unwrap();
        let task = id();
        store(&dir)
            .enqueue(&task, Agent::Pi, entry("healthy"))
            .unwrap();
        // A directory named .json makes read fail on every test user's permissions.
        let bad = dir.path().join("queues").join(format!("{}.json", id()));
        fs::create_dir(&bad).unwrap();
        let queue = store(&dir);
        assert_eq!(queue.list().unwrap().len(), 1);
        assert!(!bad.exists());
        queue.reserve(&id(), Agent::Claude).unwrap();
    }

    #[test]
    fn reserve_persists_a_fresh_empty_queue_after_a_failure() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        queue.reserve(&task, Agent::Claude).unwrap();
        let pending = entry("discard");
        let pending_id = pending.id.clone();
        queue.enqueue(&task, Agent::Claude, pending).unwrap();
        queue.pause(&task).unwrap();
        queue
            .complete(&task, false, false, Some("previous error".into()), None)
            .unwrap();
        queue.remove(&task, &pending_id).unwrap();
        queue.reserve(&task, Agent::Claude).unwrap();
        let current = queue.list().unwrap().remove(0);
        assert!(!current.paused);
        assert!(current.error.is_none());
        assert!(!queue.root.join(format!("{task}.json")).exists());
    }

    #[test]
    fn enqueue_during_a_new_direct_turn_drains_after_clearing_a_stopped_queue() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        queue.reserve(&task, Agent::Claude).unwrap();
        let pending = entry("discard");
        let pending_id = pending.id.clone();
        queue.enqueue(&task, Agent::Claude, pending).unwrap();
        queue.pause(&task).unwrap();
        queue.complete(&task, false, true, None, None).unwrap();
        queue.remove(&task, &pending_id).unwrap();
        queue.reserve(&task, Agent::Claude).unwrap();
        queue
            .enqueue(&task, Agent::Claude, entry("while running"))
            .unwrap();
        queue.complete(&task, true, false, None, None).unwrap();
        assert_eq!(
            queue.claim(&task).unwrap().unwrap().1.prompt,
            "while running"
        );
    }

    #[test]
    fn a_claimed_message_stays_on_disk_until_cli_acceptance() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        let head = entry("keep until accepted");
        let entry_id = head.id.clone();
        queue.enqueue(&task, Agent::Claude, head).unwrap();
        queue.claim(&task).unwrap().unwrap();
        let disk = fs::read_to_string(queue.root.join(format!("{task}.json"))).unwrap();
        assert!(
            disk.contains(&entry_id),
            "claim removed the only durable copy"
        );
    }

    #[test]
    fn a_crash_after_claim_restores_the_head_and_pauses_for_a_resend_decision() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        let mut head = entry("uncertain delivery");
        head.options.model = Some("opus".into());
        head.options.effort = Some("max".into());
        queue.enqueue(&task, Agent::Claude, head).unwrap();
        queue.enqueue(&task, Agent::Claude, entry("tail")).unwrap();
        queue.claim(&task).unwrap().unwrap();
        drop(queue);
        let restored = store(&dir);
        let snapshot = restored.list().unwrap().remove(0);
        assert_eq!(
            snapshot
                .entries
                .iter()
                .map(|e| e.prompt.as_str())
                .collect::<Vec<_>>(),
            ["uncertain delivery", "tail"]
        );
        assert_eq!(snapshot.entries[0].options.effort.as_deref(), Some("max"));
        assert!(snapshot.paused);
        assert!(snapshot
            .error
            .as_deref()
            .is_some_and(|e| e.contains("接收")));
        assert!(restored.claim(&task).unwrap().is_none());
    }

    #[test]
    fn repeated_corruption_preserves_each_file_and_reports_unknown_task_ids() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("queues");
        fs::create_dir(&root).unwrap();
        for content in ["{first", "{second"] {
            fs::write(root.join("unknown.json"), content).unwrap();
            let queue = store(&dir);
            assert!(queue.list().unwrap().is_empty());
            let errors = queue.take_errors().unwrap();
            assert_eq!(errors.len(), 1);
            assert!(errors[0].task_id.is_none());
        }
        let mut preserved: Vec<_> = fs::read_dir(&root)
            .unwrap()
            .map(|p| fs::read_to_string(p.unwrap().path()).unwrap())
            .collect();
        preserved.sort();
        assert_eq!(preserved, ["{first", "{second"]);
    }

    #[test]
    fn accepted_messages_are_removed_durably_and_stay_removed_after_restart() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        queue
            .enqueue(&task, Agent::Claude, entry("accepted"))
            .unwrap();
        queue.enqueue(&task, Agent::Claude, entry("tail")).unwrap();
        queue.claim(&task).unwrap().unwrap();
        queue.accepted(&task).unwrap();
        drop(queue);
        let restarted = store(&dir);
        let snapshot = restarted.list().unwrap().remove(0);
        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(snapshot.entries[0].prompt, "tail");
        assert!(snapshot.paused);
        assert!(snapshot.error.is_none());
    }

    #[test]
    fn a_success_event_without_receipt_keeps_the_head_and_pauses() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        queue
            .enqueue(&task, Agent::Claude, entry("unconfirmed"))
            .unwrap();
        let (_, head, _) = queue.claim(&task).unwrap().unwrap();
        let mut observed = Observed::default();
        observed.record(&TurnEvent::Started {
            task_id: task.clone(),
        });
        observed.record(&TurnEvent::Finished {
            is_error: false,
            cancelled: false,
            message: None,
        });
        let snapshot = queue
            .finish_claim(&task, head, Ok(()), observed)
            .unwrap()
            .unwrap();
        assert!(snapshot.paused);
        assert_eq!(snapshot.entries[0].prompt, "unconfirmed");
    }

    #[test]
    fn a_failed_receipt_write_keeps_the_durable_message_for_crash_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        queue
            .enqueue(&task, Agent::Claude, entry("uncertain"))
            .unwrap();
        queue.claim(&task).unwrap().unwrap();
        let saved = dir.path().join("saved");
        fs::rename(&queue.root, &saved).unwrap();
        fs::write(&queue.root, "blocked").unwrap();
        assert!(queue.accepted(&task).is_err());
        fs::remove_file(&queue.root).unwrap();
        fs::rename(&saved, &queue.root).unwrap();
        drop(queue);
        let restarted = store(&dir);
        let snapshot = restarted.list().unwrap().remove(0);
        assert_eq!(snapshot.entries[0].prompt, "uncertain");
        assert!(snapshot.paused);
        assert_eq!(snapshot.error.as_deref(), Some(UNCERTAIN_DELIVERY));
        let disk: TaskQueue =
            serde_json::from_slice(&fs::read(restarted.root.join(format!("{task}.json"))).unwrap())
                .unwrap();
        assert!(disk.in_flight.is_none());
        assert_eq!(disk.entries.len(), 1);
    }

    #[test]
    fn a_recovery_write_failure_keeps_the_valid_queue_and_its_original_evidence() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        queue
            .enqueue(&task, Agent::Claude, entry("recover once"))
            .unwrap();
        queue.claim(&task).unwrap().unwrap();
        let blocked_temp = queue.root.join(format!("{task}.tmp"));
        fs::create_dir(&blocked_temp).unwrap();
        drop(queue);

        let restarted = store(&dir);
        let snapshot = restarted.list().unwrap().remove(0);
        assert!(snapshot.paused);
        assert_eq!(snapshot.entries[0].prompt, "recover once");
        let errors = restarted.take_errors().unwrap();
        assert!(errors[0].error.contains("保存待发送队列失败"));
        let path = restarted.root.join(format!("{task}.json"));
        assert!(Store::read_queue(&path).unwrap().in_flight.is_some());
        assert!(!fs::read_dir(&restarted.root).unwrap().any(|p| p
            .unwrap()
            .path()
            .extension()
            .is_some_and(|ext| ext == "corrupt")));

        fs::remove_dir(&blocked_temp).unwrap();
        restarted.resume(&task).unwrap();
        let disk = Store::read_queue(&path).unwrap();
        assert!(disk.in_flight.is_none());
        assert_eq!(disk.entries.len(), 1);
        assert_eq!(
            restarted.claim(&task).unwrap().unwrap().1.prompt,
            "recover once"
        );
    }

    #[test]
    fn queues_are_per_task_and_restart_paused_with_options_and_attachments() {
        let dir = tempfile::tempdir().unwrap();
        let first = id();
        let second = id();
        let attachments = Attachments::default();
        let image = attachments
            .add_pasted_image(&STANDARD.encode([0x89, b'P', b'N', b'G', 13, 10]))
            .unwrap();
        let image_id = serde_json::to_value(image).unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let path = dir.path().join("notes.txt");
        fs::write(&path, "notes").unwrap();
        let file = serde_json::to_value(attachments.add_paths(&[path.clone()])).unwrap();
        let file_id = file["added"][0]["id"].as_str().unwrap().to_owned();
        let ids = vec![image_id, file_id];
        let options = TurnOptions {
            model: Some("sonnet".into()),
            effort: Some("high".into()),
            permission_mode: Some("auto".into()),
            ..Default::default()
        };
        let queued = Entry::new(
            "检查附件".into(),
            attachments.capture(&ids).unwrap(),
            options,
        )
        .unwrap();
        let queue = store(&dir);
        queue.enqueue(&first, Agent::Claude, queued).unwrap();
        attachments.release(&ids);
        assert!(attachments.capture(&ids).is_err());
        queue
            .enqueue(&second, Agent::Codex, entry("另一个任务"))
            .unwrap();
        drop(queue);
        drop(attachments);

        let restored = store(&dir);
        let mut snapshots = restored.list().unwrap();
        snapshots.sort_by(|a, b| a.task_id.cmp(&b.task_id));
        assert_eq!(snapshots.len(), 2);
        assert!(snapshots.iter().all(|queue| queue.paused));
        assert!(restored.claim(&first).unwrap().is_none());
        restored.resume(&first).unwrap();
        let (agent, sent, _) = restored.claim(&first).unwrap().unwrap();
        assert_eq!(agent, Agent::Claude);
        assert_eq!(sent.options.model.as_deref(), Some("sonnet"));
        assert_eq!(sent.options.effort.as_deref(), Some("high"));
        assert_eq!(sent.options.permission_mode.as_deref(), Some("auto"));
        let prepared =
            Prepared::from_saved(&sent.attachments, &restored.image_dir(&first)).unwrap();
        let content = prepared.content(&sent.prompt);
        assert_eq!(content[0]["source"]["media_type"], "image/png");
        assert!(content[1]["text"].as_str().unwrap().contains("notes.txt"));
        assert_eq!(
            prepared.read_rules(),
            [format!(
                "Read(/{})",
                fs::canonicalize(&path).unwrap().display()
            )]
        );
        assert_eq!(sent.view(&first).attachments.len(), 2);
        assert_eq!(
            fs::metadata(dir.path().join("queues").join(format!("{first}.json")))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(dir.path().join("queues"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
    }

    #[test]
    fn an_empty_completed_queue_stays_ready_after_restart() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        queue.enqueue(&task, Agent::Claude, entry("first")).unwrap();
        queue.claim(&task).unwrap().unwrap();
        queue.complete(&task, true, false, None, None).unwrap();
        drop(queue);
        let restored = store(&dir);
        assert!(restored.list().unwrap().is_empty());
        restored.reserve(&task, Agent::Claude).unwrap();
        restored
            .enqueue(&task, Agent::Claude, entry("next"))
            .unwrap();
        restored.complete(&task, true, false, None, None).unwrap();
        assert!(restored.claim(&task).unwrap().is_some());
    }

    #[test]
    fn sending_to_an_idle_empty_queue_starts_a_new_turn_after_a_stop() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        queue.enqueue(&task, Agent::Claude, entry("first")).unwrap();
        queue.claim(&task).unwrap().unwrap();
        queue.pause(&task).unwrap();
        queue.complete(&task, false, true, None, None).unwrap();
        assert!(queue.list().unwrap()[0].paused);
        let snapshot = queue.enqueue(&task, Agent::Claude, entry("next")).unwrap();
        assert!(!snapshot.paused);
        assert!(queue.claim(&task).unwrap().is_some());
    }

    #[test]
    fn running_turn_drains_fifo_only_after_completion() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        queue.reserve(&task, Agent::Claude).unwrap();
        queue.enqueue(&task, Agent::Claude, entry("first")).unwrap();
        queue
            .enqueue(&task, Agent::Claude, entry("second"))
            .unwrap();
        assert!(queue.claim(&task).unwrap().is_none());
        queue.complete(&task, true, false, None, None).unwrap();
        let (_, first, _) = queue.claim(&task).unwrap().unwrap();
        assert_eq!(first.prompt, "first");
        assert!(queue.claim(&task).unwrap().is_none());
        queue.complete(&task, true, false, None, None).unwrap();
        assert_eq!(queue.claim(&task).unwrap().unwrap().1.prompt, "second");
    }

    #[test]
    fn stop_wins_over_a_successful_finish_until_explicit_resume() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        queue.reserve(&task, Agent::Claude).unwrap();
        queue.enqueue(&task, Agent::Claude, entry("wait")).unwrap();
        queue.pause(&task).unwrap();
        queue.complete(&task, true, false, None, None).unwrap();
        assert!(queue.claim(&task).unwrap().is_none());
        queue
            .enqueue(&task, Agent::Claude, entry("also wait"))
            .unwrap();
        assert!(queue.claim(&task).unwrap().is_none());
        queue.resume(&task).unwrap();
        assert_eq!(queue.claim(&task).unwrap().unwrap().1.prompt, "wait");
    }

    #[test]
    fn resume_while_stopping_waits_for_process_exit_and_then_continues() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        queue.reserve(&task, Agent::Claude).unwrap();
        queue.enqueue(&task, Agent::Claude, entry("next")).unwrap();
        queue.pause(&task).unwrap();
        queue.resume(&task).unwrap();
        assert!(queue.claim(&task).unwrap().is_none());
        queue.complete(&task, false, true, None, None).unwrap();
        assert!(queue.claim(&task).unwrap().is_some());
    }

    #[test]
    fn a_second_stop_overrides_an_earlier_resume_request() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        queue.reserve(&task, Agent::Claude).unwrap();
        queue.pause(&task).unwrap();
        let snapshot = queue.enqueue(&task, Agent::Claude, entry("wait")).unwrap();
        assert!(snapshot.paused);
        queue.resume(&task).unwrap();
        queue.pause(&task).unwrap();
        queue.complete(&task, false, true, None, None).unwrap();
        assert!(queue.claim(&task).unwrap().is_none());
    }

    #[test]
    fn errors_pause_and_preflight_failure_restores_the_unsent_head() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        queue.enqueue(&task, Agent::Pi, entry("keep")).unwrap();
        queue.enqueue(&task, Agent::Pi, entry("tail")).unwrap();
        let (_, head, _) = queue.claim(&task).unwrap().unwrap();
        queue
            .complete(&task, false, false, Some("CLI 已被卸载".into()), Some(head))
            .unwrap();
        let snapshot = queue.list().unwrap().remove(0);
        assert!(snapshot.paused);
        assert_eq!(
            snapshot
                .entries
                .iter()
                .map(|entry| entry.prompt.as_str())
                .collect::<Vec<_>>(),
            ["keep", "tail"]
        );
        assert_eq!(snapshot.error.as_deref(), Some("CLI 已被卸载"));
        assert!(queue.claim(&task).unwrap().is_none());
        queue.resume(&task).unwrap();
        queue.claim(&task).unwrap().unwrap();
        queue
            .complete(&task, false, false, Some("任务出错".into()), None)
            .unwrap();
        assert!(queue.list().unwrap()[0].paused);
    }

    #[test]
    fn edit_reorder_and_delete_preserve_options_and_only_affect_unsent_rows() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        let mut first = entry("first");
        first.options.model = Some("opus".into());
        first.options.effort = Some("max".into());
        let first_id = first.id.clone();
        queue.enqueue(&task, Agent::Claude, first).unwrap();
        let second = entry("second");
        let second_id = second.id.clone();
        queue.enqueue(&task, Agent::Claude, second).unwrap();
        queue.enqueue(&task, Agent::Claude, entry("third")).unwrap();
        queue.reorder(&task, &first_id, 2).unwrap();
        let edited = queue.edit(&task, &first_id, "updated".into()).unwrap();
        assert_eq!(edited.entries[2].options.model.as_deref(), Some("opus"));
        assert_eq!(edited.entries[2].options.effort.as_deref(), Some("max"));
        assert!(queue.reorder(&task, &first_id, 3).is_err());
        assert!(queue.edit(&task, &first_id, " ".into()).is_err());
        queue.remove(&task, &second_id).unwrap();
        let snapshot = queue.list().unwrap().remove(0);
        assert_eq!(
            snapshot
                .entries
                .iter()
                .map(|entry| entry.prompt.as_str())
                .collect::<Vec<_>>(),
            ["third", "updated"]
        );
        let (_, claimed, _) = queue.claim(&task).unwrap().unwrap();
        assert!(queue.edit(&task, &claimed.id, "too late".into()).is_err());
        assert!(queue.remove(&task, &claimed.id).is_err());
    }

    #[test]
    fn editing_locks_one_row_and_dragging_locks_the_whole_queue_by_owner() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        queue.enqueue(&task, Agent::Claude, entry("first")).unwrap();
        let second = entry("editing");
        let second_id = second.id.clone();
        queue.enqueue(&task, Agent::Claude, second).unwrap();
        queue
            .set_lock(&task, "editor".into(), Some(second_id.clone()), true)
            .unwrap();
        assert_eq!(queue.claim(&task).unwrap().unwrap().1.prompt, "first");
        queue.complete(&task, true, false, None, None).unwrap();
        assert!(queue.claim(&task).unwrap().is_none());
        queue.set_lock(&task, "drag".into(), None, true).unwrap();
        queue
            .set_lock(&task, "editor".into(), Some(second_id.clone()), false)
            .unwrap();
        queue
            .set_lock(&task, "another-owner".into(), None, false)
            .unwrap();
        assert!(queue.claim(&task).unwrap().is_none());
        queue.set_lock(&task, "drag".into(), None, false).unwrap();
        assert_eq!(queue.claim(&task).unwrap().unwrap().1.prompt, "editing");
    }

    #[test]
    fn concurrent_dispatchers_claim_each_message_once() {
        let dir = tempfile::tempdir().unwrap();
        let queue = Arc::new(store(&dir));
        let task = id();
        queue.enqueue(&task, Agent::Claude, entry("one")).unwrap();
        let claims: Vec<_> = (0..8)
            .map(|_| {
                let queue = queue.clone();
                let task = task.clone();
                std::thread::spawn(move || queue.claim(&task).unwrap().is_some())
            })
            .collect();
        assert_eq!(
            claims
                .into_iter()
                .map(|thread| usize::from(thread.join().unwrap()))
                .sum::<usize>(),
            1
        );
        assert!(queue.active_agent(&task).unwrap().is_some());
        assert!(queue.claim(&task).unwrap().is_none());
    }

    #[test]
    fn title_metadata_writes_hold_dispatch_and_keep_a_paused_queue_paused() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        queue.enqueue(&task, Agent::Claude, entry("next")).unwrap();
        queue.reserve_metadata(&task, Agent::Claude).unwrap();
        assert!(queue.claim(&task).unwrap().is_none());
        queue.pause(&task).unwrap();
        queue.release_metadata(&task).unwrap();
        assert!(queue.claim(&task).unwrap().is_none());
        queue.resume(&task).unwrap();
        assert!(queue.claim(&task).unwrap().is_some());
    }

    #[test]
    fn failed_persistence_keeps_the_existing_queue_and_draft_attachments() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        queue
            .enqueue(&task, Agent::Claude, entry("original"))
            .unwrap();
        let saved = dir.path().join("saved");
        fs::rename(&queue.root, &saved).unwrap();
        fs::write(&queue.root, "directory blocked").unwrap();
        let attachments = Attachments::default();
        let image = serde_json::to_value(
            attachments
                .add_pasted_image(&STANDARD.encode([0x89, b'P', b'N', b'G']))
                .unwrap(),
        )
        .unwrap();
        let ids = [image["id"].as_str().unwrap().to_owned()];
        let queued = Entry::new(
            "new".into(),
            attachments.capture(&ids).unwrap(),
            TurnOptions::default(),
        )
        .unwrap();
        assert!(queue.enqueue(&task, Agent::Claude, queued).is_err());
        assert_eq!(queue.list().unwrap()[0].entries[0].prompt, "original");
        assert!(attachments.capture(&ids).is_ok());
        assert!(queue.claim(&task).is_err());
        assert!(queue.active_agent(&task).unwrap().is_none());
    }

    #[test]
    fn a_completion_write_failure_keeps_the_remaining_queue_paused_in_memory() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        let task = id();
        queue.reserve(&task, Agent::Claude).unwrap();
        queue.enqueue(&task, Agent::Claude, entry("keep")).unwrap();
        fs::rename(&queue.root, dir.path().join("saved")).unwrap();
        fs::write(&queue.root, "directory blocked").unwrap();
        assert!(queue
            .complete(&task, false, false, Some("CLI failed".into()), None)
            .is_err());
        assert!(queue.list().unwrap()[0].paused);
        assert!(queue.claim(&task).unwrap().is_none());
    }

    #[test]
    fn validates_ipc_content_task_ids_and_agent_options() {
        let dir = tempfile::tempdir().unwrap();
        let queue = store(&dir);
        assert!(queue
            .enqueue("../escape", Agent::Claude, entry("x"))
            .is_err());
        assert!(Entry::new(" ".into(), vec![], TurnOptions::default()).is_err());
        let task = id();
        let mut invalid = entry("x");
        invalid.options.effort = Some("--flag".into());
        assert!(queue.enqueue(&task, Agent::Claude, invalid).is_err());
        queue.enqueue(&task, Agent::Claude, entry("x")).unwrap();
        assert!(queue.enqueue(&task, Agent::Codex, entry("x")).is_err());
    }
}

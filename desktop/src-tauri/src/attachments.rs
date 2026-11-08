//! Files attached to a draft. The page only ever holds ids. Paths come from the native file
//! dialog or a window drop, so a compromised page cannot make Tandem read an arbitrary file.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, DragDropEvent, Emitter, Manager};
use uuid::Uuid;

/// The API refuses larger images. A larger image file goes by path, and the CLI resizes it.
pub(crate) const MAX_INLINE_IMAGE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_HELD: usize = 20;
/// The page reads these lines back from the task file to show file chips.
pub const ATTACHED_FILE_PREFIX: &str = "Attached file, readable with your tools even outside the workspace: ";
pub const DROPPED_EVENT: &str = "attachments-dropped";
pub const DRAG_EVENT: &str = "attachment-drag";

/// Only native history parsing calls this reader. The page receives image bytes, never a path-reading capability.
pub(crate) fn read_native_image(path: &Path) -> Result<String, &'static str> {
    use std::os::unix::fs::OpenOptionsExt;
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase();
    if !["png", "jpg", "jpeg", "gif", "webp"].contains(&extension.as_str()) {
        return Err("unsupported");
    }
    let file = fs::OpenOptions::new().read(true).custom_flags(libc::O_NONBLOCK).open(path)
        .map_err(|error| if error.kind() == std::io::ErrorKind::NotFound { "missing" } else { "unreadable" })?;
    let metadata = file.metadata().map_err(|_| "unreadable")?;
    if !metadata.is_file() { return Err("unsupported"); }
    if metadata.len() > MAX_INLINE_IMAGE_BYTES { return Err("tooLarge"); }
    let mut bytes = Vec::new();
    file.take(MAX_INLINE_IMAGE_BYTES + 1).read_to_end(&mut bytes).map_err(|_| "unreadable")?;
    if bytes.len() as u64 > MAX_INLINE_IMAGE_BYTES { return Err("tooLarge"); }
    let media_type = image_media_type(&bytes).ok_or("unsupported")?;
    Ok(format!("data:{media_type};base64,{}", STANDARD.encode(bytes)))
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AttachmentKind {
    Image,
    File,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    id: String,
    name: String,
    kind: AttachmentKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    preview: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct AddResult {
    added: Vec<Attachment>,
    errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum Stored {
    Image { name: String, media_type: String, data: String },
    File { name: String, path: PathBuf },
}

/// Captured image bytes exist only in memory; queue JSON stores immutable image-file references.
#[derive(Debug, Clone, Serialize, Deserialize)]
enum SavedStored {
    #[serde(skip)]
    Image { name: String, media_type: String, data: String },
    ImageFile { name: String, media_type: String },
    File { name: String, path: PathBuf },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedAttachment {
    id: String,
    stored: SavedStored,
}

impl SavedAttachment {
    pub fn presentation(&self, task_id: &str) -> Attachment {
        match &self.stored {
            SavedStored::Image { name, media_type, data } => Attachment {
                id: self.id.clone(), name: name.clone(), kind: AttachmentKind::Image,
                path: None, preview: Some(format!("data:{media_type};base64,{data}")),
            },
            SavedStored::ImageFile { name, .. } => Attachment {
                id: self.id.clone(), name: name.clone(), kind: AttachmentKind::Image,
                path: None, preview: Some(format!("queue-image://localhost/{task_id}/{}", self.id)),
            },
            SavedStored::File { name, path } => Attachment {
                id: self.id.clone(), name: name.clone(), kind: AttachmentKind::File,
                path: Some(path.to_string_lossy().into_owned()), preview: None,
            },
        }
    }

    pub fn image_id(&self) -> Option<&str> {
        match self.stored { SavedStored::Image { .. } | SavedStored::ImageFile { .. } => Some(&self.id), SavedStored::File { .. } => None }
    }

    pub fn validate_image_file(&self, dir: &Path) -> Result<(), String> {
        if let SavedStored::ImageFile { .. } = self.stored {
            Uuid::parse_str(&self.id).map_err(|_| "队列图片 ID 必须是 UUID".to_owned())?;
            let path = dir.join(&self.id);
            if !fs::metadata(&path).map_err(|error| format!("读取队列图片 {} 失败：{error}", path.display()))?.is_file() {
                return Err(format!("队列图片 {} 必须是文件", path.display()));
            }
        }
        Ok(())
    }

    pub fn persist_image(&mut self, dir: &Path) -> Result<(), String> {
        use std::io::Write;
        use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
        if let SavedStored::Image { name, media_type, data } = &self.stored {
            Uuid::parse_str(&self.id).map_err(|_| "队列图片 ID 必须是 UUID".to_owned())?;
            let bytes = STANDARD.decode(data).map_err(|error| format!("解码队列图片失败：{error}"))?;
            fs::DirBuilder::new().recursive(true).mode(0o700).create(dir).map_err(|error| format!("创建队列图片目录失败：{error}"))?;
            let path = dir.join(&self.id);
            let temp = path.with_extension("tmp");
            let mut file = fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&temp).map_err(|error| format!("保存队列图片失败：{error}"))?;
            file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|error| format!("保存队列图片失败：{error}"))?;
            fs::rename(&temp, &path).map_err(|error| format!("保存队列图片失败：{error}"))?;
            self.stored = SavedStored::ImageFile { name: name.clone(), media_type: media_type.clone() };
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct Attachments(Mutex<HashMap<String, Stored>>);

/// What a turn sends, taken out of the store.
#[derive(Debug, Default)]
pub struct Prepared {
    images: Vec<(String, String)>,
    files: Vec<PathBuf>,
}

impl Attachments {
    fn store(&self, stored: Stored) -> Result<String, String> {
        let mut held = self.0.lock().map_err(|error| error.to_string())?;
        if held.len() >= MAX_HELD {
            return Err(format!("At most {MAX_HELD} attachments can wait to be sent"));
        }
        let id = Uuid::new_v4().to_string();
        held.insert(id.clone(), stored);
        Ok(id)
    }

    fn add_path(&self, path: &Path) -> Result<Attachment, String> {
        let path = fs::canonicalize(path).map_err(|error| format!("{}: {error}", path.display()))?;
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string());
        let metadata = fs::metadata(&path).map_err(|error| format!("{name}: {error}"))?;
        if !metadata.is_file() {
            return Err(format!("{name}: only files can be attached"));
        }
        let display = path.to_string_lossy().into_owned();
        // The path becomes a line of the prompt, so it has to stay on one line.
        if display.chars().any(char::is_control) {
            return Err(format!("{name}: this file name is not supported"));
        }
        if metadata.len() <= MAX_INLINE_IMAGE_BYTES {
            let mut head = [0; 12];
            let mut file = fs::File::open(&path).map_err(|error| format!("{name}: {error}"))?;
            let read = file.read(&mut head).map_err(|error| format!("{name}: {error}"))?;
            if let Some(media_type) = image_media_type(&head[..read]) {
                let bytes = fs::read(&path).map_err(|error| format!("{name}: {error}"))?;
                return self.add_image(name, media_type, &bytes);
            }
        }
        let id = self.store(Stored::File { name: name.clone(), path })?;
        Ok(Attachment { id, name, kind: AttachmentKind::File, path: Some(display), preview: None })
    }

    fn add_image(&self, name: String, media_type: &'static str, bytes: &[u8]) -> Result<Attachment, String> {
        let data = STANDARD.encode(bytes);
        let preview = format!("data:{media_type};base64,{data}");
        let id = self.store(Stored::Image { name: name.clone(), media_type: media_type.to_owned(), data })?;
        Ok(Attachment { id, name, kind: AttachmentKind::Image, path: None, preview: Some(preview) })
    }

    pub fn add_paths(&self, paths: &[PathBuf]) -> AddResult {
        let mut result = AddResult::default();
        for path in paths {
            match self.add_path(path) {
                Ok(attachment) => result.added.push(attachment),
                Err(error) => result.errors.push(error),
            }
        }
        result
    }

    /// Pasted images have no path, so their bytes come from the page and are checked here.
    pub fn add_pasted_image(&self, data: &str) -> Result<Attachment, String> {
        let bytes = STANDARD.decode(data).map_err(|error| error.to_string())?;
        if bytes.len() as u64 > MAX_INLINE_IMAGE_BYTES {
            return Err("The pasted image is larger than 5 MB".into());
        }
        let media_type = image_media_type(&bytes).ok_or("The pasted data is not a supported image")?;
        self.add_image("image".to_owned(), media_type, &bytes)
    }

    pub fn remove(&self, id: &str) {
        if let Ok(mut held) = self.0.lock() {
            held.remove(id);
        }
    }

    pub fn take(&self, ids: &[String]) -> Result<Prepared, String> {
        let mut held = self.0.lock().map_err(|error| error.to_string())?;
        if ids.iter().any(|id| !held.contains_key(id)) {
            return Err("附件已从草稿中移除".into());
        }
        let mut prepared = Prepared::default();
        for id in ids {
            match held.remove(id) {
                Some(Stored::Image { media_type, data, .. }) => prepared.images.push((media_type, data)),
                Some(Stored::File { path, .. }) => prepared.files.push(path),
                None => {}
            }
        }
        Ok(prepared)
    }

    /// Capture first; release the draft's ids only after the queue file has been written.
    pub fn capture(&self, ids: &[String]) -> Result<Vec<SavedAttachment>, String> {
        capture(&*self.0.lock().map_err(|error| error.to_string())?, ids)
    }

    pub fn release(&self, ids: &[String]) {
        if let Ok(mut held) = self.0.lock() {
            for id in ids { held.remove(id); }
        }
    }
}

fn capture(held: &HashMap<String, Stored>, ids: &[String]) -> Result<Vec<SavedAttachment>, String> {
    let mut seen = HashSet::new();
    ids.iter().filter(|id| seen.insert(id.as_str())).map(|id| {
        let stored = held.get(id).ok_or("附件已从草稿中移除")?;
        let stored = match stored {
            Stored::Image { name, media_type, data } => SavedStored::Image { name: name.clone(), media_type: media_type.clone(), data: data.clone() },
            Stored::File { name, path } => SavedStored::File { name: name.clone(), path: path.clone() },
        };
        Ok(SavedAttachment { id: id.clone(), stored })
    }).collect()
}

impl Prepared {
    pub fn from_saved(saved: &[SavedAttachment], image_dir: &Path) -> Result<Self, String> {
        let mut prepared = Self::default();
        for attachment in saved {
            match &attachment.stored {
                SavedStored::Image { media_type, data, .. } => prepared.images.push((media_type.clone(), data.clone())),
                SavedStored::ImageFile { media_type, .. } => {
                    let bytes = fs::read(image_dir.join(&attachment.id)).map_err(|error| format!("读取队列图片失败：{error}"))?;
                    prepared.images.push((media_type.clone(), STANDARD.encode(bytes)));
                }
                SavedStored::File { path, .. } => prepared.files.push(path.clone()),
            }
        }
        Ok(prepared)
    }
    /// The current turn keeps its own previews after the acknowledged queue files are removed.
    /// `saved` is the source used for `from_saved`, so images have the same order.
    pub fn live_attachments(&self, saved: &[SavedAttachment]) -> Vec<Attachment> {
        let mut images = self.images.iter();
        saved.iter().map(|attachment| match &attachment.stored {
            SavedStored::Image { name, .. } | SavedStored::ImageFile { name, .. } => {
                let (media_type, data) = images.next().expect("prepared images follow the saved attachments");
                Attachment {
                    id: attachment.id.clone(), name: name.clone(), kind: AttachmentKind::Image,
                    path: None, preview: Some(format!("data:{media_type};base64,{data}")),
                }
            }
            SavedStored::File { name, path } => Attachment {
                id: attachment.id.clone(), name: name.clone(), kind: AttachmentKind::File,
                path: Some(path.to_string_lossy().into_owned()), preview: None,
            },
        }).collect()
    }
    /// Images come first, the order the API recommends, and files are named in the text.
    pub fn content(&self, prompt: &str) -> Vec<Value> {
        let mut content: Vec<Value> = self
            .images
            .iter()
            .map(|(media_type, data)| {
                json!({"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}})
            })
            .collect();
        let lines: Vec<String> = self
            .files
            .iter()
            .map(|path| format!("{ATTACHED_FILE_PREFIX}{}", path.display()))
            .collect();
        let text = match (prompt.trim().is_empty(), lines.is_empty()) {
            (true, true) => None,
            (false, true) => Some(prompt.to_owned()),
            (true, false) => Some(lines.join("\n")),
            (false, false) => Some(format!("{}\n\n{}", prompt.trim_end(), lines.join("\n"))),
        };
        if let Some(text) = text {
            content.push(json!({"type": "text", "text": text}));
        }
        content
    }

    /// The same content in Codex's input format, where an image is a data URL.
    pub fn codex_input(&self, prompt: &str) -> Vec<Value> {
        self.content(prompt)
            .into_iter()
            .map(|block| {
                let Some(source) = block.get("source") else {
                    return json!({"type": "text", "text": block["text"]});
                };
                let url = format!(
                    "data:{};base64,{}",
                    source["media_type"].as_str().unwrap_or_default(),
                    source["data"].as_str().unwrap_or_default()
                );
                json!({"type": "image", "url": url})
            })
            .collect()
    }

    /// Attaching a file means the agent may read that one file, wherever it is. Nothing nearby
    /// is opened up. A path that a rule could not name exactly gets the normal permission prompt.
    pub fn read_rules(&self) -> Vec<String> {
        self.files.iter().filter_map(|path| read_rule(path)).collect()
    }
}

fn read_rule(path: &Path) -> Option<String> {
    let path = path.to_str()?;
    let is_exact = !path.contains(['*', '?', '[', ']', '{', '}', '!', '\\', ',']);
    is_exact.then(|| format!("Read(/{path})"))
}

pub(crate) fn image_media_type(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => Some("image/png"),
        [0xFF, 0xD8, 0xFF, ..] => Some("image/jpeg"),
        [b'G', b'I', b'F', b'8', ..] => Some("image/gif"),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => Some("image/webp"),
        _ => None,
    }
}

pub fn is_inline_media_type(media_type: &str) -> bool {
    matches!(media_type, "image/png" | "image/jpeg" | "image/gif" | "image/webp")
}

/// Reads dropped files away from the window's event loop.
pub fn add_and_announce(app: AppHandle, paths: Vec<PathBuf>) {
    tauri::async_runtime::spawn_blocking(move || {
        let result = app.state::<Attachments>().add_paths(&paths);
        let _ = app.emit(DROPPED_EVENT, result);
    });
}

pub fn on_drag(app: &AppHandle, event: &DragDropEvent) {
    match event {
        DragDropEvent::Enter { .. } => {
            let _ = app.emit(DRAG_EVENT, true);
        }
        DragDropEvent::Leave => {
            let _ = app.emit(DRAG_EVENT, false);
        }
        DragDropEvent::Drop { paths, .. } => {
            let _ = app.emit(DRAG_EVENT, false);
            add_and_announce(app.clone(), paths.clone());
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_images_require_a_raster_extension_header_regular_file_and_bounded_size() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("image.PNG");
        fs::write(&path, b"\x89PNG\r\n\x1a\nimage").unwrap();
        assert!(read_native_image(&path).unwrap().starts_with("data:image/png;base64,"));
        let text = dir.path().join("secret.png");
        fs::write(&text, "private configuration").unwrap();
        assert_eq!(read_native_image(&text), Err("unsupported"));
        let svg = dir.path().join("image.svg");
        fs::write(&svg, "<svg/>").unwrap();
        assert_eq!(read_native_image(&svg), Err("unsupported"));
        fs::File::create(&path).unwrap().set_len(MAX_INLINE_IMAGE_BYTES + 1).unwrap();
        assert_eq!(read_native_image(&path), Err("tooLarge"));
        fs::remove_file(&path).unwrap();
        assert_eq!(read_native_image(&path), Err("missing"));
        fs::create_dir(&path).unwrap();
        assert_eq!(read_native_image(&path), Err("unsupported"));
    }

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 13, 10, 26, 10];

    #[test]
    fn images_are_inlined_and_other_files_go_by_path() {
        let dir = tempfile::tempdir().unwrap();
        let image = dir.path().join("shot.dat");
        fs::write(&image, PNG).unwrap();
        let log = dir.path().join("app (1).log");
        fs::write(&log, "line").unwrap();
        let store = Attachments::default();
        let result = store.add_paths(&[image, log]);
        assert!(result.errors.is_empty());
        assert_eq!(result.added[0].kind, AttachmentKind::Image);
        assert!(result.added[0].preview.as_deref().unwrap().starts_with("data:image/png;base64,"));
        assert_eq!(result.added[1].kind, AttachmentKind::File);

        let ids: Vec<String> = result.added.iter().map(|a| a.id.clone()).collect();
        let prepared = store.take(&ids).unwrap();
        let content = prepared.content("look");
        assert_eq!(content[0]["source"]["media_type"], "image/png");
        let text = content[1]["text"].as_str().unwrap();
        assert!(text.starts_with("look\n\nAttached file, readable with your tools even outside the workspace: /"));
        assert!(text.ends_with("app (1).log"));
        assert_eq!(prepared.read_rules().len(), 1);
        assert!(prepared.read_rules()[0].starts_with("Read(//"));
    }

    #[test]
    fn taking_needs_every_id_and_uses_each_once() {
        let store = Attachments::default();
        let id = store.add_pasted_image(&STANDARD.encode(PNG)).unwrap().id;
        assert!(store.take(&[id.clone(), "missing".into()]).is_err());
        assert_eq!(store.take(&[id.clone(), id.clone()]).unwrap().content("").len(), 1);
        assert!(store.take(&[id]).is_err());
    }

    #[test]
    fn refuses_folders_and_pasted_data_that_is_not_an_image() {
        let dir = tempfile::tempdir().unwrap();
        let store = Attachments::default();
        assert_eq!(store.add_paths(&[dir.path().to_owned()]).errors.len(), 1);
        assert!(store.add_pasted_image(&STANDARD.encode("<svg/>")).is_err());
    }

    #[test]
    fn an_oversized_image_file_goes_by_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("big.png");
        let mut bytes = PNG.to_vec();
        bytes.resize(MAX_INLINE_IMAGE_BYTES as usize + 1, 0);
        fs::write(&path, bytes).unwrap();
        let result = Attachments::default().add_paths(&[path]);
        assert_eq!(result.added[0].kind, AttachmentKind::File);
    }

    #[test]
    fn a_path_a_rule_cannot_name_exactly_gets_no_rule() {
        assert_eq!(read_rule(Path::new("/a/app (1).log")).unwrap(), "Read(//a/app (1).log)");
        for path in ["/a/*.log", "/a/b,c.log", "/a/[x].log"] {
            assert!(read_rule(Path::new(path)).is_none(), "{path}");
        }
    }

    #[test]
    fn a_held_count_limit_bounds_memory() {
        let store = Attachments::default();
        let data = STANDARD.encode(PNG);
        for _ in 0..MAX_HELD {
            store.add_pasted_image(&data).unwrap();
        }
        assert!(store.add_pasted_image(&data).is_err());
    }
}

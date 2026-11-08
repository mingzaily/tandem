//! Codex App pastes images as temporary files, which macOS cleans up. The rollout keeps the
//! same image as the data URL that went to the model, right after an `<image … path="…">` marker.

use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::sync::{Mutex, OnceLock};

/// A data URL carries at most the inline image limit, base64 encoded, plus its header.
const MAX_URL_LEN: usize = (crate::attachments::MAX_INLINE_IMAGE_BYTES as usize).div_ceil(3) * 4 + 64;
const CACHE_LIMIT: usize = 64;

/// A rollout can be hundreds of megabytes, so each missing path is looked up once per run.
fn cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

pub fn is_plain_image_url(url: &str) -> bool {
    url.len() <= MAX_URL_LEN
        && ["png", "jpeg", "gif", "webp"].iter().any(|kind| url.starts_with(&format!("data:image/{kind};base64,")))
}

/// Images whose local file is gone, recovered from the rollout where it has them.
pub fn for_missing<'a>(items: impl Iterator<Item = &'a Value>, rollout: Option<&Path>) -> HashMap<String, String> {
    let missing: HashSet<String> = items
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("userMessage"))
        .filter_map(|item| item.get("content").and_then(Value::as_array))
        .flatten()
        .filter(|part| part.get("type").and_then(Value::as_str) == Some("localImage"))
        .filter_map(|part| part.get("path").and_then(Value::as_str))
        .filter(|path| !Path::new(path).exists())
        .map(str::to_owned)
        .collect();
    let Some(rollout) = rollout.filter(|_| !missing.is_empty()) else { return HashMap::new() };
    let mut cache = cache().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let unknown: HashSet<String> = missing.iter().filter(|path| !cache.contains_key(*path)).cloned().collect();
    if !unknown.is_empty() {
        let mut found = scan(rollout, &unknown);
        if cache.len() + unknown.len() > CACHE_LIMIT { cache.clear(); }
        for path in unknown { let url = found.remove(&path); cache.insert(path, url); }
    }
    missing.into_iter().filter_map(|path| Some((path.clone(), cache.get(&path)?.clone()?))).collect()
}

fn scan(rollout: &Path, wanted: &HashSet<String>) -> HashMap<String, String> {
    let mut found = HashMap::new();
    let Ok(file) = std::fs::File::open(rollout) else { return found };
    let mut reader = BufReader::new(file);
    let mut line = Vec::new();
    while found.len() < wanted.len() {
        line.clear();
        if !matches!(reader.read_until(b'\n', &mut line), Ok(read) if read > 0) { break; }
        let Ok(text) = std::str::from_utf8(&line) else { continue };
        if !text.contains("<image name=") || !text.contains("\"input_image\"") { continue; }
        let Ok(value) = serde_json::from_str::<Value>(text) else { continue };
        let Some(parts) = value.pointer("/payload/content").and_then(Value::as_array) else { continue };
        let mut marker: Option<&str> = None;
        for part in parts {
            match part.get("type").and_then(Value::as_str) {
                Some("input_text") => marker = part.get("text").and_then(Value::as_str).and_then(marker_path),
                Some("input_image") => {
                    let url = part.get("image_url").and_then(Value::as_str).filter(|url| is_plain_image_url(url));
                    if let (Some(path), Some(url)) = (marker.take(), url) {
                        if wanted.contains(path) { found.insert(path.to_owned(), url.to_owned()); }
                    }
                }
                _ => marker = None,
            }
        }
    }
    found
}

/// `<image name=[Image #1] path="/tmp/x.png">` → `/tmp/x.png`
fn marker_path(text: &str) -> Option<&str> {
    let rest = text.strip_prefix("<image name=")?;
    let start = rest.find(" path=\"")? + " path=\"".len();
    let end = rest[start..].find('"')?;
    Some(&rest[start..start + end])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_missing_pasted_image_comes_back_from_the_rollout() {
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("codex-clipboard-gone.png").to_string_lossy().into_owned();
        let other = dir.path().join("other.png").to_string_lossy().into_owned();
        let record = |path: &str, url: &str| json!({"type": "response_item", "payload": {"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": format!("<image name=[Image #1] path=\"{path}\">")},
            {"type": "input_image", "image_url": url},
            {"type": "input_text", "text": "</image>"},
        ]}}).to_string();
        let rollout = dir.path().join("rollout.jsonl");
        std::fs::write(&rollout, [record(&other, "data:image/png;base64,BB"), "not json".into(), record(&gone, "data:image/png;base64,AA")].join("\n")).unwrap();
        let item = json!({"type": "userMessage", "content": [{"type": "localImage", "path": gone}]});
        let found = for_missing([&item].into_iter(), Some(&rollout));
        assert_eq!(found.get(&gone).map(String::as_str), Some("data:image/png;base64,AA"));
        assert_eq!(found.len(), 1);
        // The answer is remembered, so a later read does not scan the file again.
        std::fs::remove_file(&rollout).unwrap();
        assert_eq!(for_missing([&item].into_iter(), Some(&rollout)).get(&gone).map(String::as_str), Some("data:image/png;base64,AA"));
    }

    #[test]
    fn only_plain_bounded_images_are_recovered() {
        assert!(is_plain_image_url("data:image/webp;base64,AA"));
        assert!(!is_plain_image_url("data:image/svg+xml;base64,AA"));
        assert!(!is_plain_image_url(&format!("data:image/png;base64,{}", "A".repeat(MAX_URL_LEN))));
        assert_eq!(marker_path("<image name=[Image #2] path=\"/a b/c.png\">"), Some("/a b/c.png"));
        assert_eq!(marker_path("</image>"), None);
    }
}

//! Read native title metadata backwards; later conversation output never expires a saved name.

use serde::Deserialize;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

const BLOCK_BYTES: usize = 64 * 1024;

#[derive(Deserialize)]
struct Metadata {
    #[serde(rename = "type")]
    kind: String,
    name: Option<String>,
    #[serde(rename = "customTitle")]
    custom: Option<String>,
    #[serde(rename = "aiTitle")]
    generated: Option<String>,
}

fn metadata(line: &[u8]) -> Option<Metadata> {
    let text = std::str::from_utf8(line).ok()?;
    if !["\"session_info\"", "\"custom-title\"", "\"ai-title\""]
        .iter()
        .any(|kind| text.contains(kind))
    {
        return None;
    }
    serde_json::from_str(text).ok()
}

/// Pi's latest name can explicitly clear an older title.
pub fn pi(path: &Path) -> Option<String> {
    find_last(path, |line| {
        let entry = metadata(line)?;
        (entry.kind == "session_info").then(|| {
            entry
                .name
                .map(|name| name.trim().to_owned())
                .filter(|name| !name.is_empty())
        })
    })
    .ok()?
    .flatten()
}

pub fn claude(path: &Path) -> Option<String> {
    let mut custom = None;
    let mut generated = None;
    find_last(path, |line| {
        let entry = metadata(line)?;
        match entry.kind.as_str() {
            "custom-title" if custom.is_none() => custom = Some(entry.custom),
            "ai-title" if generated.is_none() => generated = Some(entry.generated),
            _ => {}
        }
        match &custom {
            Some(Some(title)) => Some(Some(title.clone())),
            Some(None) if generated.is_some() => Some(None),
            _ => None,
        }
    })
    .ok()?;
    custom.flatten().or_else(|| generated.flatten())
}

/// Keeps one block and the current split line, and stops as soon as the selector resolves a title.
fn find_last<T>(path: &Path, mut select: impl FnMut(&[u8]) -> Option<T>) -> io::Result<Option<T>> {
    let mut file = File::open(path)?;
    let mut end = file.metadata()?.len();
    let mut block = vec![0; BLOCK_BYTES];
    let mut split_line = Vec::new();
    while end > 0 {
        let start = end.saturating_sub(BLOCK_BYTES as u64);
        let length = (end - start) as usize;
        file.seek(SeekFrom::Start(start))?;
        file.read_exact(&mut block[..length])?;
        let mut line_end = length;
        for boundary in (0..length).rev().filter(|index| block[*index] == b'\n') {
            let fragment = &block[boundary + 1..line_end];
            let found = if split_line.is_empty() {
                select(fragment)
            } else {
                split_line.extend(fragment.iter().rev());
                split_line.reverse();
                let found = select(&split_line);
                split_line.clear();
                found
            };
            if found.is_some() {
                return Ok(found);
            }
            line_end = boundary;
        }
        // Reverse fragments append in linear time even for a multi-megabyte image or tool result.
        split_line.extend(block[..line_end].iter().rev());
        end = start;
    }
    split_line.reverse();
    Ok(select(&split_line))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_complete_lines_across_blocks_with_crlf_and_a_long_final_line() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        let long = "文".repeat(BLOCK_BYTES);
        std::fs::write(&path, format!("first\r\n\r\n{long}")).unwrap();
        let mut lines = Vec::new();
        find_last::<()>(&path, |line| {
            lines.push(String::from_utf8(line.to_owned()).unwrap());
            None
        })
        .unwrap();
        assert_eq!(lines, [long, "\r".into(), "first\r".into()]);
    }

    #[test]
    fn title_records_and_utf8_can_cross_block_boundaries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        let title = json!({"type":"session_info", "name":"标题更新后保持一致"}).to_string();
        let overhead = json!({"type":"message", "message":{"content":""}})
            .to_string()
            .len();
        for boundary in [1, title.find('标').unwrap() + 1, title.len() - 1] {
            let padding = BLOCK_BYTES + boundary - title.len() - overhead - 2;
            let message = json!({"type":"message", "message":{"content":"x".repeat(padding)}});
            std::fs::write(&path, format!("{title}\n{message}\n")).unwrap();
            assert_eq!(pi(&path).as_deref(), Some("标题更新后保持一致"));
        }
    }

    #[test]
    fn ignores_nested_metadata_and_an_incomplete_final_record() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        let title = json!({"type":"session_info", "name":"Saved"});
        let tool =
            json!({"type":"message", "result":{"type":"session_info", "name":"Tool output"}});
        std::fs::write(
            &path,
            format!("{title}\n{tool}\n{{\"type\":\"session_info\",\"name\":\"partial"),
        )
        .unwrap();
        assert_eq!(pi(&path).as_deref(), Some("Saved"));
    }

    #[test]
    fn claude_uses_the_latest_title_of_each_kind_and_respects_an_explicit_clear() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        let lines = [
            json!({"type":"ai-title", "aiTitle":"Old generated"}),
            json!({"type":"custom-title", "customTitle":"Old custom"}),
            json!({"type":"custom-title", "customTitle":"Latest custom"}),
            json!({"type":"ai-title", "aiTitle":"Latest generated"}),
        ];
        let text = lines
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(&path, &text).unwrap();
        assert_eq!(claude(&path).as_deref(), Some("Latest custom"));
        std::fs::write(
            &path,
            format!("{text}\n{{\"type\":\"custom-title\",\"customTitle\":null}}\n"),
        )
        .unwrap();
        assert_eq!(claude(&path).as_deref(), Some("Latest generated"));
    }
}

//! Native Codex archive operations own rollout movement and index changes.

use super::{Conn, Value, json};
use std::path::PathBuf;

pub(super) fn path_state(path: &str) -> Result<bool, String> {
    path.split(['/', '\\']).rev().skip(1).find_map(|part| match part {
        "archived_sessions" => Some(true), "sessions" => Some(false), _ => None,
    }).ok_or_else(|| "Codex 没有返回有效的原生会话位置".to_owned())
}

fn thread_state(result: &Value, id: &str) -> Result<(bool, PathBuf), String> {
    let thread = result.get("thread").ok_or("Codex 没有返回任务")?;
    if thread.get("id").and_then(Value::as_str) != Some(id) { return Err("Codex 返回的任务 ID 不一致".into()); }
    let path = thread.get("path").and_then(Value::as_str).filter(|path| !path.is_empty()).ok_or("Codex 任务尚未保存会话记录")?;
    Ok((path_state(path)?, PathBuf::from(path)))
}

pub(super) async fn set_state(conn: &mut Conn, id: &str, archived: bool) -> Result<PathBuf, String> {
    let read = json!({"threadId": id, "includeTurns": false});
    let before = conn.call("thread/read", read.clone()).await?;
    let (current, path) = thread_state(&before, id)?;
    if current == archived { return Ok(path); }
    if before.pointer("/thread/status/type").and_then(Value::as_str) == Some("active") {
        return Err("Codex 任务正在运行，请结束当前工作后再整理".into());
    }
    conn.call(if archived { "thread/archive" } else { "thread/unarchive" }, json!({"threadId": id})).await?;
    let after = conn.call("thread/read", read).await?;
    let (current, path) = thread_state(&after, id)?;
    if current != archived { return Err("Codex 归档状态尚未确认，请刷新后重试".into()); }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::{Reader, ReaderState};
    use std::process::Stdio;
    use std::sync::Arc;
    use tokio::{io::{AsyncBufReadExt, BufReader}, process::Command, sync::Mutex};

    const ID: &str = "00000000-0000-0000-0000-000000000001";
    fn thread(archived: bool, busy: bool) -> Value {
        json!({"thread":{"id":ID,"path":if archived { "/data/archived_sessions/task.jsonl" } else { "/data/sessions/2026/task.jsonl" },"status":{"type":if busy { "active" } else { "notLoaded" }}}})
    }
    fn fake(replies: Vec<Value>) -> (Conn, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let mut script = String::new();
        for (index, mut reply) in replies.into_iter().enumerate() {
            reply["id"] = json!(index + 1);
            let line = reply.to_string().replace('\'', "'\\''");
            script.push_str(&format!("IFS= read -r line || exit 1\nprintf '%s\\n' \"$line\" >> \"$1\"\nprintf '%s\\n' '{line}'\n"));
        }
        let mut child = Command::new("sh").arg("-c").arg(script).arg("archive-fixture").arg(dir.path().join("requests.jsonl"))
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true).spawn().unwrap();
        let stdin = child.stdin.take().unwrap();
        let lines = BufReader::new(child.stdout.take().unwrap()).lines();
        (Conn { child, stdin, lines, next_id: 1 }, dir)
    }
    fn requests(dir: &tempfile::TempDir) -> Vec<Value> {
        std::fs::read_to_string(dir.path().join("requests.jsonl")).unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).collect()
    }

    #[tokio::test]
    async fn archive_and_restore_use_official_requests_and_update_cached_native_paths() {
        let (conn, dir) = fake(vec![json!({"result":thread(false,false)}), json!({"result":{}}), json!({"result":thread(true,false)}),
            json!({"result":thread(true,false)}), json!({"result":{}}), json!({"result":thread(false,false)})]);
        let reader = Reader(Arc::new(Mutex::new(ReaderState { conn: Some(conn), ..Default::default() })));
        reader.set_archived(ID, true).await.unwrap();
        assert_eq!(reader.task_file(ID).await.unwrap(), PathBuf::from("/data/archived_sessions/task.jsonl"));
        reader.set_archived(ID, false).await.unwrap();
        assert_eq!(reader.task_file(ID).await.unwrap(), PathBuf::from("/data/sessions/2026/task.jsonl"));
        let calls = requests(&dir);
        assert_eq!(calls.iter().map(|call| call["method"].as_str().unwrap()).collect::<Vec<_>>(), ["thread/read", "thread/archive", "thread/read", "thread/read", "thread/unarchive", "thread/read"]);
        for call in calls {
            assert_eq!(call["params"]["threadId"], ID);
            assert!(call["params"].get("sandbox").is_none());
            assert!(call["params"].get("config").is_none());
        }
    }

    #[tokio::test]
    async fn reading_archived_history_refreshes_its_native_path_without_restoring_it() {
        let (conn, dir) = fake(vec![json!({"result":thread(true,false)}), json!({"result":{"data":[],"nextCursor":null}})]);
        let reader = Reader(Arc::new(Mutex::new(ReaderState { conn: Some(conn), ..Default::default() })));
        assert!(reader.read_task(ID).await.unwrap().messages.is_empty());
        assert_eq!(reader.task_file(ID).await.unwrap(), PathBuf::from("/data/archived_sessions/task.jsonl"));
        assert_eq!(requests(&dir).iter().map(|call| call["method"].as_str().unwrap()).collect::<Vec<_>>(), ["thread/read", "thread/turns/list"]);
    }

    #[tokio::test]
    async fn an_already_matching_state_is_confirmed_without_another_write() {
        for archived in [false, true] {
            let (mut conn, dir) = fake(vec![json!({"result":thread(archived,false)})]);
            set_state(&mut conn, ID, archived).await.unwrap();
            assert_eq!(requests(&dir).len(), 1);
        }
    }

    #[tokio::test]
    async fn a_busy_thread_is_kept_in_its_current_bucket() {
        let (mut conn, dir) = fake(vec![json!({"result":thread(false,true)})]);
        assert!(set_state(&mut conn, ID, true).await.unwrap_err().contains("正在运行"));
        assert_eq!(requests(&dir).len(), 1);
    }

    #[tokio::test]
    async fn a_native_failure_stops_before_the_confirmation_read() {
        let (mut conn, dir) = fake(vec![json!({"result":thread(false,false)}), json!({"error":{"code":-32000,"message":"archive denied"}})]);
        assert!(set_state(&mut conn, ID, true).await.unwrap_err().contains("archive denied"));
        assert_eq!(requests(&dir).len(), 2);
    }

    #[tokio::test]
    async fn a_success_reply_is_checked_against_the_native_bucket() {
        let (mut conn, dir) = fake(vec![json!({"result":thread(false,false)}), json!({"result":{}}), json!({"result":thread(false,false)})]);
        assert!(set_state(&mut conn, ID, true).await.unwrap_err().contains("尚未确认"));
        assert_eq!(requests(&dir).len(), 3);
    }

    #[tokio::test]
    async fn native_lists_page_each_bucket_with_the_same_project_and_source_filters() {
        let (conn, dir) = fake(vec![json!({"result":{"data":[{"id":"a"}],"nextCursor":"page2"}}), json!({"result":{"data":[{"id":"b"}],"nextCursor":null}}),
            json!({"result":{"data":[{"id":"c"}],"nextCursor":null}})]);
        let reader = Reader(Arc::new(Mutex::new(ReaderState { conn: Some(conn), ..Default::default() })));
        let roots = ["/project".to_owned()];
        assert_eq!(reader.list_threads(Some(&roots), false).await.unwrap().len(), 2);
        assert_eq!(reader.list_threads(Some(&roots), true).await.unwrap().len(), 1);
        let calls = requests(&dir);
        assert_eq!(calls[1]["params"]["cursor"], "page2");
        assert_eq!(calls[0]["params"]["archived"], false);
        assert_eq!(calls[2]["params"]["archived"], true);
        for call in calls { assert_eq!(call["params"]["cwd"], json!(roots)); assert_eq!(call["params"]["useStateDbOnly"], true); }
    }

    #[test]
    fn recognizes_native_archive_buckets_and_preserves_complete_path_boundaries() {
        assert!(!path_state("/home/.codex/sessions/2026/11/rollout.jsonl").unwrap());
        assert!(path_state("/home/.codex/archived_sessions/rollout.jsonl").unwrap());
        assert!(path_state("C:\\user\\.codex\\archived_sessions\\rollout.jsonl").unwrap());
        assert!(path_state("/home/old_sessions/rollout.jsonl").is_err());
    }
    #[test]
    fn requires_the_requested_thread_and_a_durable_native_location() {
        let task = json!({"thread": {"id":"one", "path":"/data/archived_sessions/one.jsonl"}});
        assert_eq!(thread_state(&task, "one").unwrap(), (true, PathBuf::from("/data/archived_sessions/one.jsonl")));
        assert!(thread_state(&task, "other").is_err());
        assert!(thread_state(&json!({"thread":{"id":"one", "path":null}}), "one").is_err());
    }
}

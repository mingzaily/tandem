//! A Claude turn with background tasks, against a fake CLI in its own login environment.
use super::*;
use std::os::unix::fs::PermissionsExt;

/// Answers, leaves a background task running, takes one added message while idle, then lets the
/// task finish. It checks that Tandem closes input only after the task is gone.
const FAKE_CLAUDE: &str = r#"#!/usr/bin/python3
import json, sys, select
task = sys.argv[sys.argv.index('--session-id') + 1]
def out(value): print(json.dumps(value), flush=True)
def answer(message, text):
    out({'type':'user','isReplay':True,'session_id':task,'parent_tool_use_id':None,'message':message})
    out({'type':'assistant','parent_tool_use_id':None,'message':{'id':text,'content':[{'type':'text','text':text}]}})
    out({'type':'result','is_error':False,'subtype':'success','result':text,'session_id':task})
first = json.loads(sys.stdin.readline())
out({'type':'system','subtype':'background_tasks_changed','tasks':[{'task_id':'t1'}]})
answer(first['message'], 'started')
ready, _, _ = select.select([sys.stdin], [], [], 5)
if not ready: sys.exit(3)
added = sys.stdin.readline()
if not added: sys.exit(4)
answer(json.loads(added)['message'], 'took the added message')
out({'type':'system','subtype':'background_tasks_changed','tasks':[]})
ready, _, _ = select.select([sys.stdin], [], [], 5)
if not ready or sys.stdin.readline() != '': sys.exit(5)
out({'type':'assistant','parent_tool_use_id':None,'message':{'id':'follow','content':[{'type':'text','text':'task done'}]}})
out({'type':'result','is_error':False,'subtype':'success','result':'task done','session_id':task})
"#;

#[test]
fn background_tasks_keep_the_turn_open_and_take_added_messages() {
    if std::env::var_os("TANDEM_BACKGROUND_CASE").is_some() {
        return exercise();
    }
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let (bin, zdot, cwd) = (root.join("bin"), root.join("zdot"), root.join("project"));
    for folder in [&bin, &zdot, &cwd] {
        std::fs::create_dir(folder).unwrap();
    }
    std::fs::write(bin.join("claude"), FAKE_CLAUDE).unwrap();
    std::fs::set_permissions(bin.join("claude"), std::fs::Permissions::from_mode(0o700)).unwrap();
    let path = format!("export PATH='{}:/usr/bin:/bin'\n", bin.display());
    std::fs::write(zdot.join(".zshrc"), &path).unwrap();
    std::fs::write(zdot.join(".zlogin"), path).unwrap();
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "runner::background_tests::background_tasks_keep_the_turn_open_and_take_added_messages", "--nocapture"])
        .env("TANDEM_BACKGROUND_CASE", "1")
        .env("TANDEM_BACKGROUND_CWD", &cwd)
        .env("CLAUDE_CONFIG_DIR", root.join("claude"))
        .env("ZDOTDIR", zdot)
        .env("SHELL", "/bin/zsh")
        .output()
        .unwrap();
    assert!(output.status.success(), "{}\n{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
}

fn exercise() {
    let cwd = std::env::var("TANDEM_BACKGROUND_CWD").unwrap();
    let events = Arc::new(Mutex::new(Vec::<TurnEvent>::new()));
    let seen = events.clone();
    let sink = TurnSink::new(move |event| {
        seen.lock().unwrap().push(event);
        Ok(())
    });
    let runs = Arc::new(Runs::default());
    let turn = runs.clone();
    let watched = events.clone();
    tauri::async_runtime::block_on(async move {
        let events = watched;
        let send = tauri::async_runtime::spawn(async move {
            send_turn(&turn, None, Some(cwd), "go".into(), Prepared::default(), TurnOptions::default(), sink).await
        });
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        let task_id = loop {
            assert!(std::time::Instant::now() < deadline, "no idle wait after the first result: {:?}", events.lock().unwrap());
            let idle = events.lock().unwrap().contains(&TurnEvent::Background { tasks: 1, idle: true });
            if idle {
                break events.lock().unwrap().iter().find_map(|event| match event {
                    TurnEvent::Started { task_id } => Some(task_id.clone()),
                    _ => None,
                }).unwrap();
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        };
        assert!(!events.lock().unwrap().iter().any(|event| matches!(event, TurnEvent::Finished { .. })), "the first result must not end the turn");
        assert!(runs.can_steer(&task_id), "an idle agent takes messages");
        runs.steer(&task_id, user_input_line("more", &Prepared::default())).unwrap();
        tokio::time::timeout(Duration::from_secs(10), send).await.unwrap().unwrap().unwrap();
    });
    let events = events.lock().unwrap();
    let finished: Vec<_> = events.iter().filter(|event| matches!(event, TurnEvent::Finished { .. })).collect();
    assert_eq!(finished, [&TurnEvent::Finished { is_error: false, cancelled: false, message: None }]);
    assert!(matches!(events.last(), Some(TurnEvent::Finished { .. })));
    let background: Vec<_> = events.iter().filter_map(|event| match event {
        TurnEvent::Background { tasks, idle } => Some((*tasks, *idle)),
        _ => None,
    }).collect();
    assert_eq!(background, [(1, false), (1, true), (1, false), (1, true), (0, false)]);
}

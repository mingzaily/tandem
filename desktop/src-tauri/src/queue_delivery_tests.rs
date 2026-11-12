//! Each subprocess owns its login environment and CLI fixtures; tests never mutate the parent env.
use super::*;
use serde_json::json;
use std::os::unix::fs::PermissionsExt;

const FAKE_CLI: &str = r#"#!/usr/bin/python3
import json, os, pathlib, sys
agent = pathlib.Path(sys.argv[0]).name
mode = os.environ['TANDEM_QUEUE_DELIVERY_CASE']
task = os.environ['TANDEM_QUEUE_TASK']
def out(value): print(json.dumps(value), flush=True)
for line in sys.stdin:
    q = json.loads(line)
    if agent == 'codex':
        method = q.get('method')
        if method == 'initialize': out({'id':q['id'], 'result':{}})
        elif method == 'thread/resume':
            assert q['params']['sandbox'] == 'read-only'
            out({'id':q['id'], 'result':{'thread':{'id':task}, 'model':'audit'}})
        elif method == 'turn/start':
            if mode == 'exit-before-ack': sys.exit(9)
            if mode == 'reject': out({'id':q['id'], 'error':{'code':-1, 'message':'prompt rejected'}})
            elif mode == 'notification-first':
                out({'method':'turn/started','params':{'threadId':task,'turn':{'id':'turn-1','status':'inProgress'}}})
                sys.exit(9)
            else:
                out({'id':q['id'], 'result':{'turn':{'id':'turn-1'}}})
                status = 'completed' if mode == 'accepted-success' else 'failed'
                out({'method':'turn/completed','params':{'threadId':task,'turn':{'id':'turn-1','status':status,'error':{'message':'provider failed'}}}})
    elif agent == 'pi':
        if q['type'] == 'get_state': out({'type':'response','id':'state','success':True,'data':{}})
        elif q['type'] == 'prompt':
            if mode == 'exit-before-ack': sys.exit(9)
            out({'type':'response','id':'prompt','command':'prompt','success':mode != 'reject','error':'prompt rejected','data':{'disposition':'started'}})
            if mode == 'accepted-retry-success':
                out({'type':'message_end','message':{'role':'assistant','stopReason':'error','errorMessage':'input_image image_url must be valid base64'}})
                out({'type':'message_end','message':{'role':'assistant','stopReason':'toolUse','content':[],'usage':{'output':4}}})
                out({'type':'message_end','message':{'role':'assistant','stopReason':'stop','content':[],'usage':{'output':1}}})
            if mode == 'accepted-request-error':
                out({'type':'message_end','message':{'role':'assistant','stopReason':'error','errorMessage':'terminal image failure'}})
            if mode in ['accepted-success','accepted-retry-success','accepted-request-error']:
                out({'type':'agent_settled','aborted':False})
            sys.exit(0)
    elif q.get('type') == 'user':
        if mode == 'exit-before-ack':
            out({'type':'system','subtype':'init','session_id':task})
            sys.exit(9)
        if mode != 'reject':
            assert '--replay-user-messages' in sys.argv
            out({'type':'user','isReplay':True,'session_id':task,'parent_tool_use_id':None,'message':q['message']})
        out({'type':'result','is_error':mode != 'accepted-success','subtype':'success' if mode == 'accepted-success' else 'error_during_execution','result':'provider failed','session_id':task})
        sys.exit(0)
"#;

#[test]
fn cli_receipts_control_queue_retention() {
    if let Ok(mode) = std::env::var("TANDEM_QUEUE_DELIVERY_CASE") {
        exercise_cli(&mode);
        return;
    }
    let mut failures = Vec::new();
    for agent in ["claude", "codex", "pi"] {
        let cases = [
            "spawn-failure",
            "exit-before-ack",
            "reject",
            "accepted-error",
            "accepted-success",
        ];
        for mode in cases
            .into_iter()
            .chain((agent == "codex").then_some("notification-first"))
            .chain((agent == "claude").then_some("writer-blocked"))
            .chain((agent == "pi").then_some("accepted-retry-success"))
            .chain((agent == "pi").then_some("accepted-request-error"))
        {
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path();
            let bin = root.join("bin");
            let zdot = root.join("zdot");
            fs::create_dir(&bin).unwrap();
            fs::create_dir(&zdot).unwrap();
            let cli = bin.join(agent);
            fs::write(
                &cli,
                if mode == "spawn-failure" {
                    "#!/missing-tandem-test-interpreter\n"
                } else {
                    FAKE_CLI
                },
            )
            .unwrap();
            fs::set_permissions(&cli, fs::Permissions::from_mode(0o700)).unwrap();
            let path = format!("export PATH='{}:/usr/bin:/bin'\n", bin.display());
            fs::write(zdot.join(".zshrc"), &path).unwrap();
            fs::write(zdot.join(".zlogin"), path).unwrap();
            let task = Uuid::new_v4().to_string();
            let cwd = root.join("project");
            fs::create_dir(&cwd).unwrap();
            let claude = root.join("claude/projects/test");
            let pi = root.join("pi/sessions/test");
            fs::create_dir_all(&claude).unwrap();
            fs::create_dir_all(&pi).unwrap();
            fs::write(claude.join(format!("{task}.jsonl")), format!("{}\n", json!({"type":"user","cwd":cwd,"sessionId":task,"message":{"role":"user","content":"seed"}}))).unwrap();
            fs::write(
                pi.join(format!("{task}.jsonl")),
                format!("{}\n", json!({"type":"session","cwd":cwd,"id":task})),
            )
            .unwrap();
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "queue::delivery_tests::cli_receipts_control_queue_retention",
                    "--nocapture",
                ])
                .env("TANDEM_QUEUE_DELIVERY_CASE", mode)
                .env("TANDEM_QUEUE_AGENT", agent)
                .env("TANDEM_QUEUE_TEST_ROOT", root)
                .env("TANDEM_QUEUE_TASK", &task)
                .env("CLAUDE_CONFIG_DIR", root.join("claude"))
                .env("CODEX_HOME", root.join("codex"))
                .env("PI_CODING_AGENT_DIR", root.join("pi"))
                .env("ZDOTDIR", zdot)
                .env("SHELL", "/bin/zsh")
                .output()
                .unwrap();
            if !output.status.success() {
                failures.push(format!(
                    "{agent}/{mode}:\n{}\n{}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                ));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

fn exercise_cli(mode: &str) {
    let root = PathBuf::from(std::env::var_os("TANDEM_QUEUE_TEST_ROOT").unwrap());
    let id = std::env::var("TANDEM_QUEUE_TASK").unwrap();
    let agent = match std::env::var("TANDEM_QUEUE_AGENT").unwrap().as_str() {
        "claude" => Agent::Claude,
        "codex" => Agent::Codex,
        "pi" => Agent::Pi,
        _ => unreachable!(),
    };
    let mut store = Arc::new(Store::new(root.join("queues")));
    store
        .enqueue(
            &id,
            agent,
            Entry::new(
                "head".into(),
                vec![],
                TurnOptions {
                    ignore_external_writer: mode == "writer-blocked",
                    ..Default::default()
                },
            )
            .unwrap(),
        )
        .unwrap();
    store
        .enqueue(
            &id,
            agent,
            Entry::new("tail".into(), vec![], TurnOptions::default()).unwrap(),
        )
        .unwrap();
    if mode == "writer-blocked" {
        drop(store);
        store = Arc::new(Store::new(root.join("queues")));
        store.resume(&id).unwrap();
        let writers = root.join("claude/sessions");
        fs::create_dir(&writers).unwrap();
        fs::write(writers.join("writer.json"), serde_json::to_vec(&json!({"pid":std::process::id(),"sessionId":id,"status":"busy","entrypoint":"sdk-cli"})).unwrap()).unwrap();
    }
    let (_, head, _) = store.claim(&id).unwrap().unwrap();
    let observed = Arc::new(Mutex::new(Observed::default()));
    let events = observed.clone();
    let receipt = observed.clone();
    let queue = store.clone();
    let sink = TurnSink::new(move |event| {
        events.lock().unwrap().record(&event);
        Ok(())
    })
    .with_acceptance(move |id| {
        receipt.lock().unwrap().accepted = true;
        queue.accepted(&id)?;
        let disk: TaskQueue =
            serde_json::from_slice(&fs::read(queue.root.join(format!("{id}.json"))).unwrap())
                .unwrap();
        assert!(disk.in_flight.is_none());
        Ok(())
    });
    let runs = Runs::default();
    let result = tauri::async_runtime::block_on(async {
        let send = async {
            match agent {
                Agent::Claude => {
                    runner::send_turn(
                        &runs,
                        Some(id.clone()),
                        None,
                        head.prompt.clone(),
                        Prepared::default(),
                        head.options.clone(),
                        sink,
                    )
                    .await
                }
                Agent::Codex | Agent::Pi => {
                    let request = codex::TurnRequest {
                        task_id: Some(id.clone()),
                        cwd: Some(root.join("project").to_string_lossy().into()),
                        prompt: head.prompt.clone(),
                        attachments: Prepared::default(),
                        options: head.options.clone(),
                    };
                    match agent {
                        Agent::Codex => codex::send_turn(&runs, request, sink).await,
                        Agent::Pi => pi::send_turn(&runs, request, sink).await,
                        _ => unreachable!(),
                    }
                }
            }
        };
        tokio::time::timeout(std::time::Duration::from_secs(10), send)
            .await
            .unwrap()
    });
    let observed = std::mem::take(&mut *observed.lock().unwrap());
    if mode != "writer-blocked" && (mode != "spawn-failure" || agent != Agent::Codex) {
        assert_eq!(observed.task_id.as_deref(), Some(id.as_str()));
    }
    let accepted = mode.starts_with("accepted-") || mode == "notification-first";
    assert_eq!(
        observed.accepted, accepted,
        "receipt must follow the CLI acknowledgment"
    );
    let success = matches!(mode, "accepted-success" | "accepted-retry-success");
    assert_eq!(observed.success, success, "the final CLI outcome must determine queue progress");
    if mode == "accepted-retry-success" {
        assert!(observed.error.is_none(), "recovered request errors must be cleared");
    }
    let snapshot = store
        .finish_claim(&id, head, result, observed)
        .unwrap()
        .unwrap();
    let expected = if accepted {
        vec!["tail"]
    } else {
        vec!["head", "tail"]
    };
    assert_eq!(
        snapshot
            .entries
            .iter()
            .map(|e| e.prompt.as_str())
            .collect::<Vec<_>>(),
        expected
    );
    assert_eq!(snapshot.paused, !success);
    if mode == "accepted-retry-success" {
        assert!(snapshot.error.is_none());
        let (_, next, _) = store.claim(&id).unwrap().expect("successful retry must let the next queued message start");
        assert_eq!(next.prompt, "tail");
    }
    if mode == "accepted-request-error" {
        assert_eq!(snapshot.error.as_deref(), Some("terminal image failure"));
    }
    drop(store);
    let restarted = Store::new(root.join("queues"));
    let snapshot = restarted.list().unwrap().remove(0);
    assert_eq!(
        snapshot
            .entries
            .iter()
            .map(|e| e.prompt.as_str())
            .collect::<Vec<_>>(),
        expected
    );
    assert!(snapshot.paused);
}

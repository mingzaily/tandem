//! Remote access: a phone reaches this machine through a relay that cannot read the traffic.
//! The protocol is in docs/relay-protocol.md. Off until the user turns it on.

pub mod crypto;
mod link;
mod ops;
mod store;

use crate::runner::{TurnEvent, TurnSink};
use crate::sessions::Agent;
use qrcode::{QrCode, render::svg};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use store::Config;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, oneshot};

const CHANGED_EVENT: &str = "remote-changed";
pub const TURN_EVENT: &str = "remote-turn";
const PAIRING_LIFETIME: Duration = Duration::from_secs(300);
/// A long turn must not grow without limit just because no phone is watching it.
const MAX_RUN_EVENTS: usize = 20_000;
const QR_SIZE: u32 = 240;

/// The desktop backend derives the phone's task view from its own configuration and state.
#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Context {
    pub projects: Vec<String>,
    pub project_order: Vec<String>,
    pub conversation_roots: Vec<String>,
    pub conversation_dir: Option<String>,
    pub archived: Vec<String>,
    /// CLIs whose tasks stay out of every list, as named in config.
    pub hidden_agents: Vec<String>,
    pub titles: HashMap<String, String>,
    pub language: Option<String>,
}

pub(crate) struct RunRecord {
    agent: Agent,
    prompt: String,
    task_id: Option<String>,
    started_at_ms: u64,
    started: Instant,
    events: Vec<TurnEvent>,
    sink: TurnSink,
}

impl RunRecord {
    fn event_payload(&self, run_id: &str, seq: u64, event: &TurnEvent) -> Value {
        let mut payload = json!({
            "runId": run_id, "taskId": self.task_id, "agent": self.agent,
            "startedAtMs": self.started_at_ms, "elapsedMs": self.started.elapsed().as_millis() as u64,
            "seq": seq, "event": event,
        });
        // Lifecycle boundaries carry the input; streaming deltas keep their compact payload.
        if matches!(
            event,
            TurnEvent::Started { .. } | TurnEvent::Finished { .. }
        ) {
            payload["prompt"] = json!(self.prompt);
        }
        payload
    }
}

/// Debug builds can write the pairing text to a file, because a test cannot read it off the screen.
#[cfg(debug_assertions)]
fn write_pairing_for_test(text: &str) {
    if let Ok(path) = std::env::var("TANDEM_DRIVE_PAIR_FILE") {
        let _ = std::fs::write(path, text);
    }
}

pub(crate) struct Pairing {
    pub token: [u8; 32],
    pub secret: [u8; 32],
    deadline: Instant,
    registered: bool,
    text: String,
    qr: String,
}

impl Pairing {
    pub fn is_live(&self) -> bool {
        self.registered && self.deadline > Instant::now()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkStatus {
    Off,
    Connecting,
    Online,
    Failed,
}

#[derive(Clone)]
struct ConnectionStatus {
    status: LinkStatus,
    error: Option<String>,
    relay_version: Option<String>,
}

impl Default for ConnectionStatus {
    fn default() -> Self {
        Self {
            status: LinkStatus::Off,
            error: None,
            relay_version: None,
        }
    }
}

impl ConnectionStatus {
    fn set(&mut self, status: LinkStatus, error: Option<String>) {
        if status != LinkStatus::Online {
            self.relay_version = None;
        }
        self.status = status;
        self.error = error;
    }
}

pub(crate) enum Outgoing {
    Frame(Value),
    BeginPairing {
        pairing: Pairing,
        reply: oneshot::Sender<Result<(), String>>,
    },
    ToPeer {
        conn: String,
        message: Value,
    },
    Broadcast(Value),
    PairAnswer {
        conn: String,
        allow: bool,
    },
    Disconnect {
        client_id: String,
    },
}

pub(crate) struct Inner {
    pub app: AppHandle,
    path: PathBuf,
    pub config: Mutex<Config>,
    pub context: Mutex<Context>,
    pub pairing: Mutex<Option<Pairing>>,
    pub runs: Mutex<HashMap<String, RunRecord>>,
    pub online: Mutex<HashMap<String, String>>,
    pub info_cache: tokio::sync::Mutex<HashMap<&'static str, (std::time::Instant, Value)>>,
    status: Mutex<ConnectionStatus>,
    sender: Mutex<Option<mpsc::UnboundedSender<Outgoing>>>,
    task: Mutex<Option<JoinHandle<()>>>,
    /// Numbers every turn event, so a phone can tell what a snapshot already holds.
    seq: AtomicU64,
}

#[derive(Clone)]
pub struct Remote(pub(crate) Arc<Inner>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientView {
    client_id: String,
    name: String,
    paired_at_ms: u64,
    is_online: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingView {
    text: String,
    qr: String,
    expires_at_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteState {
    enabled: bool,
    relay_url: String,
    has_host_token: bool,
    relay_version: Option<String>,
    status: LinkStatus,
    error: Option<String>,
    pairing: Option<PairingView>,
    clients: Vec<ClientView>,
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

fn qr_data_url(text: &str) -> Result<String, String> {
    let code = QrCode::new(text.as_bytes()).map_err(|error| error.to_string())?;
    let image = code
        .render::<svg::Color>()
        .min_dimensions(QR_SIZE, QR_SIZE)
        .build();
    Ok(format!(
        "data:image/svg+xml;base64,{}",
        base64_standard(image.as_bytes())
    ))
}

fn base64_standard(bytes: &[u8]) -> String {
    use base64::{Engine, engine::general_purpose::STANDARD};
    STANDARD.encode(bytes)
}

/// Long stretches of text arrive a few characters at a time, and only the text matters later.
fn push_event(events: &mut Vec<TurnEvent>, event: &TurnEvent) {
    match (events.last_mut(), event) {
        (Some(TurnEvent::TextDelta { text: last }), TurnEvent::TextDelta { text }) => {
            return last.push_str(text);
        }
        (Some(TurnEvent::ThinkingDelta { text: last }), TurnEvent::ThinkingDelta { text }) => {
            return last.push_str(text);
        }
        _ => {}
    }
    if events.len() < MAX_RUN_EVENTS {
        events.push(event.clone());
    }
}

impl Remote {
    pub fn new(app: AppHandle) -> Result<Self, String> {
        let storage = app.state::<crate::storage::Store>();
        let path = storage.root().join("remote.json");
        let config = store::load(&path);
        let writable = storage.is_writable();
        let context = storage.remote_context();
        let remote = Self(Arc::new(Inner {
            app,
            path,
            config: Mutex::new(config),
            context: Mutex::new(context),
            pairing: Mutex::default(),
            runs: Mutex::default(),
            online: Mutex::default(),
            info_cache: tokio::sync::Mutex::default(),
            status: Mutex::default(),
            sender: Mutex::default(),
            task: Mutex::default(),
            seq: AtomicU64::new(0),
        }));
        if writable {
            remote.restart_link();
        }
        Ok(remote)
    }

    pub fn state(&self) -> RemoteState {
        let config = self.0.lock_config();
        let ConnectionStatus {
            status,
            error,
            relay_version,
        } = self
            .0
            .status
            .lock()
            .map_or_else(|_| ConnectionStatus::default(), |status| status.clone());
        let online = self
            .0
            .online
            .lock()
            .map(|online| online.clone())
            .unwrap_or_default();
        let pairing = self.0.pairing.lock().ok().and_then(|pairing| {
            pairing
                .as_ref()
                .filter(|pairing| pairing.is_live())
                .map(|pairing| PairingView {
                    text: pairing.text.clone(),
                    qr: pairing.qr.clone(),
                    expires_at_ms: now_ms()
                        + pairing
                            .deadline
                            .saturating_duration_since(Instant::now())
                            .as_millis() as u64,
                })
        });
        RemoteState {
            enabled: config.enabled,
            relay_url: config.relay_url.clone(),
            has_host_token: !config.host_token.is_empty(),
            relay_version: matches!(status, LinkStatus::Online)
                .then_some(relay_version)
                .flatten(),
            status,
            error,
            pairing,
            clients: config
                .clients
                .iter()
                .map(|client| ClientView {
                    client_id: client.client_id.clone(),
                    name: client.name.clone(),
                    paired_at_ms: client.paired_at_ms,
                    is_online: online.values().any(|id| id == &client.client_id),
                })
                .collect(),
        }
    }

    /// An empty token keeps the saved one, so the page never has to read it back.
    pub fn configure(
        &self,
        enabled: bool,
        relay_url: String,
        host_token: Option<String>,
    ) -> Result<(), String> {
        let relay_url = if relay_url.trim().is_empty() {
            String::new()
        } else {
            store::normalize_relay_url(&relay_url)?
        };
        {
            let mut current = self.0.lock_config();
            let mut config = current.clone();
            if enabled && relay_url.is_empty() {
                return Err("请先填写中转域名".to_owned());
            }
            config.enabled = enabled;
            config.relay_url = relay_url;
            if let Some(token) = host_token
                .map(|token| token.trim().to_owned())
                .filter(|token| !token.is_empty())
            {
                config.host_token = token;
            }
            if enabled && config.host_token.is_empty() {
                return Err("请先填写部署令牌".to_owned());
            }
            self.0.save(&config)?;
            *current = config;
        }
        self.restart_link();
        self.0.notify_changed();
        Ok(())
    }

    pub async fn begin_pairing(&self) -> Result<(), String> {
        let config = self.0.lock_config().clone();
        if self
            .0
            .status
            .lock()
            .map(|status| status.status.clone())
            .ok()
            != Some(LinkStatus::Online)
        {
            return Err("Not connected to the relay".to_owned());
        }
        let token = crypto::random_bytes::<32>();
        let secret = crypto::random_bytes::<32>();
        let key = crypto::signing_key_from(&crypto::decode(&config.signing_key)?)?;
        let payload = json!({
            "v": 1,
            "relay": config.relay_url,
            "room": config.room,
            "host": crypto::encode(&crypto::public_point(&key)),
            "token": crypto::encode(&token),
            "secret": crypto::encode(&secret),
        });
        let text = format!(
            "tandem-pair:{}",
            crypto::encode(payload.to_string().as_bytes())
        );
        let qr = qr_data_url(&text)?;
        let pairing = Pairing {
            token,
            secret,
            deadline: Instant::now() + PAIRING_LIFETIME,
            registered: false,
            text,
            qr,
        };
        let (reply, received) = oneshot::channel();
        self.0.send(Outgoing::BeginPairing { pairing, reply });
        received.await.map_err(|_| {
            "The relay connection closed before confirming the pairing token".to_owned()
        })?
    }

    pub fn cancel_pairing(&self) {
        self.0.end_pairing();
        self.0.notify_changed();
    }

    pub fn revoke(&self, client_id: &str) -> Result<(), String> {
        {
            let mut current = self.0.lock_config();
            let mut config = current.clone();
            let Some(index) = config
                .clients
                .iter()
                .position(|client| client.client_id == client_id)
            else {
                return Err("That device is not paired".to_owned());
            };
            let client = config.clients.remove(index);
            self.0.save(&config)?;
            *current = config;
            self.0.send(Outgoing::Frame(
                json!({"t": "revoke", "tokenHash": client.token_hash}),
            ));
        }
        self.0.send(Outgoing::Disconnect {
            client_id: client_id.to_owned(),
        });
        self.0.notify_changed();
        Ok(())
    }

    pub fn update_context(&self, context: Context) {
        if let Ok(mut current) = self.0.context.lock() {
            if *current == context {
                return;
            }
            *current = context;
        }
        self.0
            .send(Outgoing::Broadcast(json!({"ev": "tasks.changed", "p": {}})));
    }

    /// Registers a turn so phones see it, whichever side started it. Every event then goes through
    /// the returned sink. Call `end_run` when the turn's function returns.
    pub fn track(
        &self,
        agent: Agent,
        task_id: Option<String>,
        prompt: String,
        sink: TurnSink,
    ) -> (String, TurnSink) {
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        if let Ok(mut runs) = self.0.runs.lock() {
            runs.insert(
                run_id.clone(),
                RunRecord {
                    agent,
                    prompt,
                    task_id,
                    started_at_ms: now_ms(),
                    started: Instant::now(),
                    events: Vec::new(),
                    sink,
                },
            );
        }
        let inner = self.0.clone();
        let id = run_id.clone();
        (
            run_id,
            TurnSink::new(move |event| inner.deliver(&id, event)),
        )
    }

    /// A turn that failed before it could report that itself still has to end on the phones.
    pub fn end_run(&self, run_id: &str, result: &Result<(), String>) {
        let Ok(mut runs) = self.0.runs.lock() else {
            return;
        };
        let record = runs.remove(run_id);
        let (Some(record), Err(message)) = (record, result) else {
            return;
        };
        let event = TurnEvent::Finished {
            is_error: true,
            cancelled: false,
            message: Some(message.clone()),
        };
        let seq = self.0.seq.fetch_add(1, Ordering::SeqCst) + 1;
        self.0.broadcast_turn(run_id, &record, seq, &event);
        self.0
            .send(Outgoing::Broadcast(json!({"ev": "tasks.changed", "p": {}})));
    }

    /// Whoever answered a request, the other side's card has to go away.
    pub fn settle(&self, task_id: &str, request_id: &str) {
        let run_id = self.0.runs.lock().ok().and_then(|runs| {
            runs.iter()
                .find(|(_, record)| record.task_id.as_deref() == Some(task_id))
                .map(|(run_id, _)| run_id.clone())
        });
        if let Some(run_id) = run_id {
            let _ = self.0.deliver(
                &run_id,
                TurnEvent::RequestSettled {
                    request_id: request_id.to_owned(),
                },
            );
        }
    }

    fn restart_link(&self) {
        if let Ok(mut task) = self.0.task.lock() {
            if let Some(task) = task.take() {
                task.abort();
            }
        }
        if let Ok(mut online) = self.0.online.lock() {
            online.clear();
        }
        self.0.end_pairing();
        let config = self.0.lock_config().clone();
        if !config.enabled || config.relay_url.is_empty() || config.host_token.is_empty() {
            if let Ok(mut sender) = self.0.sender.lock() {
                *sender = None;
            }
            self.0.set_status(LinkStatus::Off, None);
            return;
        }
        let (sender, receiver) = mpsc::unbounded_channel();
        if let Ok(mut current) = self.0.sender.lock() {
            *current = Some(sender);
        }
        let task = tauri::async_runtime::spawn(link::run(self.0.clone(), receiver));
        if let Ok(mut current) = self.0.task.lock() {
            *current = Some(task);
        }
    }
}

impl Inner {
    pub(crate) fn lock_config(&self) -> std::sync::MutexGuard<'_, Config> {
        self.config
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub(crate) fn save(&self, config: &Config) -> Result<(), String> {
        store::save(&self.path, config)
    }

    pub(crate) fn send(&self, outgoing: Outgoing) {
        if let Ok(sender) = self.sender.lock() {
            if let Some(sender) = sender.as_ref() {
                let _ = sender.send(outgoing);
            }
        }
    }

    pub(crate) fn set_status(&self, status: LinkStatus, error: Option<String>) {
        if let Ok(mut current) = self.status.lock() {
            current.set(status, error);
        }
        self.notify_changed();
    }

    pub(crate) fn notify_changed(&self) {
        let _ = self.app.emit_to("main", CHANGED_EVENT, ());
    }

    pub(crate) fn end_pairing(&self) {
        let ended = self
            .pairing
            .lock()
            .ok()
            .and_then(|mut pairing| pairing.take());
        if let Some(pairing) = ended {
            self.send(Outgoing::Frame(
                json!({"t": "revoke", "tokenHash": crypto::sha256_hex(&pairing.token)}),
            ));
        }
    }

    fn broadcast_turn(&self, run_id: &str, record: &RunRecord, seq: u64, event: &TurnEvent) {
        self.send(Outgoing::Broadcast(
            json!({"ev": "turn.event", "p": record.event_payload(run_id, seq, event)}),
        ));
    }

    fn deliver(&self, run_id: &str, event: TurnEvent) -> Result<(), String> {
        // Numbered under the lock, so a snapshot's number splits the events exactly.
        let sink = {
            let mut runs = self
                .runs
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            // A request can settle concurrently with the turn's final event.
            let Some(record) = runs.get_mut(run_id) else {
                return Ok(());
            };
            if let TurnEvent::Started { task_id: started } = &event {
                record.task_id = Some(started.clone());
            }
            push_event(&mut record.events, &event);
            let seq = self.seq.fetch_add(1, Ordering::SeqCst) + 1;
            self.broadcast_turn(run_id, record, seq, &event);
            let sink = record.sink.clone();
            if matches!(event, TurnEvent::Finished { .. }) {
                runs.remove(run_id);
            }
            sink
        };
        if matches!(
            event,
            TurnEvent::Started { .. } | TurnEvent::Finished { .. }
        ) {
            self.send(Outgoing::Broadcast(json!({"ev": "tasks.changed", "p": {}})));
        }
        sink.send(event)
    }

    pub(crate) fn snapshot(&self) -> Value {
        let Ok(runs) = self.runs.lock() else {
            return json!({"seq": 0, "runs": []});
        };
        let seq = self.seq.load(Ordering::SeqCst);
        let list: Vec<Value> = runs
            .iter()
            .map(|(run_id, record)| {
                json!({"runId": run_id, "taskId": record.task_id, "agent": record.agent, "prompt": record.prompt,
                    "startedAtMs": record.started_at_ms, "elapsedMs": record.started.elapsed().as_millis() as u64, "events": record.events})
            })
            .collect();
        json!({"seq": seq, "runs": list})
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relay_version_is_retained_online_and_cleared_on_disconnect_or_reconnect() {
        for next in [LinkStatus::Off, LinkStatus::Connecting, LinkStatus::Failed] {
            let mut connection = ConnectionStatus {
                status: LinkStatus::Connecting,
                error: None,
                relay_version: Some("0.1.2026111101".into()),
            };
            connection.set(LinkStatus::Online, None);
            assert_eq!(connection.relay_version.as_deref(), Some("0.1.2026111101"));
            connection.set(next, None);
            assert!(connection.relay_version.is_none());
        }
    }

    #[test]
    fn pairing_is_available_after_registration_and_before_its_monotonic_deadline() {
        let mut pairing = Pairing {
            token: [0; 32],
            secret: [0; 32],
            deadline: Instant::now() + PAIRING_LIFETIME,
            registered: false,
            text: String::new(),
            qr: String::new(),
        };
        assert!(!pairing.is_live());
        pairing.registered = true;
        assert!(pairing.is_live());
        pairing.deadline = Instant::now() - Duration::from_secs(1);
        assert!(!pairing.is_live());
    }

    #[test]
    fn deltas_merge_so_a_snapshot_stays_small() {
        let mut events = Vec::new();
        push_event(&mut events, &TurnEvent::TextDelta { text: "he".into() });
        push_event(&mut events, &TurnEvent::TextDelta { text: "llo".into() });
        push_event(&mut events, &TurnEvent::ThinkingDelta { text: "x".into() });
        assert_eq!(events.len(), 2);
        assert!(matches!(&events[0], TurnEvent::TextDelta { text } if text == "hello"));
    }

    #[test]
    fn lifecycle_frames_identify_the_actual_agent_input_and_task_before_startup_can_fail() {
        let record = RunRecord {
            agent: Agent::Pi,
            task_id: Some("task".into()),
            prompt: "continue".into(),
            started_at_ms: 100,
            started: Instant::now(),
            events: vec![],
            sink: TurnSink::new(|_| Ok(())),
        };
        let failed = record.event_payload(
            "run",
            2,
            &TurnEvent::Finished {
                is_error: true,
                cancelled: false,
                message: Some("startup failed".into()),
            },
        );
        assert_eq!(failed["agent"], "pi");
        assert_eq!(failed["taskId"], "task");
        assert_eq!(failed["prompt"], "continue");
        assert_eq!(failed["seq"], 2);
        let delta = record.event_payload(
            "run",
            1,
            &TurnEvent::TextDelta {
                text: "part".into(),
            },
        );
        assert!(delta.get("prompt").is_none());
        assert_eq!(delta["agent"], "pi");
    }

    #[test]
    fn the_pairing_code_fits_in_a_qr_image() {
        let url = qr_data_url(&format!("tandem-pair:{}", "a".repeat(400))).unwrap();
        assert!(url.starts_with("data:image/svg+xml;base64,"));
    }
}

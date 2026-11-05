//! Remote access: a phone reaches this machine through a relay that cannot read the traffic.
//! The protocol is in docs/relay-protocol.md. Off until the user turns it on.

pub mod crypto;
mod link;
mod ops;
mod store;

use crate::runner::{TurnEvent, TurnSink};
use crate::sessions::Agent;
use qrcode::{render::svg, QrCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use store::Config;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

const CHANGED_EVENT: &str = "remote-changed";
pub const TURN_EVENT: &str = "remote-turn";
const PAIRING_LIFETIME: Duration = Duration::from_secs(300);
/// A long turn must not grow without limit just because no phone is watching it.
const MAX_RUN_EVENTS: usize = 20_000;
const QR_SIZE: u32 = 240;

/// What only the page knows, because it keeps these in its own storage.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Context {
    pub projects: Vec<String>,
    pub conversation_roots: Vec<String>,
    pub conversation_dir: Option<String>,
    pub archived: Vec<String>,
    pub titles: HashMap<String, String>,
    pub language: Option<String>,
}

pub(crate) struct RunRecord {
    agent: Agent,
    task_id: Option<String>,
    events: Vec<TurnEvent>,
    sink: TurnSink,
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
    expires_at_ms: u64,
    text: String,
    qr: String,
}

impl Pairing {
    pub fn is_live(&self) -> bool {
        self.expires_at_ms > now_ms()
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

pub(crate) enum Outgoing {
    Frame(Value),
    ToPeer { conn: String, message: Value },
    Broadcast(Value),
    PairAnswer { conn: String, allow: bool },
    Disconnect { client_id: String },
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
    status: Mutex<(LinkStatus, Option<String>)>,
    sender: Mutex<Option<mpsc::UnboundedSender<Outgoing>>>,
    task: Mutex<Option<JoinHandle<()>>>,
    next_run: AtomicU64,
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
    status: LinkStatus,
    error: Option<String>,
    pairing: Option<PairingView>,
    clients: Vec<ClientView>,
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_millis() as u64)
}

fn qr_data_url(text: &str) -> Result<String, String> {
    let code = QrCode::new(text.as_bytes()).map_err(|error| error.to_string())?;
    let image = code.render::<svg::Color>().min_dimensions(QR_SIZE, QR_SIZE).build();
    Ok(format!("data:image/svg+xml;base64,{}", base64_standard(image.as_bytes())))
}

fn base64_standard(bytes: &[u8]) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine};
    STANDARD.encode(bytes)
}

/// Long stretches of text arrive a few characters at a time, and only the text matters later.
fn push_event(events: &mut Vec<TurnEvent>, event: &TurnEvent) {
    match (events.last_mut(), event) {
        (Some(TurnEvent::TextDelta { text: last }), TurnEvent::TextDelta { text }) => return last.push_str(text),
        (Some(TurnEvent::ThinkingDelta { text: last }), TurnEvent::ThinkingDelta { text }) => return last.push_str(text),
        _ => {}
    }
    if events.len() < MAX_RUN_EVENTS {
        events.push(event.clone());
    }
}

impl Remote {
    pub fn new(app: AppHandle) -> Result<Self, String> {
        let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
        let path = dir.join("remote.json");
        let config = store::load(&path);
        let remote = Self(Arc::new(Inner {
            app,
            path,
            config: Mutex::new(config),
            context: Mutex::default(),
            pairing: Mutex::default(),
            runs: Mutex::default(),
            online: Mutex::default(),
            info_cache: tokio::sync::Mutex::default(),
            status: Mutex::new((LinkStatus::Off, None)),
            sender: Mutex::default(),
            task: Mutex::default(),
            next_run: AtomicU64::new(1),
            seq: AtomicU64::new(0),
        }));
        remote.restart_link();
        Ok(remote)
    }

    pub fn state(&self) -> RemoteState {
        let config = self.0.lock_config();
        let (status, error) = self.0.status.lock().map_or((LinkStatus::Off, None), |status| status.clone());
        let online = self.0.online.lock().map(|online| online.clone()).unwrap_or_default();
        let pairing = self.0.pairing.lock().ok().and_then(|pairing| {
            pairing.as_ref().filter(|pairing| pairing.expires_at_ms > now_ms()).map(|pairing| PairingView {
                text: pairing.text.clone(),
                qr: pairing.qr.clone(),
                expires_at_ms: pairing.expires_at_ms,
            })
        });
        RemoteState {
            enabled: config.enabled,
            relay_url: config.relay_url.clone(),
            has_host_token: !config.host_token.is_empty(),
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
    pub fn configure(&self, enabled: bool, relay_url: String, host_token: Option<String>) -> Result<(), String> {
        let relay_url = relay_url.trim().to_owned();
        if !relay_url.is_empty() {
            store::check_relay_url(&relay_url)?;
        }
        {
            let mut config = self.0.lock_config();
            if enabled && relay_url.is_empty() {
                return Err("Enter the relay address first".to_owned());
            }
            config.enabled = enabled;
            config.relay_url = relay_url;
            if let Some(token) = host_token.map(|token| token.trim().to_owned()).filter(|token| !token.is_empty()) {
                config.host_token = token;
            }
            if enabled && config.host_token.is_empty() {
                config.enabled = false;
                return Err("Enter the relay token first".to_owned());
            }
            self.0.save(&config)?;
        }
        self.restart_link();
        self.0.notify_changed();
        Ok(())
    }

    pub fn begin_pairing(&self) -> Result<(), String> {
        let config = self.0.lock_config().clone();
        if self.0.status.lock().map(|status| status.0.clone()).ok() != Some(LinkStatus::Online) {
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
        let text = format!("tandem-pair:{}", crypto::encode(payload.to_string().as_bytes()));
        let expires_at_ms = now_ms() + PAIRING_LIFETIME.as_millis() as u64;
        let qr = qr_data_url(&text)?;
        #[cfg(debug_assertions)]
        write_pairing_for_test(&text);
        self.0.send(Outgoing::Frame(json!({
            "t": "allow",
            "tokenHash": crypto::sha256_hex(&token),
            "oneTime": true,
            "expiresAt": expires_at_ms,
        })));
        if let Ok(mut pairing) = self.0.pairing.lock() {
            *pairing = Some(Pairing { token, secret, expires_at_ms, text, qr });
        }
        self.0.notify_changed();
        Ok(())
    }

    pub fn cancel_pairing(&self) {
        self.0.end_pairing();
        self.0.notify_changed();
    }

    pub fn revoke(&self, client_id: &str) -> Result<(), String> {
        {
            let mut config = self.0.lock_config();
            let Some(index) = config.clients.iter().position(|client| client.client_id == client_id) else {
                return Err("That device is not paired".to_owned());
            };
            let client = config.clients.remove(index);
            self.0.save(&config)?;
            self.0.send(Outgoing::Frame(json!({"t": "revoke", "tokenHash": client.token_hash})));
        }
        self.0.send(Outgoing::Disconnect { client_id: client_id.to_owned() });
        self.0.notify_changed();
        Ok(())
    }

    pub fn update_context(&self, context: Context) {
        if let Ok(mut current) = self.0.context.lock() {
            *current = context;
        }
    }

    /// Registers a turn so phones see it, whichever side started it. Every event then goes through
    /// the returned sink. Call `end_run` when the turn's function returns.
    pub fn track(&self, agent: Agent, sink: TurnSink) -> (String, TurnSink) {
        let run_id = format!("run-{}", self.0.next_run.fetch_add(1, Ordering::Relaxed));
        if let Ok(mut runs) = self.0.runs.lock() {
            runs.insert(run_id.clone(), RunRecord { agent, task_id: None, events: Vec::new(), sink });
        }
        let inner = self.0.clone();
        let id = run_id.clone();
        (run_id, TurnSink::new(move |event| inner.deliver(&id, event)))
    }

    /// A turn that failed before it could report that itself still has to end on the phones.
    pub fn end_run(&self, run_id: &str, result: &Result<(), String>) {
        let record = self.0.runs.lock().ok().and_then(|mut runs| runs.remove(run_id));
        let (Some(record), Err(message)) = (record, result) else {
            return;
        };
        let event = TurnEvent::Finished { is_error: true, cancelled: false, message: Some(message.clone()) };
        let seq = self.0.seq.fetch_add(1, Ordering::SeqCst) + 1;
        self.0.broadcast_turn(run_id, record.task_id.as_deref(), seq, &event);
        self.0.send(Outgoing::Broadcast(json!({"ev": "tasks.changed", "p": {}})));
    }

    /// Whoever answered a request, the other side's card has to go away.
    pub fn settle(&self, task_id: &str, request_id: &str) {
        let run_id = self.0.runs.lock().ok().and_then(|runs| {
            runs.iter()
                .find(|(_, record)| record.task_id.as_deref() == Some(task_id))
                .map(|(run_id, _)| run_id.clone())
        });
        if let Some(run_id) = run_id {
            let _ = self.0.deliver(&run_id, TurnEvent::RequestSettled { request_id: request_id.to_owned() });
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
        self.config.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
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
            *current = (status, error);
        }
        self.notify_changed();
    }

    pub(crate) fn notify_changed(&self) {
        let _ = self.app.emit_to("main", CHANGED_EVENT, ());
    }

    pub(crate) fn end_pairing(&self) {
        let ended = self.pairing.lock().ok().and_then(|mut pairing| pairing.take());
        if let Some(pairing) = ended {
            self.send(Outgoing::Frame(json!({"t": "revoke", "tokenHash": crypto::sha256_hex(&pairing.token)})));
        }
    }

    fn broadcast_turn(&self, run_id: &str, task_id: Option<&str>, seq: u64, event: &TurnEvent) {
        self.send(Outgoing::Broadcast(json!({
            "ev": "turn.event",
            "p": {"runId": run_id, "taskId": task_id, "seq": seq, "event": event},
        })));
    }

    fn deliver(&self, run_id: &str, event: TurnEvent) -> Result<(), String> {
        let mut task_id = None;
        let mut sink = None;
        let mut seq = 0;
        // Numbered under the lock, so a snapshot's number splits the events exactly.
        if let Ok(mut runs) = self.runs.lock() {
            seq = self.seq.fetch_add(1, Ordering::SeqCst) + 1;
            let is_finished = matches!(event, TurnEvent::Finished { .. });
            if let Some(record) = runs.get_mut(run_id) {
                if let TurnEvent::Started { task_id: started } = &event {
                    record.task_id = Some(started.clone());
                }
                push_event(&mut record.events, &event);
                task_id.clone_from(&record.task_id);
                sink = Some(record.sink.clone());
            }
            if is_finished {
                runs.remove(run_id);
            }
        }
        self.broadcast_turn(run_id, task_id.as_deref(), seq, &event);
        if matches!(event, TurnEvent::Started { .. } | TurnEvent::Finished { .. }) {
            self.send(Outgoing::Broadcast(json!({"ev": "tasks.changed", "p": {}})));
        }
        sink.map_or(Ok(()), |sink| sink.send(event))
    }

    pub(crate) fn snapshot(&self) -> Value {
        let Ok(runs) = self.runs.lock() else {
            return json!({"seq": 0, "runs": []});
        };
        let seq = self.seq.load(Ordering::SeqCst);
        let list: Vec<Value> = runs
            .iter()
            .map(|(run_id, record)| {
                json!({"runId": run_id, "taskId": record.task_id, "agent": record.agent, "events": record.events})
            })
            .collect();
        json!({"seq": seq, "runs": list})
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn the_pairing_code_fits_in_a_qr_image() {
        let url = qr_data_url(&format!("tandem-pair:{}", "a".repeat(400))).unwrap();
        assert!(url.starts_with("data:image/svg+xml;base64,"));
    }
}

//! The connection to the relay and the encrypted session with each phone.

use super::crypto;
use super::store::PairedClient;
use super::{Inner, LinkStatus, Outgoing, PAIRING_LIFETIME, now_ms, ops};
use futures_util::{SinkExt, StreamExt};
use p256::ecdh::EphemeralSecret;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;

const CHUNK_BYTES: usize = 512 * 1024;
const MAX_MESSAGE_BYTES: usize = 32 * 1024 * 1024;
const HELLO_TIMEOUT: Duration = Duration::from_secs(10);
const PING_EVERY: Duration = Duration::from_secs(30);
const SILENCE_LIMIT: Duration = Duration::from_secs(90);
const MAX_BACKOFF: Duration = Duration::from_secs(30);
const REPLACED_WAIT: Duration = Duration::from_secs(30);
const CLOSE_REPLACED: u16 = 4409;
const CLOSE_UNPAIRED: u16 = 4410;
const CLOSE_SESSION: u16 = 4411;
const CHUNK_LAST: u8 = 0;
const CHUNK_MORE: u8 = 1;

struct Ready {
    client_id: String,
    c2h: [u8; 32],
    h2c: [u8; 32],
    sent: u64,
    received: u64,
    buffer: Vec<u8>,
}

enum Peer {
    AwaitPair3 {
        token: [u8; 32],
        th: [u8; 32],
        keys: crypto::PairKeys,
        client_point: Vec<u8>,
        name: String,
    },
    AwaitPairAnswer {
        token: [u8; 32],
        keys: crypto::PairKeys,
        client_point: Vec<u8>,
        name: String,
    },
    AwaitPairGrant {
        token: [u8; 32],
        id: String,
    },
    AwaitHello3 {
        client_id: String,
        th: [u8; 32],
        c2h: [u8; 32],
        h2c: [u8; 32],
        client_point: Vec<u8>,
    },
    Ready(Box<Ready>),
    /// The relay is closing this connection; further frames are ignored.
    Closed,
}

impl Peer {
    fn pairing_token(&self) -> Option<[u8; 32]> {
        match self {
            Self::AwaitPair3 { token, .. }
            | Self::AwaitPairAnswer { token, .. }
            | Self::AwaitPairGrant { token, .. } => Some(*token),
            _ => None,
        }
    }
}

enum Registration {
    Restore,
    Pairing {
        token: [u8; 32],
        reply: oneshot::Sender<Result<(), String>>,
    },
    Client {
        conn: String,
        token: [u8; 32],
        client: PairedClient,
        pair4: Value,
    },
}

struct PendingGrant {
    token_hash: String,
    deadline: Instant,
    registration: Registration,
}

fn data_frame(conn: &str, message: &Value) -> Value {
    json!({"t": "data", "to": conn, "d": crypto::encode(message.to_string().as_bytes())})
}

/// Splits one message into encrypted frames.
fn seal_frames(ready: &mut Ready, conn: &str, message: &Value) -> Result<Vec<Value>, String> {
    let bytes = message.to_string().into_bytes();
    let chunks: Vec<&[u8]> = if bytes.is_empty() {
        vec![&[][..]]
    } else {
        bytes.chunks(CHUNK_BYTES).collect()
    };
    let last = chunks.len() - 1;
    let mut frames = Vec::with_capacity(chunks.len());
    for (index, chunk) in chunks.into_iter().enumerate() {
        let mut plain = Vec::with_capacity(chunk.len() + 1);
        plain.push(if index == last {
            CHUNK_LAST
        } else {
            CHUNK_MORE
        });
        plain.extend_from_slice(chunk);
        let sealed = crypto::seal_message(&ready.h2c, ready.sent, &plain)?;
        frames.push(data_frame(
            conn,
            &json!({"k": "m", "n": ready.sent, "c": crypto::encode(&sealed)}),
        ));
        ready.sent += 1;
    }
    Ok(frames)
}

/// Takes one encrypted frame. Returns a whole message once its last chunk has arrived.
fn open_frame(ready: &mut Ready, frame: &Value) -> Result<Option<Value>, String> {
    let counter = frame
        .get("n")
        .and_then(Value::as_u64)
        .ok_or("A message has no counter")?;
    if counter != ready.received {
        return Err("A message arrived out of order".to_owned());
    }
    let sealed = crypto::decode(
        frame
            .get("c")
            .and_then(Value::as_str)
            .ok_or("A message has no content")?,
    )?;
    let plain = crypto::open_message(&ready.c2h, counter, &sealed)?;
    ready.received += 1;
    let (&flag, chunk) = plain.split_first().ok_or("A message is empty")?;
    if ready.buffer.len() + chunk.len() > MAX_MESSAGE_BYTES {
        return Err("A message is too large".to_owned());
    }
    ready.buffer.extend_from_slice(chunk);
    match flag {
        CHUNK_MORE => Ok(None),
        CHUNK_LAST => {
            let whole = std::mem::take(&mut ready.buffer);
            serde_json::from_slice(&whole)
                .map(Some)
                .map_err(|_| "A message is not JSON".to_owned())
        }
        _ => Err("A message has an unknown flag".to_owned()),
    }
}

fn field_bytes(message: &Value, name: &str) -> Result<Vec<u8>, String> {
    crypto::decode(
        message
            .get(name)
            .and_then(Value::as_str)
            .ok_or("A field is missing")?,
    )
}

struct Link {
    inner: Arc<Inner>,
    peers: HashMap<String, Peer>,
    grants: HashMap<String, PendingGrant>,
    restoring: bool,
    outbox: Vec<Value>,
}

impl Link {
    fn register(
        &mut self,
        token_hash: String,
        one_time: bool,
        registration: Registration,
    ) -> String {
        let id = crypto::encode(&crypto::random_bytes::<16>());
        let frame = if one_time {
            json!({"t": "allow", "id": id, "tokenHash": token_hash, "oneTime": true, "ttlMs": PAIRING_LIFETIME.as_millis() as u64})
        } else {
            json!({"t": "allow", "id": id, "tokenHash": token_hash, "oneTime": false, "expiresAt": null})
        };
        self.grants.insert(
            id.clone(),
            PendingGrant {
                token_hash,
                deadline: Instant::now() + HELLO_TIMEOUT,
                registration,
            },
        );
        self.outbox.push(frame);
        id
    }

    fn restore_clients(&mut self) {
        let clients = self.inner.lock_config().clients.clone();
        for client in clients {
            self.register(client.token_hash, false, Registration::Restore);
        }
        self.finish_restore();
    }

    fn finish_restore(&mut self) {
        if self.restoring
            && !self
                .grants
                .values()
                .any(|grant| matches!(grant.registration, Registration::Restore))
        {
            let hashes: Vec<String> = self
                .inner
                .lock_config()
                .clients
                .iter()
                .map(|client| client.token_hash.clone())
                .collect();
            self.outbox
                .push(json!({"t": "allow-sync", "tokenHashes": hashes}));
            self.restoring = false;
            crate::diagnostics::debug("remote", || "relay connection online".to_owned());
            self.inner.set_status(LinkStatus::Online, None);
        }
    }

    fn pairing_is_live(&self, token: &[u8; 32]) -> bool {
        self.inner.pairing.lock().is_ok_and(|pairing| {
            pairing
                .as_ref()
                .is_some_and(|p| p.token == *token && p.is_live())
        })
    }

    fn end_pairing(&self, token: &[u8; 32]) {
        let matches = self
            .inner
            .pairing
            .lock()
            .is_ok_and(|pairing| pairing.as_ref().is_some_and(|p| p.token == *token));
        if matches {
            self.inner.end_pairing();
            self.inner.notify_changed();
        }
    }

    async fn confirm_grant(&mut self, id: &str) -> Result<(), String> {
        let Some(grant) = self.grants.remove(id) else {
            return Ok(());
        };
        match grant.registration {
            Registration::Restore => self.finish_restore(),
            Registration::Pairing { token, reply } => {
                let registered = {
                    let mut pairing = self
                        .inner
                        .pairing
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    match pairing.as_mut() {
                        Some(p)
                            if p.token == token
                                && p.deadline > Instant::now()
                                && !reply.is_closed() =>
                        {
                            p.registered = true;
                            #[cfg(debug_assertions)]
                            super::write_pairing_for_test(&p.text);
                            true
                        }
                        _ => false,
                    }
                };
                if registered {
                    self.inner.notify_changed();
                    let _ = reply.send(Ok(()));
                } else {
                    self.outbox
                        .push(json!({"t": "revoke", "tokenHash": grant.token_hash}));
                    let _ = reply.send(Err("Pairing has ended".to_owned()));
                }
            }
            Registration::Client {
                conn,
                token,
                client,
                pair4,
            } => {
                let committed = if matches!(self.peers.get(&conn), Some(Peer::AwaitPairGrant { id: pending, .. }) if pending == id)
                {
                    let inner = self.inner.clone();
                    tauri::async_runtime::spawn_blocking(move || {
                        let mut config = inner.lock_config();
                        let pairing = inner
                            .pairing
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner);
                        if !pairing
                            .as_ref()
                            .is_some_and(|p| p.token == token && p.is_live())
                        {
                            return Ok::<bool, String>(false);
                        }
                        let mut updated = config.clone();
                        updated.clients.push(client);
                        inner.save(&updated)?;
                        *config = updated;
                        Ok(true)
                    })
                    .await
                    .map_err(|error| error.to_string())??
                } else {
                    false
                };
                if committed {
                    self.outbox.push(data_frame(&conn, &pair4));
                    self.drop_session(&conn, CLOSE_SESSION);
                } else {
                    self.outbox
                        .push(json!({"t": "revoke", "tokenHash": grant.token_hash}));
                    if self.peers.contains_key(&conn) {
                        self.deny_pair(&conn);
                    }
                }
                self.end_pairing(&token);
                self.inner.notify_changed();
            }
        }
        Ok(())
    }

    fn host_key(&self) -> Result<p256::ecdsa::SigningKey, String> {
        let key = self.inner.lock_config().signing_key.clone();
        crypto::signing_key_from(&crypto::decode(&key)?)
    }

    fn deny_pair(&mut self, conn: &str) {
        self.outbox
            .push(data_frame(conn, &json!({"k": "pair-denied"})));
        self.drop_session(conn, CLOSE_SESSION);
    }

    fn on_pair1(&mut self, conn: &str, message: &Value) -> Result<(), String> {
        let (token, secret) = self
            .inner
            .pairing
            .lock()
            .ok()
            .and_then(|pairing| {
                pairing
                    .as_ref()
                    .filter(|pairing| pairing.is_live())
                    .map(|pairing| (pairing.token, pairing.secret))
            })
            .ok_or("No pairing is open")?;
        let e_c = field_bytes(message, "e")?;
        let s_c = field_bytes(message, "s")?;
        let name: String = message
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .chars()
            .take(64)
            .collect();
        let host_point = crypto::public_point(&self.host_key()?);
        let (ephemeral, e_h): (EphemeralSecret, Vec<u8>) = crypto::new_ephemeral();
        let shared = crypto::shared_secret(&ephemeral, &e_c)?;
        let th = crypto::pair_transcript(&e_c, &s_c, &e_h, &host_point);
        let keys = crypto::pair_keys(&shared, &secret, &th);
        let mac = crypto::mac_host(&keys, &th);
        self.outbox.push(data_frame(
            conn,
            &json!({"k": "pair2", "e": crypto::encode(&e_h), "mac": crypto::encode(&mac)}),
        ));
        self.peers.insert(
            conn.to_owned(),
            Peer::AwaitPair3 {
                token,
                th,
                keys,
                client_point: s_c,
                name,
            },
        );
        Ok(())
    }

    fn on_pair3(&mut self, conn: &str, message: &Value) -> Result<(), String> {
        let Some(Peer::AwaitPair3 {
            token,
            th,
            keys,
            client_point,
            name,
        }) = self.peers.remove(conn)
        else {
            return Err("Pairing messages arrived out of order".to_owned());
        };
        let mac = field_bytes(message, "mac")?;
        if !crypto::same_bytes(&mac, &crypto::mac_client(&keys, &th)) {
            return Err("The pairing code does not match".to_owned());
        }
        crypto::verify(&client_point, b"", &th, &field_bytes(message, "sig")?)?;
        ask_user(
            self.inner.clone(),
            conn.to_owned(),
            name.clone(),
            keys.code.clone(),
        );
        self.peers.insert(
            conn.to_owned(),
            Peer::AwaitPairAnswer {
                token,
                keys,
                client_point,
                name,
            },
        );
        Ok(())
    }

    fn finish_pair(&mut self, conn: &str, allow: bool) -> Result<(), String> {
        let Some(Peer::AwaitPairAnswer {
            token: pairing_token,
            keys,
            client_point,
            name,
        }) = self.peers.remove(conn)
        else {
            return Ok(());
        };
        if !allow || !self.pairing_is_live(&pairing_token) {
            self.deny_pair(conn);
            self.end_pairing(&pairing_token);
            return Ok(());
        }
        let client_id = crypto::encode(&crypto::random_bytes::<16>());
        let token = crypto::random_bytes::<32>();
        let token_hash = crypto::sha256_hex(&token);
        let client = PairedClient {
            client_id: client_id.clone(),
            public_key: crypto::encode(&client_point),
            name,
            paired_at_ms: now_ms(),
            token_hash: token_hash.clone(),
        };
        let plain = json!({"clientId": client_id, "token": crypto::encode(&token)}).to_string();
        let sealed = crypto::seal_pair4(&keys.aes, plain.as_bytes())?;
        let id = self.register(
            token_hash,
            false,
            Registration::Client {
                conn: conn.to_owned(),
                token: pairing_token,
                client,
                pair4: json!({"k": "pair4", "c": crypto::encode(&sealed)}),
            },
        );
        self.peers.insert(
            conn.to_owned(),
            Peer::AwaitPairGrant {
                token: pairing_token,
                id,
            },
        );
        Ok(())
    }

    fn on_hello1(&mut self, conn: &str, message: &Value) -> Result<(), String> {
        if message.get("v").and_then(Value::as_u64) != Some(1) {
            return Err("Another protocol version".to_owned());
        }
        let client_id = message
            .get("clientId")
            .and_then(Value::as_str)
            .ok_or("No client id")?
            .to_owned();
        let client = self
            .inner
            .lock_config()
            .clients
            .iter()
            .find(|client| client.client_id == client_id)
            .cloned();
        let Some(client) = client else {
            self.drop_session(conn, CLOSE_UNPAIRED);
            return Ok(());
        };
        let id_bytes = crypto::decode(&client_id)?;
        let client_point = crypto::decode(&client.public_key)?;
        let key = self.host_key()?;
        let host_point = crypto::public_point(&key);
        let e_c = field_bytes(message, "e")?;
        let (ephemeral, e_h) = crypto::new_ephemeral();
        let shared = crypto::shared_secret(&ephemeral, &e_c)?;
        let th = crypto::session_transcript(&id_bytes, &e_c, &e_h, &client_point, &host_point);
        let (c2h, h2c) = crypto::session_keys(&shared, &th);
        let signature = crypto::sign(&key, b"host", &th);
        self.outbox.push(data_frame(
            conn,
            &json!({"k": "hello2", "e": crypto::encode(&e_h), "sig": crypto::encode(&signature)}),
        ));
        self.peers.insert(
            conn.to_owned(),
            Peer::AwaitHello3 {
                client_id,
                th,
                c2h,
                h2c,
                client_point,
            },
        );
        Ok(())
    }

    fn on_hello3(&mut self, conn: &str, message: &Value) -> Result<(), String> {
        let Some(Peer::AwaitHello3 {
            client_id,
            th,
            c2h,
            h2c,
            client_point,
        }) = self.peers.remove(conn)
        else {
            return Err("Handshake messages arrived out of order".to_owned());
        };
        if !self
            .inner
            .lock_config()
            .clients
            .iter()
            .any(|client| client.client_id == client_id)
        {
            self.drop_session(conn, CLOSE_UNPAIRED);
            return Ok(());
        }
        crypto::verify(&client_point, b"client", &th, &field_bytes(message, "sig")?)?;
        if let Ok(mut online) = self.inner.online.lock() {
            online.insert(conn.to_owned(), client_id.clone());
        }
        self.peers.insert(
            conn.to_owned(),
            Peer::Ready(Box::new(Ready {
                client_id,
                c2h,
                h2c,
                sent: 0,
                received: 0,
                buffer: Vec::new(),
            })),
        );
        self.inner.notify_changed();
        Ok(())
    }

    fn on_encrypted(&mut self, conn: &str, frame: &Value) -> Result<(), String> {
        let Some(Peer::Ready(ready)) = self.peers.get_mut(conn) else {
            return Err("A message arrived before the handshake".to_owned());
        };
        if let Some(request) = open_frame(ready, frame)? {
            let inner = self.inner.clone();
            let conn = conn.to_owned();
            tauri::async_runtime::spawn(async move {
                let message = ops::handle(inner.clone(), request).await;
                inner.send(Outgoing::ToPeer { conn, message });
            });
        }
        Ok(())
    }

    fn on_data(&mut self, conn: &str, data: &str) -> Result<(), String> {
        if matches!(self.peers.get(conn), Some(Peer::Closed)) {
            return Ok(());
        }
        let bytes = crypto::decode(data)?;
        let message: Value =
            serde_json::from_slice(&bytes).map_err(|_| "A frame is not JSON".to_owned())?;
        match (
            message.get("k").and_then(Value::as_str),
            self.peers.get(conn),
        ) {
            (Some("pair1"), None) => self.on_pair1(conn, &message),
            (Some("pair3"), Some(Peer::AwaitPair3 { .. })) => self.on_pair3(conn, &message),
            (Some("hello1"), None) => self.on_hello1(conn, &message),
            (Some("hello3"), Some(Peer::AwaitHello3 { .. })) => self.on_hello3(conn, &message),
            (Some("m"), Some(Peer::Ready(_))) => self.on_encrypted(conn, &message),
            _ => Err("A message arrived outside its handshake phase".to_owned()),
        }
    }

    async fn on_frame(&mut self, text: &str) -> Result<(), String> {
        let Ok(frame) = serde_json::from_str::<Value>(text) else {
            return Ok(());
        };
        match frame.get("t").and_then(Value::as_str) {
            Some("data") => {
                let (Some(conn), Some(data)) = (
                    frame.get("from").and_then(Value::as_str),
                    frame.get("d").and_then(Value::as_str),
                ) else {
                    return Ok(());
                };
                let pairing_token = self.peers.get(conn).and_then(Peer::pairing_token);
                if self.on_data(conn, data).is_err() {
                    if let Some(token) = pairing_token {
                        self.end_pairing(&token);
                        self.deny_pair(conn);
                    } else {
                        self.drop_session(conn, CLOSE_SESSION);
                    }
                }
            }
            Some("allow-ack") => {
                if let Some(id) = frame.get("id").and_then(Value::as_str) {
                    self.confirm_grant(id).await?;
                }
            }
            Some("peer") if frame.get("online").and_then(Value::as_bool) == Some(false) => {
                if let Some(conn) = frame.get("conn").and_then(Value::as_str) {
                    self.peers.remove(conn);
                    self.forget_online(conn);
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn drop_session(&mut self, conn: &str, code: u16) {
        self.outbox
            .push(json!({"t": "disconnect", "conn": conn, "code": code}));
        self.peers.insert(conn.to_owned(), Peer::Closed);
        self.forget_online(conn);
    }

    fn forget_online(&self, conn: &str) {
        if let Ok(mut online) = self.inner.online.lock() {
            online.remove(conn);
        }
        self.inner.notify_changed();
    }

    fn on_outgoing(&mut self, outgoing: Outgoing) {
        match outgoing {
            Outgoing::Frame(frame) => self.outbox.push(frame),
            Outgoing::BeginPairing { pairing, reply } => {
                self.inner.end_pairing();
                let token = pairing.token;
                *self
                    .inner
                    .pairing
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(pairing);
                self.register(
                    crypto::sha256_hex(&token),
                    true,
                    Registration::Pairing { token, reply },
                );
                self.inner.notify_changed();
            }
            Outgoing::ToPeer { conn, message } => {
                if let Some(Peer::Ready(ready)) = self.peers.get_mut(&conn) {
                    if let Ok(frames) = seal_frames(ready, &conn, &message) {
                        self.outbox.extend(frames);
                    }
                }
            }
            Outgoing::Broadcast(message) => {
                for (conn, peer) in &mut self.peers {
                    if let Peer::Ready(ready) = peer {
                        if let Ok(frames) = seal_frames(ready, conn, &message) {
                            self.outbox.extend(frames);
                        }
                    }
                }
            }
            Outgoing::PairAnswer { conn, allow } => {
                let token = self.peers.get(&conn).and_then(Peer::pairing_token);
                if self.finish_pair(&conn, allow).is_err() {
                    self.deny_pair(&conn);
                    if let Some(token) = token {
                        self.end_pairing(&token);
                    }
                }
            }
            Outgoing::Disconnect { client_id } => {
                let conns: Vec<String> = self
                    .peers
                    .iter()
                    .filter(|(_, peer)| match peer {
                        Peer::AwaitHello3 { client_id: id, .. } => *id == client_id,
                        Peer::Ready(ready) => ready.client_id == client_id,
                        _ => false,
                    })
                    .map(|(conn, _)| conn.clone())
                    .collect();
                for conn in conns {
                    self.drop_session(&conn, CLOSE_UNPAIRED);
                }
            }
        }
    }
}

/// A native dialog, so that the page, which renders untrusted content, cannot approve a device.
fn ask_user(inner: Arc<Inner>, conn: String, name: String, code: String) {
    let is_english = inner
        .context
        .lock()
        .is_ok_and(|context| context.language.as_deref() == Some("en"));
    let (title, body, allow, deny) = if is_english {
        (
            "Pair this device?".to_owned(),
            format!(
                "{name} wants to control this computer's agents.\n\nCheck that it shows this code: {code}"
            ),
            "Allow",
            "Deny",
        )
    } else {
        (
            "允许这台设备配对吗？".to_owned(),
            format!("{name} 请求远程使用这台电脑上的 Agent。\n\n请确认它显示的确认码是：{code}"),
            "允许",
            "拒绝",
        )
    };
    #[cfg(debug_assertions)]
    if std::env::var_os("TANDEM_DRIVE_PAIR_ALLOW").is_some() {
        inner.send(Outgoing::PairAnswer { conn, allow: true });
        return;
    }
    let app = inner.app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let answer = app
            .dialog()
            .message(body)
            .title(title)
            .buttons(MessageDialogButtons::OkCancelCustom(
                allow.to_owned(),
                deny.to_owned(),
            ))
            .blocking_show();
        inner.send(Outgoing::PairAnswer {
            conn,
            allow: answer,
        });
    });
}

fn relay_close_message(code: Option<u16>) -> String {
    match code {
        Some(4401) => "部署令牌不正确".to_owned(),
        Some(1011) => "中转无法写入数据目录。请确认这个目录存在，并且容器可以写入".to_owned(),
        Some(4429) => "连接过于频繁，请稍后再试".to_owned(),
        Some(4409) => "另一台电脑占用了这个中转房间".to_owned(),
        Some(code) => format!("中转关闭了连接（{code}）"),
        None => "中转关闭了连接".to_owned(),
    }
}

fn relay_version(frame: &Value) -> Option<String> {
    let version = frame.get("relayVersion")?.as_str()?;
    let parts: Vec<_> = version.split('.').collect();
    (version.len() <= 64
        && parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit())))
    .then(|| version.to_owned())
}

async fn connect_once(
    inner: &Arc<Inner>,
    receiver: &mut mpsc::UnboundedReceiver<Outgoing>,
) -> Result<(), (String, bool)> {
    let config = inner.lock_config().clone();
    let plain = |error: String| (error, false);
    let (mut socket, _) = tokio::time::timeout(
        HELLO_TIMEOUT,
        tokio_tungstenite::connect_async(config.relay_url.as_str()),
    )
    .await
    .map_err(|_| plain("中转没有响应".to_owned()))?
    .map_err(|error| plain(error.to_string()))?;
    let hello = json!({"t": "host-hello", "v": 1, "room": config.room, "token": config.host_token});
    socket
        .send(Message::text(hello.to_string()))
        .await
        .map_err(|error| plain(error.to_string()))?;
    let ack = tokio::time::timeout(HELLO_TIMEOUT, socket.next())
        .await
        .map_err(|_| plain("中转没有响应".to_owned()))?;
    let frame = match ack {
        Some(Ok(Message::Text(text))) => serde_json::from_str::<Value>(&text)
            .ok()
            .filter(|frame| frame.get("t").and_then(Value::as_str) == Some("hello-ack"))
            .ok_or_else(|| plain("中转没有接受这个部署令牌".to_owned()))?,
        Some(Ok(Message::Close(frame))) => {
            return Err(plain(relay_close_message(
                frame.as_ref().map(|frame| u16::from(frame.code)),
            )));
        }
        None => return Err(plain(relay_close_message(None))),
        _ => return Err(plain("中转没有接受这个部署令牌".to_owned())),
    };
    if let Ok(mut status) = inner.status.lock() {
        status.relay_version = relay_version(&frame);
    }
    // What was queued while offline was meant for connections that no longer exist.
    while receiver.try_recv().is_ok() {}

    let mut link = Link {
        inner: inner.clone(),
        peers: HashMap::new(),
        grants: HashMap::new(),
        restoring: true,
        outbox: Vec::new(),
    };
    link.restore_clients();
    let mut last_heard = Instant::now();
    let mut ping = tokio::time::interval(PING_EVERY);
    loop {
        for frame in link.outbox.drain(..) {
            socket
                .send(Message::text(frame.to_string()))
                .await
                .map_err(|error| plain(error.to_string()))?;
        }
        let grant_deadline = link.grants.values().map(|grant| grant.deadline).min();
        tokio::select! {
            incoming = socket.next() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    last_heard = Instant::now();
                    link.on_frame(&text).await.map_err(plain)?;
                }
                Some(Ok(Message::Close(frame))) => {
                    let code = frame.as_ref().map(|frame| u16::from(frame.code));
                    return Err((relay_close_message(code), code == Some(CLOSE_REPLACED)));
                }
                Some(Ok(_)) => last_heard = Instant::now(),
                Some(Err(error)) => return Err(plain(error.to_string())),
                None => return Err(plain(relay_close_message(None))),
            },
            outgoing = receiver.recv() => match outgoing {
                Some(outgoing) => link.on_outgoing(outgoing),
                None => return Ok(()),
            },
            _ = async {
                if let Some(deadline) = grant_deadline { tokio::time::sleep_until(deadline.into()).await; }
                else { std::future::pending::<()>().await; }
            } => return Err(plain("中转没有确认令牌登记".to_owned())),
            _ = ping.tick() => {
                if last_heard.elapsed() > SILENCE_LIMIT {
                    return Err(plain("中转停止响应".to_owned()));
                }
                socket.send(Message::Ping(Vec::new().into())).await.map_err(|error| plain(error.to_string()))?;
            }
        }
    }
}

pub(super) async fn run(inner: Arc<Inner>, mut receiver: mpsc::UnboundedReceiver<Outgoing>) {
    let mut backoff = Duration::from_secs(1);
    loop {
        inner.set_status(LinkStatus::Connecting, None);
        let started = Instant::now();
        let wait = match connect_once(&inner, &mut receiver).await {
            Ok(()) => return,
            Err((error, replaced)) => {
                inner.end_pairing();
                if let Ok(mut online) = inner.online.lock() {
                    online.clear();
                }
                crate::diagnostics::error("remote", format!("relay connection failed: {error}"));
                inner.set_status(LinkStatus::Failed, Some(error));
                if replaced { REPLACED_WAIT } else { backoff }
            }
        };
        tokio::time::sleep(wait).await;
        backoff = if started.elapsed() > MAX_BACKOFF {
            Duration::from_secs(1)
        } else {
            (backoff * 2).min(MAX_BACKOFF)
        };
    }
}

#[cfg(test)]
mod version_tests {
    use super::*;
    #[test]
    fn reads_relay_version_and_accepts_an_ack_from_an_older_relay() {
        assert_eq!(
            relay_version(&json!({"t":"hello-ack","relayVersion":"0.1.2026111102"})),
            Some("0.1.2026111102".into())
        );
        for frame in [
            json!({"t":"hello-ack"}),
            json!({"relayVersion":""}),
            json!({"relayVersion":"1.2"}),
            json!({"relayVersion":"1.2.3\n"}),
            json!({"relayVersion":12}),
            json!({"relayVersion":"<script>"}),
        ] {
            assert_eq!(relay_version(&frame), None);
        }
    }
}

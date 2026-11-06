use crate::{
    protocol::*,
    store::{Receipt, Store},
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};
use subtle::ConstantTimeEq;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::tungstenite::{Message, protocol::CloseFrame};

#[derive(Clone)]
pub struct Outbox {
    tx: mpsc::UnboundedSender<Message>,
    pending: Arc<AtomicUsize>,
    pub closing: watch::Sender<Option<u16>>,
}

impl Outbox {
    pub fn new() -> (
        Self,
        mpsc::UnboundedReceiver<Message>,
        watch::Receiver<Option<u16>>,
    ) {
        let (tx, rx) = mpsc::unbounded_channel();
        let (closing, close_rx) = watch::channel(None);
        (
            Self {
                tx,
                pending: Arc::new(AtomicUsize::new(0)),
                closing,
            },
            rx,
            close_rx,
        )
    }
    pub fn close(&self, code: u16) {
        let changed = self.closing.send_if_modified(|current| {
            if current.is_some() {
                return false;
            }
            *current = Some(code);
            true
        });
        if changed {
            let _ = self.tx.send(Message::Close(Some(CloseFrame {
                code: code.into(),
                reason: "".into(),
            })));
        }
    }
    pub fn send(&self, frame: Value) {
        self.enqueue(Message::Text(frame.to_string().into()));
    }
    pub fn enqueue(&self, message: Message) {
        if self.closing.borrow().is_some() {
            return;
        }
        let size = message.len();
        if self.pending.fetch_add(size, Ordering::AcqRel) + size > MAX_PENDING {
            self.pending.fetch_sub(size, Ordering::AcqRel);
            self.close(1013);
            return;
        }
        if self.tx.send(message).is_err() {
            self.pending.fetch_sub(size, Ordering::AcqRel);
        }
    }
    pub fn delivered(&self, bytes: usize) {
        self.pending.fetch_sub(bytes, Ordering::AcqRel);
    }
}

#[derive(Clone)]
pub struct Peer {
    pub id: String,
    pub room: String,
    pub host: bool,
    hash: String,
    pub out: Outbox,
}

struct Failures {
    count: usize,
    until: u64,
}
pub struct Hub {
    pub grants: HashMap<String, Grant>,
    pub peers: HashMap<String, Peer>,
    hosts: HashMap<String, String>,
    failures: HashMap<String, Failures>,
    host_digest: [u8; 32],
    store: Store,
}

impl Hub {
    pub fn new(grants: HashMap<String, Grant>, host_token: &str, store: Store) -> Self {
        Self {
            grants,
            peers: HashMap::new(),
            hosts: HashMap::new(),
            failures: HashMap::new(),
            host_digest: digest(host_token.as_bytes()),
            store,
        }
    }
    pub fn limited(&self, ip: &str, now: u64) -> bool {
        self.failures
            .get(ip)
            .is_some_and(|f| f.until > now && f.count >= 10)
    }
    pub fn fail(&mut self, ip: &str, now: u64) -> u16 {
        let entry = self.failures.entry(ip.into()).or_insert(Failures {
            count: 0,
            until: now + 60_000,
        });
        if entry.until <= now {
            *entry = Failures {
                count: 0,
                until: now + 60_000,
            };
        }
        entry.count += 1;
        if entry.count >= 10 { 4429 } else { 4401 }
    }
    pub fn prune(&mut self, now: u64) {
        self.failures.retain(|_, f| f.until > now);
        self.grants
            .retain(|_, g| g.expires_at.is_none_or(|expiry| expiry > now));
    }
    fn host(&self, room: &str) -> Option<&Peer> {
        self.hosts.get(room).and_then(|id| self.peers.get(id))
    }

    pub fn admit(&mut self, f: &Value, out: Outbox, now: u64) -> Result<Peer, u16> {
        if f.get("v").and_then(Value::as_u64) != Some(1) {
            return Err(4400);
        }
        let room = string(f, "room")
            .filter(|s| decode(s, 16).is_some())
            .ok_or(4401u16)?;
        let token = string(f, "token").ok_or(4401u16)?;
        let host = string(f, "t") == Some("host-hello");
        let hash = if host {
            if !bool::from(digest(token.as_bytes()).ct_eq(&self.host_digest)) {
                return Err(4401);
            }
            String::new()
        } else {
            if string(f, "t") != Some("client-hello") {
                return Err(4401);
            }
            let hash = token_hash(token).ok_or(4401u16)?;
            let grant = self
                .grants
                .get(&hash)
                .filter(|g| g.room == room && g.expires_at.is_none_or(|expiry| expiry > now))
                .ok_or(4401u16)?;
            if self
                .peers
                .values()
                .filter(|p| !p.host && p.room == room)
                .count()
                >= 8
            {
                return Err(4429);
            }
            if grant.one_time {
                self.grants.remove(&hash);
            }
            hash
        };
        let peer = Peer {
            id: uuid::Uuid::new_v4().to_string(),
            room: room.into(),
            host,
            hash,
            out,
        };
        if host {
            if let Some(previous) = self.host(room) {
                previous.out.close(4409);
            }
            self.hosts.insert(room.into(), peer.id.clone());
            for p in self.peers.values().filter(|p| !p.host && p.room == room) {
                p.out.send(json!({"t":"host","online":true}));
            }
        }
        peer.out.send(
            json!({"t":"hello-ack","conn":peer.id,"hostOnline":self.hosts.contains_key(room)}),
        );
        if !host && let Some(host) = self.host(room) {
            host.out
                .send(json!({"t":"peer","conn":peer.id,"online":true}));
        }
        self.peers.insert(peer.id.clone(), peer.clone());
        Ok(peer)
    }

    fn remove_grant(&mut self, room: &str, hash: &str) {
        if self.grants.get(hash).is_some_and(|g| g.room == room) {
            self.grants.remove(hash);
        }
        for peer in self
            .peers
            .values()
            .filter(|p| !p.host && p.room == room && p.hash == hash)
        {
            peer.out.close(4410);
        }
    }

    pub fn process(&mut self, peer: &Peer, f: &Value, now: u64) -> Result<Option<Receipt>, u16> {
        // Revocation can race with a frame already read from the socket.
        if peer.out.closing.borrow().is_some() {
            return Ok(None);
        }
        match string(f, "t") {
            Some("allow") if peer.host => {
                let hash = string(f, "tokenHash")
                    .filter(|s| valid_hash(s))
                    .ok_or(4400u16)?;
                let one_time = f.get("oneTime").and_then(Value::as_bool).ok_or(4400u16)?;
                let expiry = grant_expiry(one_time, f, now)?;
                if f.get("id")
                    .is_some_and(|id| id.as_str().is_none_or(|id| id.is_empty() || id.len() > 128))
                {
                    return Err(4400);
                }
                if self.grants.get(hash).is_some_and(|g| g.room != peer.room) {
                    return Err(4401);
                }
                let was_persistent = self.grants.get(hash).is_some_and(|g| !g.one_time);
                self.grants.insert(
                    hash.into(),
                    Grant {
                        room: peer.room.clone(),
                        one_time,
                        expires_at: expiry,
                    },
                );
                Ok((!one_time || was_persistent).then(|| self.store.persist(&self.grants)))
            }
            Some("revoke") if peer.host => {
                let hash = string(f, "tokenHash")
                    .filter(|s| valid_hash(s))
                    .ok_or(4400u16)?;
                self.remove_grant(&peer.room, hash);
                Ok(Some(self.store.persist(&self.grants)))
            }
            Some("allow-sync") if peer.host => {
                let hashes = f
                    .get("tokenHashes")
                    .and_then(Value::as_array)
                    .ok_or(4400u16)?;
                if !hashes.iter().all(|h| h.as_str().is_some_and(valid_hash)) {
                    return Err(4400);
                }
                let keep: std::collections::HashSet<&str> = hashes
                    .iter()
                    .map(|h| h.as_str().expect("hashes were validated"))
                    .collect();
                let remove: Vec<_> = self
                    .grants
                    .iter()
                    .filter(|(h, g)| {
                        g.room == peer.room && !g.one_time && !keep.contains(h.as_str())
                    })
                    .map(|(h, _)| h.clone())
                    .collect();
                for hash in remove {
                    self.remove_grant(&peer.room, &hash);
                }
                Ok(Some(self.store.persist(&self.grants)))
            }
            Some("disconnect") if peer.host => {
                let conn = string(f, "conn").ok_or(4400u16)?;
                let code = match f.get("code") {
                    None => 4411,
                    Some(value) => value
                        .as_u64()
                        .filter(|code| matches!(code, 4410 | 4411))
                        .ok_or(4400u16)? as u16,
                };
                if let Some(target) = self
                    .peers
                    .get(conn)
                    .filter(|p| !p.host && p.room == peer.room)
                {
                    target.out.close(code);
                }
                Ok(None)
            }
            Some("data") => {
                let data = string(f, "d").filter(|s| valid_data(s)).ok_or(4400u16)?;
                if peer.host {
                    let to = string(f, "to").filter(|s| !s.is_empty()).ok_or(4400u16)?;
                    if let Some(target) = self
                        .peers
                        .get(to)
                        .filter(|p| !p.host && p.room == peer.room)
                    {
                        target.out.send(json!({"t":"data","d":data}));
                    }
                } else if let Some(host) = self.host(&peer.room) {
                    host.out.send(json!({"t":"data","from":peer.id,"d":data}));
                } else {
                    peer.out.send(json!({"t":"error","code":"HOST_OFFLINE"}));
                }
                Ok(None)
            }
            _ => Err(4400),
        }
    }

    pub fn disconnected(&mut self, peer: &Peer) {
        self.peers.remove(&peer.id);
        if peer.host && self.hosts.get(&peer.room) == Some(&peer.id) {
            self.hosts.remove(&peer.room);
            for p in self
                .peers
                .values()
                .filter(|p| !p.host && p.room == peer.room)
            {
                p.out.send(json!({"t":"host","online":false}));
            }
        } else if !peer.host
            && let Some(host) = self.host(&peer.room)
        {
            host.out
                .send(json!({"t":"peer","conn":peer.id,"online":false}));
        }
    }
}

pub fn string<'a>(frame: &'a Value, key: &str) -> Option<&'a str> {
    frame.get(key).and_then(Value::as_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pending_bytes_include_the_inflight_message_and_close_at_limit() {
        let (out, mut rx, close) = Outbox::new();
        out.enqueue(Message::Text("x".repeat(MAX_PENDING).into()));
        assert!(rx.try_recv().is_ok());
        out.enqueue(Message::Text("x".into()));
        assert_eq!(*close.borrow(), Some(1013));
    }
    #[tokio::test]
    async fn ip_failure_windows_expire() {
        let dir = tempfile::tempdir().unwrap();
        let (store, grants, task) = Store::open(dir.path().join("data.json")).await.unwrap();
        let mut hub = Hub::new(grants, "host", store);
        for _ in 0..9 {
            assert_eq!(hub.fail("ip", 1000), 4401);
        }
        assert_eq!(hub.fail("ip", 1000), 4429);
        assert!(hub.limited("ip", 1001));
        assert!(!hub.limited("other", 1001));
        assert!(!hub.limited("ip", 61_000));
        assert_eq!(hub.fail("ip", 61_000), 4401);
        drop(hub);
        task.await.unwrap();
    }
}

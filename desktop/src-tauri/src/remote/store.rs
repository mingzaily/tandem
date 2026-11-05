//! What remote access keeps on disk. Losing this file only means pairing the phones again.

use super::crypto;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;

const FILE_MODE: u32 = 0o600;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedClient {
    pub client_id: String,
    pub public_key: String,
    pub name: String,
    pub paired_at_ms: u64,
    pub token_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub enabled: bool,
    pub relay_url: String,
    pub host_token: String,
    pub room: String,
    pub signing_key: String,
    pub clients: Vec<PairedClient>,
}

impl Config {
    fn fresh() -> Self {
        Self {
            enabled: false,
            relay_url: String::new(),
            host_token: String::new(),
            room: crypto::encode(&crypto::random_bytes::<16>()),
            signing_key: crypto::encode(&crypto::new_signing_key().to_bytes()),
            clients: Vec::new(),
        }
    }
}

pub fn load(path: &Path) -> Config {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Config>(&bytes).ok())
        .filter(|config| {
            let key = crypto::decode(&config.signing_key).ok();
            key.is_some_and(|key| crypto::signing_key_from(&key).is_ok())
        })
        .unwrap_or_else(Config::fresh)
}

/// The file holds a private key, so it is written whole and only its owner can read it.
pub fn save(path: &Path, config: &Config) -> Result<(), String> {
    let parent = path.parent().ok_or("The settings file has no folder")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("tmp");
    let bytes = serde_json::to_vec_pretty(config).map_err(|error| error.to_string())?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .mode(FILE_MODE)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    file.write_all(&bytes).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

/// Plain `ws://` would hand the tokens to anyone on the network, so it is for this machine only.
pub fn check_relay_url(url: &str) -> Result<(), String> {
    if url.starts_with("wss://") {
        return Ok(());
    }
    let host = url.strip_prefix("ws://").and_then(|rest| rest.split('/').next()).unwrap_or_default();
    let host = host.rsplit_once(':').map_or(host, |(name, _)| name);
    if matches!(host, "127.0.0.1" | "localhost" | "[::1]") {
        return Ok(());
    }
    Err("The relay address must start with wss://".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn saves_privately_and_loads_back() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("remote.json");
        let mut config = load(&path);
        assert!(!config.enabled);
        config.relay_url = "wss://relay.example".into();
        save(&path, &config).unwrap();
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, FILE_MODE);
        let loaded = load(&path);
        assert_eq!(loaded.relay_url, "wss://relay.example");
        assert_eq!(loaded.signing_key, config.signing_key);
    }

    #[test]
    fn a_damaged_file_starts_over() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("remote.json");
        fs::write(&path, "{half").unwrap();
        assert_eq!(load(&path).clients.len(), 0);
    }

    #[test]
    fn plain_websockets_are_only_for_this_machine() {
        assert!(check_relay_url("wss://relay.example/ws").is_ok());
        assert!(check_relay_url("ws://127.0.0.1:8787/ws").is_ok());
        assert!(check_relay_url("ws://relay.example/ws").is_err());
        assert!(check_relay_url("https://relay.example").is_err());
        assert!(check_relay_url("ws://localhost.evil.example/ws").is_err());
        assert!(check_relay_url("ws://127.0.0.1.evil.example:80/ws").is_err());
    }
}

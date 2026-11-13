//! What remote access keeps on disk. Losing this file only means pairing the phones again.

use super::crypto;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[cfg(test)]
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
    let bytes = serde_json::to_vec_pretty(config).map_err(|error| error.to_string())?;
    crate::storage::io::atomic_write(path, &bytes)
}

/// A domain is enough. `wss://` and `/ws` are added when omitted. Plain `ws://` stays local.
pub fn normalize_relay_url(input: &str) -> Result<String, String> {
    let input = input.trim();
    if input.is_empty() || input.chars().any(char::is_whitespace) {
        return Err("请填写中转域名".to_owned());
    }
    let (scheme, rest) = if let Some(rest) = input.strip_prefix("wss://") {
        ("wss", rest)
    } else if let Some(rest) = input.strip_prefix("ws://") {
        ("ws", rest)
    } else if let Some(rest) = input.strip_prefix("https://") {
        ("wss", rest)
    } else if let Some(rest) = input.strip_prefix("http://") {
        ("ws", rest)
    } else if input.contains("://") {
        return Err("中转地址只支持域名或 wss:// 地址".to_owned());
    } else {
        ("wss", input)
    };
    if rest.is_empty() || rest.contains(['?', '#', '@', '\\']) {
        return Err("中转域名不正确".to_owned());
    }
    let (authority, path) = match rest.split_once('/') {
        Some((authority, path)) => (
            authority,
            format!("/{path}").trim_end_matches('/').to_owned(),
        ),
        None => (rest, String::new()),
    };
    if authority.is_empty() || path.contains("//") {
        return Err("中转域名不正确".to_owned());
    }
    let (host, port) = relay_host(authority)?;
    if scheme == "ws" && !matches!(host, "127.0.0.1" | "localhost" | "::1") {
        return Err("公网中转请填写域名。未加密的 ws:// 只用于本机".to_owned());
    }
    if let Some(port) = port {
        let value: u16 = port.parse().map_err(|_| "中转端口不正确".to_owned())?;
        if value == 0 {
            return Err("中转端口不正确".to_owned());
        }
    }
    let path = if path.is_empty() {
        "/ws"
    } else {
        path.as_str()
    };
    Ok(format!("{scheme}://{authority}{path}"))
}

fn relay_host(authority: &str) -> Result<(&str, Option<&str>), String> {
    let invalid = || "中转域名不正确".to_owned();
    if let Some(rest) = authority.strip_prefix('[') {
        let (host, after) = rest.split_once(']').ok_or_else(invalid)?;
        if host.is_empty() {
            return Err(invalid());
        }
        let port = if after.is_empty() {
            None
        } else {
            Some(
                after
                    .strip_prefix(':')
                    .filter(|port| !port.is_empty())
                    .ok_or_else(invalid)?,
            )
        };
        return Ok((host, port));
    }
    match authority.rsplit_once(':') {
        Some((host, port))
            if !host.is_empty()
                && !port.is_empty()
                && port.bytes().all(|byte| byte.is_ascii_digit()) =>
        {
            Ok((host, Some(port)))
        }
        Some(_) => Err(invalid()),
        None => Ok((authority, None)),
    }
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
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            FILE_MODE
        );
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
    fn a_domain_becomes_the_secure_websocket_address() {
        assert_eq!(
            normalize_relay_url("relay.example.com").unwrap(),
            "wss://relay.example.com/ws"
        );
        assert_eq!(
            normalize_relay_url("  https://relay.example.com/ws/  ").unwrap(),
            "wss://relay.example.com/ws"
        );
        assert_eq!(
            normalize_relay_url("wss://relay.example.com/custom/ws").unwrap(),
            "wss://relay.example.com/custom/ws"
        );
        assert_eq!(
            normalize_relay_url("ws://127.0.0.1:8787").unwrap(),
            "ws://127.0.0.1:8787/ws"
        );
        assert_eq!(
            normalize_relay_url("http://[::1]:8787").unwrap(),
            "ws://[::1]:8787/ws"
        );
        assert!(normalize_relay_url("ws://relay.example/ws").is_err());
        assert!(normalize_relay_url("ws://localhost.evil.example/ws").is_err());
        assert!(normalize_relay_url("ws://127.0.0.1.evil.example:80/ws").is_err());
        assert!(normalize_relay_url("https://user@relay.example").is_err());
        assert!(normalize_relay_url("relay.example/ws?token=1").is_err());
    }
}

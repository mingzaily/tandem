use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_MESSAGE: usize = 2 * 1024 * 1024;
pub const HARD_MAX: usize = 2 * MAX_MESSAGE;
pub const MAX_HELLO: usize = 4096;
pub const MAX_PENDING: usize = 16 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Grant {
    pub room: String,
    pub one_time: bool,
    pub expires_at: Option<u64>,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is after epoch")
        .as_millis() as u64
}

pub fn decode(value: &str, size: usize) -> Option<Vec<u8>> {
    let bytes = URL_SAFE_NO_PAD.decode(value).ok()?;
    (bytes.len() == size).then_some(bytes)
}

pub fn digest(value: &[u8]) -> [u8; 32] {
    Sha256::digest(value).into()
}

pub fn token_hash(value: &str) -> Option<String> {
    let hash = digest(&decode(value, 32)?);
    Some(hash.iter().map(|b| format!("{b:02x}")).collect())
}

pub fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub fn valid_data(value: &str) -> bool {
    value
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub fn grant_expiry(one_time: bool, frame: &Value, now: u64) -> Result<Option<u64>, u16> {
    match (one_time, frame.get("ttlMs"), frame.get("expiresAt")) {
        (true, Some(ttl), None) => {
            let ttl = ttl
                .as_u64()
                .filter(|ttl| (1..=300_000).contains(ttl))
                .ok_or(4400u16)?;
            Ok(Some(now + ttl))
        }
        (true, None, Some(expiry)) => {
            let expiry = expiry
                .as_u64()
                .filter(|expiry| *expiry > now && *expiry <= now + 300_000)
                .ok_or(4400u16)?;
            Ok(Some(expiry))
        }
        (false, None, Some(Value::Null)) => Ok(None),
        _ => Err(4400),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn token_hashes_decoded_bytes_and_rejects_noncanonical_tokens() {
        let token = URL_SAFE_NO_PAD.encode([2; 32]);
        assert_eq!(
            token_hash(&token).unwrap(),
            "75877bb41d393b5fb8455ce60ecd8dda001d06316496b14dfa7f895656eeca4a"
        );
        assert!(token_hash(&(token + "=")).is_none());
        assert!(decode("AB", 1).is_none());
        assert!(!valid_hash(&"A".repeat(64)));
    }
    #[test]
    fn pairing_lifetime_and_permanent_grants() {
        use serde_json::json;
        assert_eq!(
            grant_expiry(true, &json!({"expiresAt": 301_000}), 1_000),
            Ok(Some(301_000))
        );
        assert!(grant_expiry(true, &json!({"expiresAt": 301_001}), 1_000).is_err());
        assert!(grant_expiry(true, &json!({"expiresAt": 1_000}), 1_000).is_err());
        assert!(grant_expiry(true, &json!({"expiresAt": null}), 1_000).is_err());
        assert_eq!(
            grant_expiry(false, &json!({"expiresAt": null}), 1_000),
            Ok(None)
        );
        assert!(grant_expiry(false, &json!({"expiresAt": 3_000}), 1_000).is_err());
    }

    #[test]
    fn relative_lifetime_uses_the_relay_clock_and_has_one_expiry_source() {
        use serde_json::json;
        for now in [1_000, 1_790_000_000_000] {
            assert_eq!(
                grant_expiry(true, &json!({"ttlMs": 300_000}), now),
                Ok(Some(now + 300_000))
            );
        }
        for ttl in [
            json!(0),
            json!(-1),
            json!(300_001),
            json!(1.5),
            json!("300000"),
            Value::Null,
        ] {
            assert!(grant_expiry(true, &json!({"ttlMs": ttl}), 1_000).is_err());
        }
        assert!(grant_expiry(true, &json!({"ttlMs": 100, "expiresAt": 1_100}), 1_000).is_err());
        assert!(grant_expiry(false, &json!({"ttlMs": 100}), 1_000).is_err());
    }
}

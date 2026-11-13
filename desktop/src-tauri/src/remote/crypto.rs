//! The key schedule from docs/relay-protocol.md, sections 5 and 6. Everything here is a pure
//! function of its inputs, so the shared test vectors can check it against the page's WebCrypto.

use aes_gcm::{Aes256Gcm, KeyInit, Nonce, aead::Aead, aead::Payload};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use p256::ecdsa::{Signature, SigningKey, VerifyingKey, signature::Signer, signature::Verifier};
use p256::{PublicKey, ecdh::EphemeralSecret};
use rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};

pub const POINT_BYTES: usize = 65;
const PAIR_LABEL: &[u8] = b"tandem-pair-v1";
const SESSION_LABEL: &[u8] = b"tandem-session-v1";
const PAIR4_AAD: &[u8] = b"tandem-pair4";
const MESSAGE_AAD: &[u8] = b"tandem-m-v1";

pub fn encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn decode(text: &str) -> Result<Vec<u8>, String> {
    URL_SAFE_NO_PAD
        .decode(text)
        .map_err(|_| "Bad base64".to_owned())
}

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0; N];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn hash(parts: &[&[u8]]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part);
    }
    hasher.finalize().into()
}

fn hkdf<const N: usize>(ikm: &[u8], salt: &[u8], info: &[&[u8]]) -> [u8; N] {
    let mut okm = [0; N];
    Hkdf::<Sha256>::new(Some(salt), ikm)
        .expand_multi_info(info, &mut okm)
        .expect("the output length is far below the HKDF limit");
    okm
}

fn hmac(key: &[u8], label: &[u8], data: &[u8]) -> [u8; 32] {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key).expect("HMAC takes any key length");
    mac.update(label);
    mac.update(data);
    mac.finalize().into_bytes().into()
}

/// A one-connection key. Returns the secret and its public point.
pub fn new_ephemeral() -> (EphemeralSecret, Vec<u8>) {
    let secret = EphemeralSecret::random(&mut OsRng);
    let public = secret.public_key().to_sec1_bytes().to_vec();
    (secret, public)
}

pub fn shared_secret(secret: &EphemeralSecret, peer: &[u8]) -> Result<[u8; 32], String> {
    let peer = parse_point(peer)?;
    let shared = secret.diffie_hellman(&peer);
    Ok((*shared.raw_secret_bytes()).into())
}

fn parse_point(bytes: &[u8]) -> Result<PublicKey, String> {
    if bytes.len() != POINT_BYTES {
        return Err("A public key has the wrong length".to_owned());
    }
    PublicKey::from_sec1_bytes(bytes).map_err(|_| "A public key is not on the curve".to_owned())
}

pub fn new_signing_key() -> SigningKey {
    SigningKey::random(&mut OsRng)
}

pub fn signing_key_from(bytes: &[u8]) -> Result<SigningKey, String> {
    SigningKey::from_slice(bytes).map_err(|_| "The saved signing key is not valid".to_owned())
}

pub fn public_point(key: &SigningKey) -> Vec<u8> {
    key.verifying_key()
        .to_encoded_point(false)
        .as_bytes()
        .to_vec()
}

pub fn sign(key: &SigningKey, label: &[u8], th: &[u8]) -> Vec<u8> {
    let signature: Signature = key.sign(&[label, th].concat());
    signature.to_bytes().to_vec()
}

pub fn verify(point: &[u8], label: &[u8], th: &[u8], signature: &[u8]) -> Result<(), String> {
    parse_point(point)?;
    let key = VerifyingKey::from_sec1_bytes(point).map_err(|_| "Bad public key".to_owned())?;
    let signature = Signature::from_slice(signature).map_err(|_| "Bad signature".to_owned())?;
    key.verify(&[label, th].concat(), &signature)
        .map_err(|_| "The signature does not match".to_owned())
}

pub struct PairKeys {
    pub mac_host: [u8; 32],
    pub mac_client: [u8; 32],
    pub aes: [u8; 32],
    pub code: String,
}

pub fn pair_transcript(e_c: &[u8], s_c: &[u8], e_h: &[u8], s_h: &[u8]) -> [u8; 32] {
    hash(&[PAIR_LABEL, e_c, s_c, e_h, s_h])
}

pub fn pair_keys(shared: &[u8], secret: &[u8], th: &[u8; 32]) -> PairKeys {
    let okm: [u8; 96] = hkdf(shared, secret, &[PAIR_LABEL, th]);
    let part = |start: usize| -> [u8; 32] { okm[start..start + 32].try_into().expect("32 bytes") };
    let number = u32::from_be_bytes(th[..4].try_into().expect("4 bytes")) % 1_000_000;
    PairKeys {
        mac_host: part(0),
        mac_client: part(32),
        aes: part(64),
        code: format!("{number:06}"),
    }
}

pub fn mac_host(keys: &PairKeys, th: &[u8]) -> [u8; 32] {
    hmac(&keys.mac_host, b"host", th)
}

pub fn mac_client(keys: &PairKeys, th: &[u8]) -> [u8; 32] {
    hmac(&keys.mac_client, b"client", th)
}

/// Compares without stopping at the first difference.
pub fn same_bytes(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .fold(0, |seen, (a, b)| seen | (a ^ b))
            == 0
}

pub fn seal_pair4(aes: &[u8; 32], plain: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(aes).map_err(|error| error.to_string())?;
    cipher
        .encrypt(
            Nonce::from_slice(&[0; 12]),
            Payload {
                msg: plain,
                aad: PAIR4_AAD,
            },
        )
        .map_err(|_| "Encryption failed".to_owned())
}

pub fn session_transcript(
    client_id: &[u8],
    e_c: &[u8],
    e_h: &[u8],
    s_c: &[u8],
    s_h: &[u8],
) -> [u8; 32] {
    hash(&[SESSION_LABEL, client_id, e_c, e_h, s_c, s_h])
}

/// Client-to-host key, then host-to-client key.
pub fn session_keys(shared: &[u8], th: &[u8; 32]) -> ([u8; 32], [u8; 32]) {
    let okm: [u8; 64] = hkdf(shared, th, &[SESSION_LABEL]);
    (
        okm[..32].try_into().expect("32 bytes"),
        okm[32..].try_into().expect("32 bytes"),
    )
}

fn message_nonce(counter: u64) -> [u8; 12] {
    let mut nonce = [0; 12];
    nonce[4..].copy_from_slice(&counter.to_be_bytes());
    nonce
}

pub fn seal_message(key: &[u8; 32], counter: u64, plain: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|error| error.to_string())?;
    cipher
        .encrypt(
            Nonce::from_slice(&message_nonce(counter)),
            Payload {
                msg: plain,
                aad: MESSAGE_AAD,
            },
        )
        .map_err(|_| "Encryption failed".to_owned())
}

pub fn open_message(key: &[u8; 32], counter: u64, sealed: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|error| error.to_string())?;
    cipher
        .decrypt(
            Nonce::from_slice(&message_nonce(counter)),
            Payload {
                msg: sealed,
                aad: MESSAGE_AAD,
            },
        )
        .map_err(|_| "A message did not decrypt".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_sides_of_a_handshake_reach_the_same_keys() {
        let (client, e_c) = new_ephemeral();
        let (host, e_h) = new_ephemeral();
        let shared = shared_secret(&client, &e_h).unwrap();
        assert_eq!(shared, shared_secret(&host, &e_c).unwrap());
        let th = session_transcript(b"id", &e_c, &e_h, &e_c, &e_h);
        let (c2h, h2c) = session_keys(&shared, &th);
        assert_ne!(c2h, h2c);
        let sealed = seal_message(&c2h, 7, b"hello").unwrap();
        assert_eq!(open_message(&c2h, 7, &sealed).unwrap(), b"hello");
    }

    #[test]
    fn a_message_only_opens_with_its_own_key_and_counter() {
        let key = [1; 32];
        let mut sealed = seal_message(&key, 1, b"hello").unwrap();
        assert!(open_message(&key, 2, &sealed).is_err());
        assert!(open_message(&[2; 32], 1, &sealed).is_err());
        sealed[0] ^= 1;
        assert!(open_message(&key, 1, &sealed).is_err());
    }

    #[test]
    fn signatures_are_bound_to_their_label_and_key() {
        let key = new_signing_key();
        let point = public_point(&key);
        assert_eq!(point.len(), POINT_BYTES);
        let signature = sign(&key, b"host", b"th");
        assert_eq!(signature.len(), 64);
        assert!(verify(&point, b"host", b"th", &signature).is_ok());
        assert!(verify(&point, b"client", b"th", &signature).is_err());
        assert!(
            verify(
                &public_point(&new_signing_key()),
                b"host",
                b"th",
                &signature
            )
            .is_err()
        );
    }

    #[test]
    fn the_pair_code_always_has_six_digits() {
        let keys = pair_keys(&[1; 32], &[2; 32], &[0; 32]);
        assert_eq!(keys.code, "000000");
        assert!(same_bytes(&mac_host(&keys, b"t"), &mac_host(&keys, b"t")));
        assert!(!same_bytes(
            &mac_host(&keys, b"t"),
            &mac_client(&keys, b"t")
        ));
    }

    #[test]
    fn rejects_a_point_of_the_wrong_length_or_off_the_curve() {
        let (secret, _) = new_ephemeral();
        assert!(shared_secret(&secret, &[4; 10]).is_err());
        assert!(shared_secret(&secret, &[4; POINT_BYTES]).is_err());
    }

    /// The same file the page's WebCrypto is tested against, so the two cannot drift apart.
    const VECTORS: &str = include_str!("../../../../docs/relay-test-vectors.json");

    fn vector_bytes(value: &serde_json::Value, path: &str) -> Vec<u8> {
        let text = value.pointer(path).and_then(serde_json::Value::as_str);
        decode(text.unwrap_or_else(|| panic!("no {path}"))).unwrap()
    }

    fn vector_shared(vectors: &serde_json::Value) -> [u8; 32] {
        let secret =
            p256::SecretKey::from_slice(&vector_bytes(vectors, "/privateKeys/ec/d")).unwrap();
        let peer = PublicKey::from_sec1_bytes(&vector_bytes(vectors, "/publicKeys/eh")).unwrap();
        let shared = p256::ecdh::diffie_hellman(secret.to_nonzero_scalar(), peer.as_affine());
        (*shared.raw_secret_bytes()).into()
    }

    #[test]
    fn matches_the_shared_pairing_vectors() {
        let v: serde_json::Value = serde_json::from_str(VECTORS).unwrap();
        let (e_c, s_c) = (
            vector_bytes(&v, "/publicKeys/ec"),
            vector_bytes(&v, "/publicKeys/sc"),
        );
        let (e_h, s_h) = (
            vector_bytes(&v, "/publicKeys/eh"),
            vector_bytes(&v, "/publicKeys/sh"),
        );
        let th = pair_transcript(&e_c, &s_c, &e_h, &s_h);
        assert_eq!(th.to_vec(), vector_bytes(&v, "/pair/th"));
        let keys = pair_keys(&vector_shared(&v), &vector_bytes(&v, "/secret"), &th);
        assert_eq!(
            mac_host(&keys, &th).to_vec(),
            vector_bytes(&v, "/pair/macH")
        );
        assert_eq!(
            mac_client(&keys, &th).to_vec(),
            vector_bytes(&v, "/pair/macC")
        );
        assert_eq!(keys.code, v["pair"]["code"].as_str().unwrap());
        assert!(verify(&s_c, b"", &th, &vector_bytes(&v, "/pair/signature")).is_ok());
        let plain = v["pair"]["plaintext"].as_str().unwrap();
        assert_eq!(
            seal_pair4(&keys.aes, plain.as_bytes()).unwrap(),
            vector_bytes(&v, "/pair/ciphertext")
        );
    }

    #[test]
    fn matches_the_shared_session_vectors() {
        let v: serde_json::Value = serde_json::from_str(VECTORS).unwrap();
        let (e_c, s_c) = (
            vector_bytes(&v, "/publicKeys/ec"),
            vector_bytes(&v, "/publicKeys/sc"),
        );
        let (e_h, s_h) = (
            vector_bytes(&v, "/publicKeys/eh"),
            vector_bytes(&v, "/publicKeys/sh"),
        );
        let th = session_transcript(&vector_bytes(&v, "/clientId"), &e_c, &e_h, &s_c, &s_h);
        assert_eq!(th.to_vec(), vector_bytes(&v, "/session/th"));
        let (c2h, h2c) = session_keys(&vector_shared(&v), &th);
        assert_eq!([c2h, h2c].concat(), vector_bytes(&v, "/session/okm"));
        assert!(
            verify(
                &s_h,
                b"host",
                &th,
                &vector_bytes(&v, "/session/hostSignature")
            )
            .is_ok()
        );
        assert!(
            verify(
                &s_c,
                b"client",
                &th,
                &vector_bytes(&v, "/session/clientSignature")
            )
            .is_ok()
        );
        let counter = v["session"]["n"].as_u64().unwrap();
        let sealed = vector_bytes(&v, "/session/ciphertext");
        // The first byte is the chunk flag, the rest is the message.
        let opened = open_message(&c2h, counter, &sealed).unwrap();
        assert_eq!(opened[0], 0);
        assert_eq!(
            &opened[1..],
            v["session"]["plaintext"].as_str().unwrap().as_bytes()
        );
    }
}

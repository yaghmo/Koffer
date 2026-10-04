//! The sealed channel between the app and a paired browser.
//!
//! The browser signs what it sends, which tells the app who is asking. It
//! told the browser nothing about who was listening: with the app closed,
//! any program on the machine can take the bridge's port, and the extension
//! would post it every login page's address and every password the user
//! typed, in the clear.
//!
//! So pairing also agrees a key. Each side makes a P-256 pair, they swap
//! public points, and ECDH plus HKDF-SHA-256 gives both the same AES-256-GCM
//! key without it ever crossing the wire. Every request after `/pair` is
//! sealed under it and so is every answer: a squatter on the port reads
//! ciphertext, and cannot make an answer the extension will accept.
//!
//! The key sits in the vault beside the browser's public key, so a locked
//! app cannot open a request, which is the same `401` a locked app gave
//! before.

use crate::crypto::{decrypt_with_aad, encrypt_with_aad, random_bytes};
use base64::Engine;
use p256::{PublicKey, SecretKey};
use sha2::Sha256;

/// Names the protocol in the key derivation, so this key is good for
/// nothing else. `vault.js` has the same string.
const INFO: &[u8] = b"koffer-bridge-v1";

/// Which way a message is going. Part of what the tag covers, so a request
/// cannot be played back to the browser as an answer.
#[derive(Clone, Copy)]
pub enum Dir {
    Request,
    Reply,
}

fn aad(path: &str, dir: Dir) -> Vec<u8> {
    let dir = match dir {
        Dir::Request => "request",
        Dir::Reply => "reply",
    };
    format!("{path}\n{dir}").into_bytes()
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn from_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 || s.len() > 512 || !s.is_ascii() {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

/// The channel key as the vault stores it, or None for a pairing made
/// before there was one.
pub fn key_from_hex(hex: &str) -> Option<[u8; 32]> {
    from_hex(hex)?.try_into().ok()
}

fn derive(secret: &SecretKey, public: &PublicKey) -> [u8; 32] {
    let shared = p256::ecdh::diffie_hellman(secret.to_nonzero_scalar(), public.as_affine());
    let mut key = [0u8; 32];
    // The raw ECDH output is not uniformly random; HKDF makes it a key.
    shared
        .extract::<Sha256>(None)
        .expand(INFO, &mut key)
        .expect("32 bytes is a valid HKDF-SHA-256 output length");
    key
}

/// The app's half of pairing: a fresh key pair against the browser's public
/// point. Returns the app's public point (hex, for the browser) and the
/// channel key (hex, for the vault). None when the point is not on P-256.
pub fn agree(browser_public_hex: &str) -> Option<(String, String)> {
    let browser = PublicKey::from_sec1_bytes(&from_hex(browser_public_hex)?).ok()?;
    // A random 32 bytes is a valid scalar all but never; redraw if not.
    let secret = loop {
        if let Ok(s) = SecretKey::from_slice(&random_bytes(32)) {
            break s;
        }
    };
    let public = secret.public_key().to_sec1_bytes();
    Some((to_hex(&public), to_hex(&derive(&secret, &browser))))
}

/// Seal one message: `{"n": nonce hex, "c": ciphertext base64}`.
pub fn seal(key: &[u8; 32], path: &str, dir: Dir, plaintext: &str) -> String {
    let (nonce, ct) = encrypt_with_aad(key, plaintext.as_bytes(), &aad(path, dir));
    serde_json::json!({
        "n": to_hex(&nonce),
        "c": base64::engine::general_purpose::STANDARD.encode(ct),
    })
    .to_string()
}

/// Open one sealed message. None for anything this key, path and direction
/// did not seal.
pub fn open(key: &[u8; 32], path: &str, dir: Dir, body: &serde_json::Value) -> Option<String> {
    let nonce = from_hex(body.get("n")?.as_str()?)?;
    if nonce.len() != 12 {
        return None;
    }
    let ct = base64::engine::general_purpose::STANDARD
        .decode(body.get("c")?.as_str()?)
        .ok()?;
    let plain = decrypt_with_aad(key, &nonce, &ct, &aad(path, dir)).ok()?;
    String::from_utf8(plain).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pair(seed: u8) -> (SecretKey, String) {
        let mut scalar = [1u8; 32];
        scalar[31] = seed;
        let sk = SecretKey::from_slice(&scalar).unwrap();
        let public = to_hex(&sk.public_key().to_sec1_bytes());
        (sk, public)
    }

    fn parsed(sealed: &str) -> serde_json::Value {
        serde_json::from_str(sealed).unwrap()
    }

    #[test]
    fn both_sides_reach_the_same_key_without_sending_it() {
        let (browser, browser_public) = pair(7);
        let (app_public, key) = agree(&browser_public).unwrap();
        let app = PublicKey::from_sec1_bytes(&from_hex(&app_public).unwrap()).unwrap();
        assert_eq!(to_hex(&derive(&browser, &app)), key);
    }

    #[test]
    fn the_extension_reaches_this_key() {
        // The other half is `channelKey` in extension/vault.js, checked
        // against these same values in src/__tests__/channel.test.ts.
        let (browser, _) = pair(7);
        let (app, _) = pair(9);
        let key = derive(&app, &browser.public_key());
        assert_eq!(to_hex(&key), "93fb5037245bc7b7a4a656559e7f703b899856bc263e8b034eca6dbba6a12cf3");
        assert_eq!(derive(&browser, &app.public_key()), key);
    }

    #[test]
    fn two_pairings_never_share_a_key() {
        let (_, browser_public) = pair(7);
        assert_ne!(agree(&browser_public).unwrap().1, agree(&browser_public).unwrap().1);
    }

    #[test]
    fn a_point_off_the_curve_agrees_nothing() {
        assert!(agree("").is_none());
        assert!(agree(&"04".repeat(65)).is_none());
        assert!(agree("not hex").is_none());
    }

    #[test]
    fn what_is_sealed_opens_again() {
        let key = [9u8; 32];
        let sealed = seal(&key, "/offer", Dir::Request, r#"{"password":"hunter2"}"#);
        assert!(!sealed.contains("hunter2"));
        assert_eq!(
            open(&key, "/offer", Dir::Request, &parsed(&sealed)).as_deref(),
            Some(r#"{"password":"hunter2"}"#)
        );
    }

    #[test]
    fn a_listener_without_the_key_reads_nothing() {
        let sealed = seal(&[9u8; 32], "/offer", Dir::Request, "secret");
        assert!(open(&[8u8; 32], "/offer", Dir::Request, &parsed(&sealed)).is_none());
    }

    #[test]
    fn a_message_is_good_for_its_own_path_and_direction_only() {
        let key = [9u8; 32];
        let sealed = parsed(&seal(&key, "/matches", Dir::Request, "{}"));
        assert!(open(&key, "/credentials", Dir::Request, &sealed).is_none());
        // A request handed back as if it were the app's answer.
        assert!(open(&key, "/matches", Dir::Reply, &sealed).is_none());
    }

    #[test]
    fn a_plain_or_broken_body_does_not_open() {
        let key = [9u8; 32];
        for body in [
            serde_json::json!({}),
            serde_json::json!({ "origin": "https://bank.test" }),
            serde_json::json!({ "n": "00", "c": "AAAA" }),
            serde_json::json!({ "n": "zz".repeat(12), "c": "AAAA" }),
            serde_json::json!({ "n": "00".repeat(12), "c": "not base64!" }),
        ] {
            assert!(open(&key, "/matches", Dir::Request, &body).is_none(), "{body}");
        }
    }
}

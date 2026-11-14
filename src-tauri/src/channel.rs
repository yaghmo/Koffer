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
//! An answer is also bound to the one request it answers: its tag covers
//! that request's nonce. A program that recorded an answer off loopback
//! cannot hand it back later, to a different request on the same path, and
//! have a password for one site filled on another.
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
/// cannot be played back to the browser as an answer. An answer carries the
/// nonce of the request it answers, so it opens for that request only.
#[derive(Clone, Copy)]
pub enum Dir {
    Request,
    Reply([u8; 12]),
}

fn aad(path: &str, dir: Dir) -> Vec<u8> {
    match dir {
        Dir::Request => format!("{path}\nrequest"),
        Dir::Reply(n) => format!("{path}\nreply\n{}", to_hex(&n)),
    }
    .into_bytes()
}

/// The nonce of a sealed request, decoded rather than copied, so the binding
/// is always 24 lowercase hex characters whatever case the sender used.
pub fn nonce(body: &serde_json::Value) -> Option<[u8; 12]> {
    from_hex(body.get("n")?.as_str()?)?.try_into().ok()
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
/// did not seal, and for an answer sealed for a different request.
pub fn open(key: &[u8; 32], path: &str, dir: Dir, body: &serde_json::Value) -> Option<String> {
    let nonce = nonce(body)?;
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
        assert!(open(&key, "/matches", Dir::Reply([0; 12]), &sealed).is_none());
    }

    #[test]
    fn a_reply_opens_only_for_the_request_it_answers() {
        let key = [9u8; 32];
        let (a, b) = ([1u8; 12], [2u8; 12]);
        let reply = parsed(&seal(&key, "/credentials", Dir::Reply(a), "site A"));
        assert_eq!(open(&key, "/credentials", Dir::Reply(a), &reply).as_deref(), Some("site A"));
        // The same recorded reply, offered as the answer to a later request.
        assert!(open(&key, "/credentials", Dir::Reply(b), &reply).is_none());
    }

    #[test]
    fn the_binding_is_the_lowercase_nonce_whatever_case_arrived() {
        let key = [9u8; 32];
        let nonce_hex = "0a1b2c3d4e5f60718293a4b5";
        let upper = serde_json::json!({ "n": nonce_hex.to_uppercase() });
        let n = nonce(&upper).unwrap();
        assert_eq!(to_hex(&n), nonce_hex);
        // What the extension binds to: the hex of the iv it generated.
        let lower = nonce(&serde_json::json!({ "n": nonce_hex })).unwrap();
        let reply = parsed(&seal(&key, "/matches", Dir::Reply(n), "{}"));
        assert!(open(&key, "/matches", Dir::Reply(lower), &reply).is_some());
        assert_eq!(aad("/matches", Dir::Reply(n)), format!("/matches\nreply\n{nonce_hex}").into_bytes());
        assert_eq!(aad("/matches", Dir::Request), b"/matches\nrequest");
    }

    #[test]
    fn a_nonce_of_the_wrong_length_is_nothing() {
        assert!(nonce(&serde_json::json!({ "n": "00" })).is_none());
        assert!(nonce(&serde_json::json!({})).is_none());
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

    #[test]
    fn the_fixed_vector_opens_to_the_same_plaintext_as_in_the_extension() {
        // The same values are in src/__tests__/channel.test.ts, which opens
        // them with vault.js. If either side changes what a reply's tag
        // covers, one of the two stops opening. Fake key, fake plaintext.
        let key = [0x2a; 32];
        let reply = serde_json::json!({
            "n": "53e977b159a899bb8ca73ed4",
            "c": "FaOQo6cgzxv/Xv1fPthp9apFV/vyCDFFzZ4AK+DJml12x26YIec5ZW/ADh7GzqbxTgifLassmcuICUoGAN9rdzMkIiM=",
        });
        let request_nonce = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
        assert_eq!(
            open(&key, "/credentials", Dir::Reply(request_nonce), &reply).as_deref(),
            Some(r#"{"username":"fake","password":"not-a-real-password"}"#)
        );
        assert!(open(&key, "/credentials", Dir::Reply([0; 12]), &reply).is_none());
    }

}

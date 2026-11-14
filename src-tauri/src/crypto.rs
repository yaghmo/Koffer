//! Cryptographic primitives: random, KDF, AEAD.

use getrandom::getrandom;

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("encryption/decryption failed")]
    Aead,
}

/// Cryptographically secure random bytes.
pub fn random_bytes(len: usize) -> Vec<u8> {
    let mut buf = vec![0u8; len];
    getrandom(&mut buf).expect("OS RNG failure");
    buf
}

use argon2::{Argon2, Params, Algorithm, Version};

/// Derive a 256-bit key from a password using Argon2id.
/// Params: m=64 MiB, t=3, p=1.
pub fn derive_key(password: &str, salt: &[u8]) -> [u8; 32] {
    let params = Params::new(64 * 1024, 3, 1, Some(32))
        .expect("valid Argon2 params");
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut out)
        .expect("Argon2id hashing failed");
    out
}

/// Encrypt with AES-256-GCM. Returns (nonce, ciphertext_with_appended_tag).
pub fn encrypt(key: &[u8; 32], plaintext: &[u8]) -> (Vec<u8>, Vec<u8>) {
    encrypt_with_aad(key, plaintext, b"")
}

/// Encrypt, additionally authenticating `aad` (associated data that travels
/// in the clear — the vault file header). The tag then covers it, so editing
/// the header is detected instead of merely breaking decryption.
pub fn encrypt_with_aad(key: &[u8; 32], plaintext: &[u8], aad: &[u8]) -> (Vec<u8>, Vec<u8>) {
    let cipher = Aes256Gcm::new(key.into());
    let nonce_bytes = random_bytes(12);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(nonce, Payload { msg: plaintext, aad })
        .expect("AES-GCM encrypt should not fail with random nonce");
    (nonce_bytes, ct)
}

/// Decrypt with AES-256-GCM.
pub fn decrypt(key: &[u8; 32], nonce: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, CryptoError> {
    decrypt_with_aad(key, nonce, ciphertext, b"")
}

pub fn decrypt_with_aad(
    key: &[u8; 32],
    nonce: &[u8],
    ciphertext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    // Nonce::from_slice panics on any other length; a damaged file or a
    // hostile peer must get an error, not a crash.
    if nonce.len() != 12 {
        return Err(CryptoError::Aead);
    }
    let cipher = Aes256Gcm::new(key.into());
    let nonce = Nonce::from_slice(nonce);
    cipher
        .decrypt(nonce, Payload { msg: ciphertext, aad })
        .map_err(|_| CryptoError::Aead)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_bytes_returns_requested_length() {
        let b = random_bytes(16);
        assert_eq!(b.len(), 16);
    }

    #[test]
    fn random_bytes_produces_different_values() {
        let a = random_bytes(32);
        let b = random_bytes(32);
        assert_ne!(a, b, "two random 32-byte buffers should not be equal");
    }

    #[test]
    fn derive_key_returns_32_bytes() {
        let salt = random_bytes(16);
        let k = derive_key("correct horse battery staple", &salt);
        assert_eq!(k.len(), 32);
    }

    #[test]
    fn derive_key_is_deterministic() {
        let salt = random_bytes(16);
        let k1 = derive_key("hunter2", &salt);
        let k2 = derive_key("hunter2", &salt);
        assert_eq!(k1, k2);
    }

    #[test]
    fn derive_key_differs_with_different_salt() {
        let s1 = random_bytes(16);
        let s2 = random_bytes(16);
        let k1 = derive_key("hunter2", &s1);
        let k2 = derive_key("hunter2", &s2);
        assert_ne!(k1, k2);
    }

    #[test]
    fn derive_key_differs_with_different_password() {
        let salt = random_bytes(16);
        let k1 = derive_key("hunter2", &salt);
        let k2 = derive_key("hunter3", &salt);
        assert_ne!(k1, k2);
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let key = derive_key("password", &random_bytes(16));
        let pt = b"hello world";
        let (nonce, ct) = encrypt(&key, pt);
        let out = decrypt(&key, &nonce, &ct).unwrap();
        assert_eq!(out, pt);
    }

    #[test]
    fn decrypt_with_wrong_key_fails() {
        let k1 = derive_key("password", &random_bytes(16));
        let k2 = derive_key("different", &random_bytes(16));
        let (nonce, ct) = encrypt(&k1, b"secret");
        assert!(decrypt(&k2, &nonce, &ct).is_err());
    }

    #[test]
    fn decrypt_tampered_ciphertext_fails() {
        let key = derive_key("password", &random_bytes(16));
        let (nonce, mut ct) = encrypt(&key, b"secret");
        let last = ct.len() - 1;
        ct[last] ^= 0x01;
        assert!(decrypt(&key, &nonce, &ct).is_err());
    }

    #[test]
    fn aad_must_match_to_decrypt() {
        let key = derive_key("password", &random_bytes(16));
        let (nonce, ct) = encrypt_with_aad(&key, b"secret", b"header-v2");
        assert_eq!(
            decrypt_with_aad(&key, &nonce, &ct, b"header-v2").unwrap(),
            b"secret"
        );
        assert!(decrypt_with_aad(&key, &nonce, &ct, b"header-v3").is_err());
        // And a no-AAD read of AAD-protected bytes fails too, which is what
        // keeps the two file versions apart.
        assert!(decrypt(&key, &nonce, &ct).is_err());
    }

    #[test]
    fn a_nonce_of_the_wrong_length_is_an_error_not_a_panic() {
        let key = derive_key("password", &random_bytes(16));
        let (nonce, ct) = encrypt(&key, b"x");
        for bad in [0usize, 1, 11, 13, 64] {
            let n = vec![nonce[0]; bad];
            assert!(decrypt(&key, &n, &ct).is_err(), "len {bad}");
        }
    }

    #[test]
    fn encrypt_uses_fresh_nonce_each_time() {
        let key = derive_key("password", &random_bytes(16));
        // encrypt returns (nonce, ciphertext) — binding the second element
        // here only proved the ciphertext differed, which a hardcoded nonce
        // would also satisfy.
        let (n1, _) = encrypt(&key, b"x");
        let (n2, _) = encrypt(&key, b"x");
        assert_ne!(n1, n2);
    }
}

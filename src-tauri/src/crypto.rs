//! Cryptographic primitives: random, KDF, AEAD.

use getrandom::getrandom;

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
}

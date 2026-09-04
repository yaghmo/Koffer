//! Cryptographic primitives: random, KDF, AEAD.

use getrandom::getrandom;

/// Cryptographically secure random bytes.
pub fn random_bytes(len: usize) -> Vec<u8> {
    let mut buf = vec![0u8; len];
    getrandom(&mut buf).expect("OS RNG failure");
    buf
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
}

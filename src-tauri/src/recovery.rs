//! Recovery codes: a second key to the vault, written on paper.
//!
//! 128 random bits in Crockford base32 (no I, L, O or U, so nothing reads as
//! a digit and nothing spells a word), plus a 20-bit CRC so a mistyped code
//! is rejected immediately instead of after a two-second Argon2 derivation
//! that "just" fails.
//!
//! Displayed as 6 groups of 5:  `K7F2Q 9MRXB 4TWHE 3NYD8 P6VJS 2GZK5`

use crate::crypto::random_bytes;
use thiserror::Error;

/// Crockford's alphabet: digits plus consonants, minus the letters that get
/// confused with them.
const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

pub const SECRET_BYTES: usize = 16;
const CHECK_CHARS: usize = 4;
const DATA_CHARS: usize = 26; // ceil(128 / 5)
pub const CODE_CHARS: usize = DATA_CHARS + CHECK_CHARS;

#[derive(Debug, Error, PartialEq)]
pub enum RecoveryError {
    #[error("recovery code must be {CODE_CHARS} characters")]
    WrongLength,
    #[error("recovery code contains an invalid character")]
    BadCharacter,
    #[error("recovery code is not valid — check for a mistyped character")]
    BadChecksum,
}

/// CRC-32 (IEEE), computed without a table. Only used to catch typos.
fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for b in bytes {
        crc ^= *b as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

fn to_base32(bits: &[u8], chars: usize) -> String {
    let mut out = String::with_capacity(chars);
    let mut acc: u32 = 0;
    let mut have = 0;
    let mut i = 0;
    while out.len() < chars {
        while have < 5 {
            let byte = if i < bits.len() { bits[i] } else { 0 };
            i += 1;
            acc = (acc << 8) | byte as u32;
            have += 8;
        }
        let index = ((acc >> (have - 5)) & 0x1F) as usize;
        have -= 5;
        out.push(ALPHABET[index] as char);
    }
    out
}

fn value_of(c: char) -> Option<u8> {
    // Crockford treats these as the digits they look like.
    let c = match c.to_ascii_uppercase() {
        'I' | 'L' => '1',
        'O' => '0',
        other => other,
    };
    ALPHABET.iter().position(|a| *a as char == c).map(|p| p as u8)
}

fn checksum_chars(secret: &[u8]) -> String {
    // Low 20 bits of the CRC, which is exactly 4 base32 characters.
    let sum = crc32(secret) & 0x000F_FFFF;
    to_base32(&sum.to_be_bytes()[1..], CHECK_CHARS)
}

/// A fresh random recovery secret and the code that represents it.
pub fn generate() -> ([u8; SECRET_BYTES], String) {
    let bytes = random_bytes(SECRET_BYTES);
    let mut secret = [0u8; SECRET_BYTES];
    secret.copy_from_slice(&bytes);
    let code = encode(&secret);
    (secret, code)
}

pub fn encode(secret: &[u8; SECRET_BYTES]) -> String {
    format!("{}{}", to_base32(secret, DATA_CHARS), checksum_chars(secret))
}

/// Groups of five for printing. Never used as input — `decode` ignores
/// spacing, case and the confusable letters entirely.
pub fn format_for_display(code: &str) -> String {
    code.as_bytes()
        .chunks(5)
        .map(|c| String::from_utf8_lossy(c).to_string())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Parse a typed code back into its secret, rejecting typos via the checksum.
pub fn decode(input: &str) -> Result<[u8; SECRET_BYTES], RecoveryError> {
    let cleaned: Vec<char> = input.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    if cleaned.len() != CODE_CHARS {
        return Err(RecoveryError::WrongLength);
    }
    let mut values = Vec::with_capacity(CODE_CHARS);
    for c in &cleaned {
        values.push(value_of(*c).ok_or(RecoveryError::BadCharacter)?);
    }

    let mut secret = [0u8; SECRET_BYTES];
    let mut acc: u32 = 0;
    let mut have = 0;
    let mut out = 0;
    for v in values.iter().take(DATA_CHARS) {
        acc = (acc << 5) | *v as u32;
        have += 5;
        if have >= 8 && out < SECRET_BYTES {
            secret[out] = ((acc >> (have - 8)) & 0xFF) as u8;
            have -= 8;
            out += 1;
        }
    }

    let typed_check: String = cleaned[DATA_CHARS..].iter().collect();
    let expected = checksum_chars(&secret);
    // Compare on values, not characters, so "I" typed for "1" still matches.
    let same = typed_check
        .chars()
        .zip(expected.chars())
        .all(|(a, b)| value_of(a) == value_of(b));
    if !same {
        return Err(RecoveryError::BadChecksum);
    }
    Ok(secret)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_codes_round_trip() {
        for _ in 0..50 {
            let (secret, code) = generate();
            assert_eq!(code.len(), CODE_CHARS);
            assert_eq!(decode(&code).unwrap(), secret);
        }
    }

    #[test]
    fn display_groups_of_five() {
        let (_, code) = generate();
        let shown = format_for_display(&code);
        assert_eq!(shown.split(' ').count(), 6);
        assert!(shown.split(' ').all(|g| g.len() == 5));
        assert_eq!(decode(&shown).unwrap(), decode(&code).unwrap());
    }

    #[test]
    fn accepts_lowercase_and_confusable_letters() {
        let secret = [7u8; SECRET_BYTES];
        let code = encode(&secret);
        let typed = code
            .to_lowercase()
            .replace('1', "l")
            .replace('0', "o");
        assert_eq!(decode(&typed).unwrap(), secret);
    }

    #[test]
    fn rejects_a_single_mistyped_character() {
        let (_, code) = generate();
        let mut chars: Vec<char> = code.chars().collect();
        // Swap one data character for a different one.
        chars[3] = if chars[3] == '7' { '9' } else { '7' };
        let typo: String = chars.into_iter().collect();
        assert_eq!(decode(&typo), Err(RecoveryError::BadChecksum));
    }

    #[test]
    fn rejects_transposed_characters() {
        let (_, code) = generate();
        let mut chars: Vec<char> = code.chars().collect();
        if chars[5] == chars[6] {
            return; // nothing to transpose
        }
        chars.swap(5, 6);
        let typo: String = chars.into_iter().collect();
        assert_eq!(decode(&typo), Err(RecoveryError::BadChecksum));
    }

    #[test]
    fn rejects_wrong_length_and_bad_characters() {
        let (_, code) = generate();
        assert_eq!(decode(&code[..CODE_CHARS - 1]), Err(RecoveryError::WrongLength));
        let bad = format!("{}U", &code[..CODE_CHARS - 1]);
        assert_eq!(decode(&bad), Err(RecoveryError::BadCharacter));
    }

    #[test]
    fn two_codes_are_never_the_same() {
        let (a, _) = generate();
        let (b, _) = generate();
        assert_ne!(a, b);
    }
}

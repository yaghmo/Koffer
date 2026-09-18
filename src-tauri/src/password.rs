//! Password generator. Always runs in Rust so the RNG is cryptographically secure.

use crate::crypto::random_bytes;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenOpts {
    pub length: usize,
    pub lower: bool,
    pub upper: bool,
    pub digits: bool,
    pub symbols: bool,
}

impl Default for GenOpts {
    fn default() -> Self {
        Self {
            length: 20,
            lower: true,
            upper: true,
            digits: true,
            symbols: true,
        }
    }
}

#[derive(Debug, Error)]
pub enum GenError {
    #[error("password length must be > 0")]
    ZeroLength,
    #[error("at least one character class must be enabled")]
    NoClasses,
    #[error("requested length too short to include all enabled classes")]
    TooShort,
}

/// Uniform index in `0..n`, without modulo bias.
///
/// `byte % n` favours the first `256 % n` values — with the full 88-character
/// alphabet that makes 80 of them 1.5x as likely as the other 8. Discarding
/// the bytes above the largest multiple of `n` removes the skew entirely, at
/// the cost of an occasional redraw.
fn uniform_below(n: usize) -> usize {
    assert!(n > 0 && n <= 256, "alphabet must fit in one byte");
    let limit = 256 - (256 % n);
    loop {
        let b = random_bytes(1)[0] as usize;
        if b < limit {
            return b % n;
        }
    }
}

const LOWER: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
const UPPER: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS: &[u8] = b"0123456789";
const SYMBOLS: &[u8] = b"!@#$%^&*()-_=+[]{};:,.<>?/";

pub fn generate(opts: &GenOpts) -> Result<String, GenError> {
    if opts.length == 0 {
        return Err(GenError::ZeroLength);
    }
    let mut classes: Vec<&[u8]> = Vec::new();
    if opts.lower {
        classes.push(LOWER);
    }
    if opts.upper {
        classes.push(UPPER);
    }
    if opts.digits {
        classes.push(DIGITS);
    }
    if opts.symbols {
        classes.push(SYMBOLS);
    }
    if classes.is_empty() {
        return Err(GenError::NoClasses);
    }
    if opts.length < classes.len() {
        return Err(GenError::TooShort);
    }

    // Ensure at least one of each enabled class is present, then fill the rest.
    let mut out: Vec<u8> = Vec::with_capacity(opts.length);
    for c in &classes {
        out.push(c[uniform_below(c.len())]);
    }
    let all: Vec<u8> = classes.iter().flat_map(|c| c.iter().copied()).collect();
    while out.len() < opts.length {
        out.push(all[uniform_below(all.len())]);
    }
    // Fisher-Yates shuffle with secure random
    for i in (1..out.len()).rev() {
        out.swap(i, uniform_below(i + 1));
    }
    Ok(String::from_utf8(out).expect("ASCII subset"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn default_opts_yields_20_chars() {
        let s = generate(&GenOpts::default()).unwrap();
        assert_eq!(s.len(), 20);
    }

    #[test]
    fn digits_only_contains_digits() {
        let s = generate(&GenOpts {
            length: 30,
            lower: false,
            upper: false,
            digits: true,
            symbols: false,
        })
        .unwrap();
        assert!(s.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn includes_all_enabled_classes() {
        let s = generate(&GenOpts::default()).unwrap();
        assert!(s.chars().any(|c| c.is_ascii_lowercase()));
        assert!(s.chars().any(|c| c.is_ascii_uppercase()));
        assert!(s.chars().any(|c| c.is_ascii_digit()));
        assert!(s.chars().any(|c| "!@#$%^&*()-_=+[]{};:,.<>?/".contains(c)));
    }

    #[test]
    fn rejects_zero_length() {
        assert!(matches!(
            generate(&GenOpts { length: 0, ..GenOpts::default() }),
            Err(GenError::ZeroLength)
        ));
    }

    #[test]
    fn rejects_no_classes() {
        assert!(matches!(
            generate(&GenOpts {
                length: 20,
                lower: false,
                upper: false,
                digits: false,
                symbols: false,
            }),
            Err(GenError::NoClasses)
        ));
    }

    #[test]
    fn rejects_length_shorter_than_class_count() {
        assert!(matches!(
            generate(&GenOpts {
                length: 2,
                lower: true,
                upper: true,
                digits: true,
                symbols: true,
            }),
            Err(GenError::TooShort)
        ));
    }

    #[test]
    fn uniform_below_stays_in_range_and_covers_it() {
        let mut seen = [0usize; 88];
        for _ in 0..8_800 {
            let i = uniform_below(88);
            assert!(i < 88);
            seen[i] += 1;
        }
        // Every slot should come up; a biased `% 88` would still pass this,
        // but an off-by-one in the limit would not.
        assert!(seen.iter().all(|c| *c > 0));
    }

    #[test]
    fn uniform_below_is_exact_for_a_power_of_two() {
        for _ in 0..1_000 {
            assert!(uniform_below(2) < 2);
        }
    }

    #[test]
    fn two_runs_differ() {
        let a = generate(&GenOpts::default()).unwrap();
        let b = generate(&GenOpts::default()).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn symbol_set_is_a_subset_of_allowed() {
        let allowed: HashSet<char> = "!@#$%^&*()-_=+[]{};:,.<>?/".chars().collect();
        let s = generate(&GenOpts {
            length: 50,
            lower: false,
            upper: false,
            digits: false,
            symbols: true,
        })
        .unwrap();
        for c in s.chars() {
            assert!(allowed.contains(&c), "unexpected char: {}", c);
        }
    }
}

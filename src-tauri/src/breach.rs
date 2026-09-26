//! Opt-in check of saved passwords against Have I Been Pwned's list of
//! passwords seen in data leaks.
//!
//! k-anonymity: a password is hashed here (SHA-1, as the service defines
//! it) and only the first five hex characters of that hash leave the
//! machine. The service answers with every leaked hash sharing that prefix,
//! several hundred of them, padded with fake entries so the answer's size
//! says nothing either, and the match happens here. Neither the password nor
//! its full hash is ever sent.
//!
//! It checks passwords, not accounts: a password in a leak list is in the
//! lists attackers try against every site, whichever site leaked it.

use sha1::{Digest, Sha1};
use std::collections::HashMap;
use zeroize::Zeroizing;

const RANGE_URL: &str = "https://api.pwnedpasswords.com/range/";

pub fn sha1_hex(password: &str) -> Zeroizing<String> {
    let digest = Sha1::digest(password.as_bytes());
    Zeroizing::new(digest.iter().map(|b| format!("{b:02X}")).collect())
}

/// How many times `suffix` appears in one range answer. Padding lines carry
/// a count of 0, so they never match as a leak.
pub fn count_in(body: &str, suffix: &str) -> u64 {
    body.lines()
        .filter_map(|line| line.trim().split_once(':'))
        .find(|(s, _)| s.eq_ignore_ascii_case(suffix))
        .and_then(|(_, n)| n.trim().parse().ok())
        .unwrap_or(0)
}

/// For each `(id, password)`, how many leaks it appears in. Only ids with at
/// least one leak come back. One request per distinct hash prefix.
pub async fn check(passwords: Vec<(String, Zeroizing<String>)>) -> Result<Vec<(String, u64)>, String> {
    let mut by_prefix: HashMap<String, Vec<(String, Zeroizing<String>)>> = HashMap::new();
    for (id, pw) in passwords {
        let hash = sha1_hex(&pw);
        by_prefix
            .entry(hash[..5].to_string())
            .or_default()
            .push((id, Zeroizing::new(hash[5..].to_string())));
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("password-manager-leak-check")
        .build()
        .map_err(|e| e.to_string())?;
    let mut leaked = Vec::new();
    for (prefix, entries) in by_prefix {
        let body = client
            .get(format!("{RANGE_URL}{prefix}"))
            .header("Add-Padding", "true")
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| format!("could not reach the leak list: {e}"))?
            .text()
            .await
            .map_err(|e| format!("could not read the leak list: {e}"))?;
        for (id, suffix) in entries {
            let n = count_in(&body, &suffix);
            if n > 0 {
                leaked.push((id, n));
            }
        }
    }
    Ok(leaked)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_the_way_the_service_expects() {
        assert_eq!(sha1_hex("password").as_str(), "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8");
    }

    #[test]
    fn reads_a_count_and_ignores_padding() {
        let body = "003D68EB55068C33ACE09247EE4C639306B:3\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\n0018A45C4D1DEF81644B54AB7F969B88D65:0\r\n";
        assert_eq!(count_in(body, "1E4C9B93F3F0682250B6CF8331B7EE68FD8"), 9_545_824);
        assert_eq!(count_in(body, "1e4c9b93f3f0682250b6cf8331b7ee68fd8"), 9_545_824);
        assert_eq!(count_in(body, "0018A45C4D1DEF81644B54AB7F969B88D65"), 0);
        assert_eq!(count_in(body, "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"), 0);
    }
}

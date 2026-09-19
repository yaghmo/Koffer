//! Offsite backup to a Cloudflare Worker the user owns.
//!
//! The blob uploaded is the ciphertext already on disk, so nothing here needs
//! the vault key and no new cryptography is involved. What this module does
//! own is the trust boundary: the URL is user-supplied, so it must be https,
//! and neither it nor the tokens may ever reach a log or an error message.

use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;

pub const MAX_BYTES: usize = 25 * 1024 * 1024;

const TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Serialize, Deserialize, PartialEq)]
pub struct BackupConfig {
    pub url: String,
    pub put_token: String,
}

// Hand-written so the token cannot reach a log or a panic message through a
// Debug print of this struct or of the Vault that embeds it.
impl std::fmt::Debug for BackupConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BackupConfig")
            .field("url", &"<redacted>")
            .field("put_token", &"<redacted>")
            .finish()
    }
}

/// Deliberately opaque. Every variant renders without the URL or the token,
/// because these strings reach the UI and the log.
#[derive(Debug, Error, PartialEq)]
pub enum CloudError {
    #[error("backup URL must start with https://")]
    InsecureUrl,
    #[error("backup URL is not a valid URL")]
    BadUrl,
    #[error("vault is too large to back up")]
    TooLarge,
    #[error("vault file is empty")]
    EmptyBlob,
    #[error("token rejected by the worker")]
    Unauthorized,
    #[error("no backup found")]
    NotFound,
    #[error("worker returned status {0}")]
    Status(u16),
    #[error("could not reach the worker")]
    Network,
}

pub fn validate_url(url: &str) -> Result<(), CloudError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(CloudError::BadUrl);
    }
    let parsed = reqwest::Url::parse(trimmed).map_err(|_| CloudError::BadUrl)?;
    match parsed.scheme() {
        "https" => {}
        "http" => return Err(CloudError::InsecureUrl),
        _ => return Err(CloudError::BadUrl),
    }
    if parsed.host_str().is_none() {
        return Err(CloudError::BadUrl);
    }
    Ok(())
}

fn endpoint(base: &str) -> String {
    format!("{}/vault", base.trim().trim_end_matches('/'))
}

fn client() -> Result<reqwest::Client, CloudError> {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        // A single /vault endpoint has no legitimate reason to redirect, and
        // following one would re-send the vault to a host validate_url never
        // checked — including an http:// one.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| CloudError::Network)
}

fn classify(status: reqwest::StatusCode) -> CloudError {
    match status.as_u16() {
        401 | 403 => CloudError::Unauthorized,
        404 => CloudError::NotFound,
        413 => CloudError::TooLarge,
        other => CloudError::Status(other),
    }
}

pub async fn upload(cfg: &BackupConfig, blob: Vec<u8>) -> Result<(), CloudError> {
    validate_url(&cfg.url)?;
    if blob.is_empty() {
        return Err(CloudError::EmptyBlob);
    }
    if blob.len() > MAX_BYTES {
        return Err(CloudError::TooLarge);
    }
    let res = client()?
        .put(endpoint(&cfg.url))
        .bearer_auth(&cfg.put_token)
        .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
        .body(blob)
        .send()
        .await
        .map_err(|_| CloudError::Network)?;

    if res.status().is_success() {
        Ok(())
    } else {
        Err(classify(res.status()))
    }
}

pub async fn download(url: &str, get_token: &str) -> Result<Vec<u8>, CloudError> {
    validate_url(url)?;
    let mut res = client()?
        .get(endpoint(url))
        .bearer_auth(get_token)
        .send()
        .await
        .map_err(|_| CloudError::Network)?;

    if !res.status().is_success() {
        return Err(classify(res.status()));
    }
    // Trust the declared length only as an early out; the real check is on the
    // bytes actually received.
    if let Some(len) = res.content_length() {
        if len > MAX_BYTES as u64 {
            return Err(CloudError::TooLarge);
        }
    }
    let mut out: Vec<u8> = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|_| CloudError::Network)? {
        if out.len() + chunk.len() > MAX_BYTES {
            return Err(CloudError::TooLarge);
        }
        out.extend_from_slice(&chunk);
    }
    if out.is_empty() {
        return Err(CloudError::NotFound);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn https_urls_are_accepted() {
        assert!(validate_url("https://vault-backup.example.workers.dev").is_ok());
    }

    #[test]
    fn plain_http_is_rejected() {
        // The vault would otherwise cross the network in the clear at the
        // transport layer, whatever the ciphertext inside says.
        assert!(matches!(
            validate_url("http://vault-backup.example.workers.dev"),
            Err(CloudError::InsecureUrl)
        ));
    }

    #[test]
    fn garbage_urls_are_rejected() {
        assert!(validate_url("not a url").is_err());
        assert!(validate_url("").is_err());
        assert!(validate_url("ftp://example.com").is_err());
    }

    #[test]
    fn endpoint_appends_the_vault_path() {
        assert_eq!(endpoint("https://w.example.dev"), "https://w.example.dev/vault");
        // A trailing slash must not produce a double slash.
        assert_eq!(endpoint("https://w.example.dev/"), "https://w.example.dev/vault");
    }

    #[test]
    fn errors_never_contain_the_token_or_url() {
        let secret = "super-secret-token";
        let url = "https://private-worker.example.dev";
        for e in [
            CloudError::InsecureUrl,
            CloudError::BadUrl,
            CloudError::TooLarge,
            CloudError::EmptyBlob,
            CloudError::Unauthorized,
            CloudError::NotFound,
            CloudError::Status(500),
            CloudError::Network,
        ] {
            let rendered = e.to_string();
            assert!(!rendered.contains(secret), "error leaked the token: {rendered}");
            assert!(!rendered.contains("private-worker"), "error leaked the url: {rendered}");
        }
        let _ = (secret, url);
    }

    #[test]
    fn upload_rejects_an_oversized_blob_without_a_request() {
        let cfg = BackupConfig {
            url: "https://w.example.dev".into(),
            put_token: "t".into(),
        };
        // A URL with nothing listening: if this ever returns a network
        // error instead of TooLarge, the size check ran too late.
        let big = vec![0u8; MAX_BYTES + 1];
        let out = tauri::async_runtime::block_on(upload(&cfg, big));
        assert!(matches!(out, Err(CloudError::TooLarge)));
    }

    #[test]
    fn upload_rejects_an_empty_blob() {
        let cfg = BackupConfig {
            url: "https://w.example.dev".into(),
            put_token: "t".into(),
        };
        let out = tauri::async_runtime::block_on(upload(&cfg, Vec::new()));
        assert!(matches!(out, Err(CloudError::EmptyBlob)));
    }

    #[test]
    fn download_rejects_an_insecure_url_before_connecting() {
        let out = tauri::async_runtime::block_on(download("http://w.example.dev", "t"));
        assert!(matches!(out, Err(CloudError::InsecureUrl)));
    }

    #[test]
    fn debug_output_redacts_the_token_and_url() {
        let cfg = BackupConfig {
            url: "https://private-worker.example.dev".into(),
            put_token: "super-secret-token".into(),
        };
        let rendered = format!("{cfg:?}");
        assert!(!rendered.contains("super-secret-token"));
        assert!(!rendered.contains("private-worker"));
    }
}

//! URL metadata fetcher for login items.
//!
//! Scrapes target site for favicon + title when user pastes a link into
//! the editor. Returns favicon as data URL and title for auto-fill.

use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr};
use thiserror::Error;

/// Page bytes read for title/favicon discovery; <head> sits well inside this.
const MAX_HTML_BYTES: usize = 1024 * 1024;
/// Favicons are stored in the vault as data URLs, so keep them small.
const MAX_ICON_BYTES: usize = 256 * 1024;

#[derive(Debug, Error)]
pub enum MetadataError {
    #[error("http request failed: {0}")]
    Request(String),
    #[error("parse failed: {0}")]
    Parse(String),
}

#[derive(Debug, Clone, Serialize)]
pub struct UrlMetadata {
    pub title: Option<String>,
    pub favicon_data_url: Option<String>,
}

/// Fetch URL metadata: title + favicon as data URL.
/// Timeout 5s. Missing fields return None (not error).
pub async fn fetch_metadata(url: &str) -> Result<UrlMetadata, MetadataError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .user_agent("Mozilla/5.0")
        // Re-check every hop so a public page can't redirect into the LAN.
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                attempt.error("too many redirects")
            } else if is_public_http(attempt.url()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(req_err)?;

    // A page cut off at the cap still has its <head>; parse what arrived.
    let (html, _) = get_capped(&client, url, MAX_HTML_BYTES).await?;
    let html = String::from_utf8_lossy(&html);

    let title = extract_title(&html);
    let favicon_href = extract_favicon(&html, url);

    let favicon_data_url = if let Some(href) = favicon_href {
        fetch_favicon(&client, &href).await.ok()
    } else {
        None
    };

    Ok(UrlMetadata {
        title,
        favicon_data_url,
    })
}

fn extract_title(html: &str) -> Option<String> {
    // ponytail: regex cheaper than full HTML parser for one tag
    let re = regex::Regex::new(r"(?i)<title[^>]*>([^<]+)</title>").ok()?;
    re.captures(html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string())
        .filter(|s| !s.is_empty())
}

fn extract_favicon(html: &str, base_url: &str) -> Option<String> {
    // Look for <link rel="icon"> or <link rel="shortcut icon">
    let re = regex::Regex::new(
        r#"(?i)<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']"#,
    )
    .ok()?;
    if let Some(cap) = re.captures(html) {
        let href = cap.get(1)?.as_str();
        return Some(resolve_url(href, base_url));
    }

    // Fallback: /favicon.ico at root
    let base = reqwest::Url::parse(base_url).ok()?;
    Some(format!("{}://{}/favicon.ico", base.scheme(), base.host_str()?))
}

fn resolve_url(href: &str, base: &str) -> String {
    if href.starts_with("http://") || href.starts_with("https://") {
        href.to_string()
    } else if href.starts_with("//") {
        format!("https:{}", href)
    } else if href.starts_with('/') {
        let base_url = reqwest::Url::parse(base).ok();
        if let Some(u) = base_url {
            format!("{}://{}{}", u.scheme(), u.host_str().unwrap_or(""), href)
        } else {
            href.to_string()
        }
    } else {
        // Relative path — join with base
        reqwest::Url::parse(base)
            .and_then(|u| u.join(href))
            .map(|u| u.to_string())
            .unwrap_or_else(|_| href.to_string())
    }
}

async fn fetch_favicon(client: &reqwest::Client, url: &str) -> Result<String, MetadataError> {
    let (bytes, truncated) = get_capped(client, url, MAX_ICON_BYTES).await?;
    if truncated {
        return Err(MetadataError::Request("favicon too large".to_string()));
    }

    // ponytail: no mime sniff, assume image. Browser decodes it.
    let b64 = base64_encode(&bytes);
    Ok(format!("data:image/x-icon;base64,{}", b64))
}

fn req_err(e: reqwest::Error) -> MetadataError {
    MetadataError::Request(e.to_string())
}

/// GET a public http(s) URL, reading at most `max` body bytes. Returns the
/// bytes and whether the body was cut off at the cap.
async fn get_capped(
    client: &reqwest::Client,
    url: &str,
    max: usize,
) -> Result<(Vec<u8>, bool), MetadataError> {
    let parsed = reqwest::Url::parse(url).map_err(|e| MetadataError::Parse(e.to_string()))?;
    if !is_public_http(&parsed) {
        return Err(MetadataError::Request(
            "only public http(s) addresses are fetched".to_string(),
        ));
    }
    let mut resp = client.get(parsed).send().await.map_err(req_err)?;
    let mut buf = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(req_err)? {
        let room = max - buf.len();
        if chunk.len() > room {
            buf.extend_from_slice(&chunk[..room]);
            return Ok((buf, true));
        }
        buf.extend_from_slice(&chunk);
    }
    Ok((buf, false))
}

/// True for http(s) URLs whose host is not loopback, private, link-local, or
/// otherwise local.
/// ponytail: checks the literal host only; a public DNS name that resolves to
/// a LAN address (DNS rebinding) still passes. Resolve and pin the IP if that
/// threat ever matters.
fn is_public_http(url: &reqwest::Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") {
        return false;
    }
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => is_public_v4(ip),
        Ok(IpAddr::V6(ip)) => match ip.to_ipv4_mapped() {
            Some(v4) => is_public_v4(v4),
            None => {
                let first = ip.segments()[0];
                !(ip.is_loopback()
                    || ip.is_unspecified()
                    || (first & 0xfe00) == 0xfc00 // unique local fc00::/7
                    || (first & 0xffc0) == 0xfe80) // link-local fe80::/10
            }
        },
        Err(_) => true, // domain name
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    !(ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || a == 0
        || (a == 100 && (b & 0xc0) == 64)) // CGNAT / Tailscale 100.64.0.0/10
}

fn base64_encode(bytes: &[u8]) -> String {
    use base64::{engine::general_purpose, Engine as _};
    general_purpose::STANDARD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_title_from_html() {
        let html = "<html><head><title>  Twitch   </title></head></html>";
        assert_eq!(extract_title(html).as_deref(), Some("Twitch"));
    }

    #[test]
    fn missing_title_returns_none() {
        assert_eq!(extract_title("<html><body></body></html>"), None);
    }

    #[test]
    fn extracts_favicon_href() {
        let html = r#"<link rel="icon" href="/favicon.ico">"#;
        let got = extract_favicon(html, "https://twitch.tv").unwrap();
        assert_eq!(got, "https://twitch.tv/favicon.ico");
    }

    #[test]
    fn favicon_falls_back_to_root_ico() {
        let got = extract_favicon("<html></html>", "https://example.com/path").unwrap();
        assert_eq!(got, "https://example.com/favicon.ico");
    }

    #[test]
    fn only_public_http_hosts_are_fetchable() {
        let ok = |u: &str| is_public_http(&reqwest::Url::parse(u).unwrap());
        assert!(ok("https://example.com/login"));
        assert!(ok("http://93.184.216.34/"));
        for bad in [
            "file:///C:/Windows/win.ini",
            "ftp://example.com/",
            "http://localhost:1420/",
            "http://app.localhost/",
            "http://printer.local/",
            "http://127.0.0.1/",
            "http://2130706433/", // 127.0.0.1 in decimal
            "http://0.0.0.0/",
            "http://10.0.0.5/",
            "http://192.168.1.1/",
            "http://169.254.169.254/",
            "http://100.100.1.1/",
            "http://[::1]/",
            "http://[::ffff:127.0.0.1]/",
            "http://[fd00::1]/",
            "http://[fe80::1]/",
        ] {
            assert!(!ok(bad), "{bad} must be refused");
        }
    }

    #[test]
    fn resolves_relative_favicon() {
        let got = extract_favicon(
            r#"<link rel="icon" href="/assets/icon.png">"#,
            "https://example.com/a/b",
        )
        .unwrap();
        assert_eq!(got, "https://example.com/assets/icon.png");
    }
}

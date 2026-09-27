//! URL metadata fetcher for login items.
//!
//! Scrapes target site for favicon + title when user pastes a link into
//! the editor. Returns favicon as data URL and title for auto-fill.

use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use thiserror::Error;

/// Page bytes read for title/favicon discovery; <head> sits well inside this.
const MAX_HTML_BYTES: usize = 1024 * 1024;
/// Redirect hops followed before giving up.
const MAX_HOPS: usize = 5;
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
    // A page cut off at the cap still has its <head>; parse what arrived.
    let html = match get_capped(url, MAX_HTML_BYTES).await {
        Ok((html, _, _)) => html,
        // Bot filters (Outlook's 417, PayPal's 403) refuse the page but often
        // still serve /favicon.ico; a logo with no title beats nothing.
        Err(e) => {
            let icon = match extract_favicon("", url) {
                Some(root) => fetch_favicon(&root).await.map_err(|_| e)?,
                None => return Err(e),
            };
            return Ok(UrlMetadata { title: None, favicon_data_url: Some(icon) });
        }
    };
    let html = String::from_utf8_lossy(&html);

    let title = extract_title(&html);
    let favicon_href = extract_favicon(&html, url);

    let favicon_data_url = if let Some(href) = favicon_href {
        fetch_favicon(&href).await.ok()
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
    let raw = re
        .captures(html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string())
        .filter(|s| !s.is_empty())?;
    Some(shorten_title(&raw))
}

/// Real-world <title> tags are usually "Page Name - Site Name | Extra"; a
/// login item just needs the short name, like a browser tab shows, so keep
/// the first segment and cap length.
fn shorten_title(title: &str) -> String {
    let sep = regex::Regex::new(r"\s[-|·—–»:]\s").unwrap();
    let first = sep.splitn(title, 2).next().unwrap_or(title).trim();
    let mut short: String = first.chars().take(60).collect();
    if first.chars().count() > 60 {
        short.push('…');
    }
    short
}

fn extract_favicon(html: &str, base_url: &str) -> Option<String> {
    // Look for any <link rel="icon"> / <link rel="shortcut icon"> tag,
    // reading rel and href independently so attribute order doesn't matter
    // (real-world markup puts href before rel as often as not).
    let tag_re = regex::Regex::new(r"(?i)<link\b[^>]*>").ok()?;
    let rel_re = regex::Regex::new(r#"(?i)rel=["'](?:shortcut\s+)?icon["']"#).ok()?;
    let href_re = regex::Regex::new(r#"(?i)href=["']([^"']+)["']"#).ok()?;

    for tag in tag_re.find_iter(html) {
        let tag = tag.as_str();
        if rel_re.is_match(tag) {
            if let Some(href) = href_re.captures(tag).and_then(|c| c.get(1)) {
                return Some(resolve_url(href.as_str(), base_url));
            }
        }
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

async fn fetch_favicon(url: &str) -> Result<String, MetadataError> {
    let (bytes, truncated, content_type) = get_capped(url, MAX_ICON_BYTES).await?;
    if truncated {
        return Err(MetadataError::Request("favicon too large".to_string()));
    }

    let mime = sniff_mime(content_type.as_deref(), &bytes);
    let b64 = base64_encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

/// Real Content-Type wins when it names an actual image format (servers
/// often send a generic application/octet-stream); otherwise sniff magic
/// bytes. Wrapping the wrong bytes in the wrong data: URL mime (e.g. an SVG
/// favicon labeled image/x-icon) makes it fail to render entirely.
fn sniff_mime(content_type: Option<&str>, bytes: &[u8]) -> &'static str {
    if let Some(ct) = content_type {
        let ct = ct.split(';').next().unwrap_or(ct).trim();
        match ct {
            "image/svg+xml" => return "image/svg+xml",
            "image/png" => return "image/png",
            "image/jpeg" => return "image/jpeg",
            "image/gif" => return "image/gif",
            "image/webp" => return "image/webp",
            "image/x-icon" | "image/vnd.microsoft.icon" => return "image/x-icon",
            _ => {}
        }
    }
    let head = &bytes[..bytes.len().min(16)];
    if head.starts_with(b"\x89PNG") {
        "image/png"
    } else if head.starts_with(b"GIF87a") || head.starts_with(b"GIF89a") {
        "image/gif"
    } else if head.starts_with(b"\xFF\xD8") {
        "image/jpeg"
    } else if head.starts_with(b"\x00\x00\x01\x00") {
        "image/x-icon"
    } else if head.iter().find(|b| !b.is_ascii_whitespace()) == Some(&b'<') {
        "image/svg+xml"
    } else {
        "image/x-icon"
    }
}

/// Without the URL: reqwest's message ends in the address it was fetching,
/// which is a login's own URL, and this error ends up in the log.
fn req_err(e: reqwest::Error) -> MetadataError {
    MetadataError::Request(e.without_url().to_string())
}

/// Build a client that will only ever talk to `addr` for this request's
/// host. Redirects are handled by the caller so every hop is re-resolved and
/// re-checked.
fn client_pinned_to(host: &str, addr: Option<SocketAddr>) -> Result<reqwest::Client, MetadataError> {
    let mut builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        // A bare "Mozilla/5.0" is a well-known bot signature and gets 403'd by
        // Cloudflare/Fastly-fronted sites (GitHub included); a real browser UA
        // string gets through the same bot filters a login page's own visitors do.
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        )
        .redirect(reqwest::redirect::Policy::none());
    if let Some(addr) = addr {
        // Pinning closes the DNS-rebinding window: the name was checked as
        // public a moment ago, and this is the address that gets dialed, so a
        // second lookup returning 127.0.0.1 has nothing to act on.
        builder = builder.resolve(host, addr);
    }
    builder.build().map_err(req_err)
}

/// Resolve a URL's host and require every address it maps to to be public.
/// Returns the address to pin, or None when the host was already a literal
/// IP (nothing to rebind).
async fn resolve_public(url: &reqwest::Url) -> Result<Option<SocketAddr>, MetadataError> {
    let refused = || MetadataError::Request("only public http(s) addresses are fetched".to_string());
    if !is_public_http(url) {
        return Err(refused());
    }
    let host = url.host_str().ok_or_else(refused)?;
    if host.parse::<IpAddr>().is_ok() {
        return Ok(None); // is_public_http already vetted the literal
    }
    let port = url.port_or_known_default().unwrap_or(443);
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|e| MetadataError::Request(format!("dns lookup failed: {e}")))?
        .collect();
    if addrs.is_empty() || !addrs.iter().all(|a| addr_is_public(*a)) {
        return Err(refused());
    }
    Ok(Some(addrs[0]))
}

fn addr_is_public(addr: SocketAddr) -> bool {
    match addr.ip() {
        IpAddr::V4(ip) => is_public_v4(ip),
        IpAddr::V6(ip) => match ip.to_ipv4_mapped() {
            Some(v4) => is_public_v4(v4),
            None => {
                let first = ip.segments()[0];
                !(ip.is_loopback()
                    || ip.is_unspecified()
                    || (first & 0xfe00) == 0xfc00
                    || (first & 0xffc0) == 0xfe80)
            }
        },
    }
}

/// GET a public http(s) URL, reading at most `max` body bytes. Returns the
/// bytes, whether the body was cut off at the cap, and the response's
/// Content-Type header if present.
async fn get_capped(
    url: &str,
    max: usize,
) -> Result<(Vec<u8>, bool, Option<String>), MetadataError> {
    let mut current = reqwest::Url::parse(url).map_err(|e| MetadataError::Parse(e.to_string()))?;
    let mut resp = None;
    for _ in 0..=MAX_HOPS {
        let addr = resolve_public(&current).await?;
        let host = current
            .host_str()
            .ok_or_else(|| MetadataError::Request("no host".to_string()))?
            .to_string();
        let client = client_pinned_to(&host, addr)?;
        let r = client.get(current.clone()).send().await.map_err(req_err)?;
        if r.status().is_redirection() {
            let location = r
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| MetadataError::Request("redirect without location".to_string()))?;
            // Re-resolved and re-checked on the next pass, so a public page
            // cannot bounce the fetch into the LAN.
            current = current
                .join(location)
                .map_err(|e| MetadataError::Parse(e.to_string()))?;
            continue;
        }
        resp = Some(r);
        break;
    }
    let mut resp = resp.ok_or_else(|| MetadataError::Request("too many redirects".to_string()))?;
    if !resp.status().is_success() {
        return Err(MetadataError::Request(format!("http status {}", resp.status())));
    }
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let mut buf = Vec::new();
    loop {
        let chunk = match resp.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            // The 5 s timeout, or a reset, part-way through a slow page: what
            // arrived is kept as a cut-off body. A page's <head> comes first,
            // so the favicon link is usually in it; a cut-off icon is still
            // refused by the caller.
            Err(_) if !buf.is_empty() => return Ok((buf, true, content_type)),
            Err(e) => return Err(req_err(e)),
        };
        let room = max - buf.len();
        if chunk.len() > room {
            buf.extend_from_slice(&chunk[..room]);
            return Ok((buf, true, content_type));
        }
        buf.extend_from_slice(&chunk);
    }
    Ok((buf, false, content_type))
}

/// True for http(s) URLs whose host is not loopback, private, link-local, or
/// otherwise local.
/// Checks the literal host only; `resolve_public` checks and pins what a
/// name resolves to.
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
    fn addr_is_public_rejects_resolved_lan_addresses() {
        let lan: SocketAddr = "192.168.1.10:443".parse().unwrap();
        let loopback: SocketAddr = "127.0.0.1:80".parse().unwrap();
        let cgnat: SocketAddr = "100.64.0.1:443".parse().unwrap();
        let v6_local: SocketAddr = "[fe80::1]:443".parse().unwrap();
        let public: SocketAddr = "93.184.216.34:443".parse().unwrap();
        assert!(!addr_is_public(lan));
        assert!(!addr_is_public(loopback));
        assert!(!addr_is_public(cgnat));
        assert!(!addr_is_public(v6_local));
        assert!(addr_is_public(public));
    }

    #[test]
    fn addr_is_public_sees_through_ipv4_mapped_v6() {
        let mapped: SocketAddr = "[::ffff:127.0.0.1]:443".parse().unwrap();
        assert!(!addr_is_public(mapped));
    }

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
    fn extracts_favicon_href_regardless_of_attribute_order() {
        let html = r#"<link href="/favicon.png" rel="icon">"#;
        let got = extract_favicon(html, "https://example.com").unwrap();
        assert_eq!(got, "https://example.com/favicon.png");
    }

    #[test]
    fn shortens_title_to_first_segment() {
        assert_eq!(
            shorten_title("GitHub - Where the world builds software"),
            "GitHub"
        );
        assert_eq!(shorten_title("Sign in | Twitch"), "Sign in");
        assert_eq!(shorten_title("Plain Title"), "Plain Title");
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

    #[test]
    fn sniffs_svg_favicons_by_content_type() {
        assert_eq!(sniff_mime(Some("image/svg+xml; charset=utf-8"), b"<svg></svg>"), "image/svg+xml");
    }

    #[test]
    fn sniffs_svg_favicons_by_magic_bytes_when_content_type_is_missing() {
        assert_eq!(sniff_mime(None, b"<svg xmlns=\"...\"></svg>"), "image/svg+xml");
    }

    #[test]
    fn sniffs_png_favicons_by_magic_bytes() {
        let png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0];
        assert_eq!(sniff_mime(None, &png), "image/png");
    }

    #[test]
    fn ignores_a_generic_content_type_and_falls_back_to_sniffing() {
        let png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0];
        assert_eq!(sniff_mime(Some("application/octet-stream"), &png), "image/png");
    }

    #[test]
    fn defaults_to_x_icon_when_unrecognized() {
        assert_eq!(sniff_mime(None, b"not an image"), "image/x-icon");
    }
}

//! Browser bridge: the loopback endpoint the extension talks to.
//!
//! The extension cannot read the vault file and the app cannot reach into a
//! web page, so something has to sit between them. This is that something,
//! and it is the only network surface the app exposes.
//!
//! Four rules hold the whole design up:
//!
//! 1. **Loopback only.** The listener binds `127.0.0.1`, never `0.0.0.0`.
//! 2. **A human pairs it.** The app shows a code; the user types it into the
//!    extension. Nothing else on the machine can read that code off the
//!    screen, so nothing else can pair itself.
//! 3. **The token lives in the vault.** It is encrypted at rest and it stops
//!    being verifiable the moment the vault locks, which is exactly when the
//!    extension should stop being able to ask for anything.
//! 4. **Rust decides what an origin may see.** The extension says which
//!    origin it is acting for, but every lookup is filtered by that origin
//!    here. A page cannot name an item id and be handed a password that
//!    belongs to a different site.
//!
//! No response ever carries an `Access-Control-Allow-Origin` header, so even
//! a page that guesses the port cannot read what comes back.

use crate::commands::{host_of, AppState};
use crate::crypto::random_bytes;
use crate::vault::{Item, PairedClient, Vault};
use serde::Serialize;
use std::io::Read;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tiny_http::{Header, Request, Response, StatusCode};
use uuid::Uuid;

/// ponytail: one fixed port, no discovery protocol. If something else is
/// already on it the bridge simply does not come up and Settings says so.
pub const PORT: u16 = 38471;

/// How long a pairing code stays good once it is on screen.
const CODE_TTL: Duration = Duration::from_secs(180);
/// Wrong codes allowed before the code is burnt, so a local process cannot
/// sit and guess. Three, because the user is typing it by hand.
const CODE_TRIES: u8 = 3;
/// Nothing this endpoint accepts is large.
const MAX_BODY: u64 = 8 * 1024;
/// Threads serving the endpoint. One browser needs one; the rest are so a
/// stalled connection cannot take the bridge down with it.
const BRIDGE_WORKERS: usize = 4;
/// Unambiguous: no O/0, no I/1, no letters that look like each other in the
/// app's font, because this is read off one screen and typed into another.
const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN: usize = 8;

struct PairCode {
    code: String,
    issued: Instant,
    tries: u8,
}

#[derive(Default)]
pub struct Bridge {
    pending: Mutex<Option<PairCode>>,
    /// None until `start` has run; Some(err) when the port was unavailable.
    listen_error: Mutex<Option<String>>,
}

impl Bridge {
    /// Put a fresh pairing code on screen, replacing any code still pending.
    pub fn new_code(&self) -> String {
        let bytes = random_bytes(CODE_LEN);
        let code: String = bytes
            .iter()
            .map(|b| CODE_ALPHABET[*b as usize % CODE_ALPHABET.len()] as char)
            .collect();
        *self.pending.lock().unwrap() = Some(PairCode {
            code: code.clone(),
            issued: Instant::now(),
            tries: 0,
        });
        code
    }

    pub fn cancel_code(&self) {
        *self.pending.lock().unwrap() = None;
    }

    pub fn listen_error(&self) -> Option<String> {
        self.listen_error.lock().unwrap().clone()
    }

    /// Check a submitted code, consuming it on success and burning it after
    /// `CODE_TRIES` failures.
    fn redeem(&self, submitted: &str) -> Result<(), &'static str> {
        let mut slot = self.pending.lock().unwrap();
        let pending = slot.as_mut().ok_or("no pairing in progress")?;
        if pending.issued.elapsed() > CODE_TTL {
            *slot = None;
            return Err("that pairing code has expired");
        }
        if !ct_eq(&pending.code, submitted.trim()) {
            pending.tries += 1;
            if pending.tries >= CODE_TRIES {
                *slot = None;
                return Err("too many wrong codes — start pairing again");
            }
            return Err("that pairing code is not right");
        }
        *slot = None;
        Ok(())
    }
}

/// Constant-time string compare. Length is allowed to leak: every secret
/// compared here is a fixed size.
fn ct_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

// ---------------------------------------------------------------------------
// Origin matching
// ---------------------------------------------------------------------------

/// Suffixes under which two hosts sharing the tail are still strangers:
/// `a.co.uk` and `b.co.uk` are unrelated sites.
///
/// ponytail: the correct answer is the Public Suffix List. This is the
/// handful that actually turns up; swap in `publicsuffix` if a real miss
/// ever shows up.
const MULTI_LABEL_SUFFIXES: &[&str] = &[
    "co.uk", "org.uk", "ac.uk", "gov.uk", "co.jp", "or.jp", "com.au", "net.au", "org.au",
    "com.br", "com.mx", "com.ar", "co.in", "co.za", "co.nz", "com.tr", "com.cn", "com.sg",
];

/// `https` or `http` from a URL, lowercased. None for anything else.
fn scheme_of(url: &str) -> Option<&'static str> {
    let url = url.trim();
    let lower = url.to_lowercase();
    if lower.starts_with("https://") {
        Some("https")
    } else if lower.starts_with("http://") {
        Some("http")
    } else {
        None
    }
}

/// Does a login saved at `item_url` belong to a page served from `origin`?
///
/// Host has to match by `host_covers`, and the scheme has to be identical.
/// The scheme check is what stops a password saved for `https://bank.test`
/// from being handed to a page at `http://bank.test`: same host, but anyone
/// between the browser and the server can serve that page and read what is
/// typed into it. A login genuinely saved as `http://` (a router on the
/// LAN, say) still matches its own `http://` origin.
pub(crate) fn url_covers(item_url: &str, origin: &str) -> bool {
    match (scheme_of(item_url), scheme_of(origin)) {
        (Some(a), Some(b)) if a == b => {}
        _ => return false,
    }
    match (host_of(item_url), host_of(origin)) {
        (Some(item_host), Some(origin_host)) => host_covers(&item_host, &origin_host),
        _ => false,
    }
}

/// Does a login saved for `item_host` belong to a page served from
/// `origin_host`?
///
/// Exact match, or the item is a parent domain of the origin —
/// "github.com" covers "gist.github.com". A parent that is only a public
/// suffix does not count, or one saved login for "co.uk" would be offered
/// to every British site on the web.
pub(crate) fn host_covers(item_host: &str, origin_host: &str) -> bool {
    if item_host.is_empty() || origin_host.is_empty() {
        return false;
    }
    if item_host == origin_host {
        return true;
    }
    if MULTI_LABEL_SUFFIXES.contains(&item_host) || item_host.matches('.').count() < 1 {
        return false;
    }
    origin_host.ends_with(&format!(".{item_host}"))
}

#[derive(Serialize)]
pub(crate) struct Match {
    pub id: String,
    pub title: String,
    pub username: String,
    /// "credentials", or the provider this account signs in through
    /// ("google", "microsoft", …). The popup offers a fill for the first and
    /// only a reminder for the rest.
    pub method: String,
}

/// Does this login sign in through a provider rather than with a password
/// typed into the site itself?
fn is_provider_login(method: &str) -> bool {
    method != "credentials"
}

/// Every login in the vault that this origin is allowed to see.
///
/// The filter is here rather than in the extension on purpose: it is the one
/// thing standing between "a page asked" and "a password left the vault".
pub(crate) fn matches_for(vault: &Vault, origin: &str) -> Vec<Match> {
    vault
        .items
        .iter()
        .filter_map(|item| match item {
            Item::Login { base, fields } => {
                if !url_covers(&fields.url, origin) {
                    return None;
                }
                Some(Match {
                    id: base.id.to_string(),
                    title: base.title.clone(),
                    username: fields.username.clone(),
                    method: fields.method.clone(),
                })
            }
            _ => None,
        })
        .collect()
}

/// The username and password for one item, for one origin.
///
/// Re-checks the origin rather than trusting that it was checked when the
/// list was built: this is the call that actually hands over a password, and
/// it is reachable on its own.
///
/// A provider login gets nothing. "Sign in with Google" never sends a
/// password to the site — it hands the site a token from Google. So the only
/// password such an item could offer is the *provider's*, and typing that
/// into the site's own form would post a Google password to Twitch. The app
/// may still show it (clipboard, user watching); a one-click fill is a
/// different risk and is refused here.
pub(crate) fn credentials_for(
    vault: &Vault,
    id: Uuid,
    origin: &str,
) -> Result<(String, String), &'static str> {
    if host_of(origin).is_none() {
        return Err("not a web origin");
    }
    let item = vault
        .items
        .iter()
        .find(|i| i.id() == id)
        .ok_or("no such item")?;
    let Item::Login { fields, .. } = item else {
        return Err("not a login item");
    };
    if !url_covers(&fields.url, origin) {
        return Err("that item does not belong to this site");
    }
    if is_provider_login(&fields.method) {
        return Err("that account signs in through a provider, so there is no site password to fill");
    }
    if fields.password.is_empty() {
        return Err("that item has no password");
    }
    Ok((fields.username.clone(), fields.password.clone()))
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

fn json(status: u16, body: serde_json::Value) -> Response<std::io::Cursor<Vec<u8>>> {
    let header = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
        .expect("static header");
    // Deliberately no Access-Control-Allow-Origin: a page that guesses the
    // port may reach the socket, but it may never read the answer.
    Response::from_string(body.to_string())
        .with_status_code(StatusCode(status))
        .with_header(header)
}

fn fail(status: u16, message: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    json(status, serde_json::json!({ "error": message }))
}

fn header_value<'a>(req: &'a Request, name: &'static str) -> Option<&'a str> {
    req.headers()
        .iter()
        .find(|h| h.field.equiv(name))
        .map(|h| h.value.as_str())
}

fn read_body(req: &mut Request) -> Result<serde_json::Value, String> {
    let mut buf = String::new();
    req.as_reader()
        .take(MAX_BODY)
        .read_to_string(&mut buf)
        .map_err(|e| e.to_string())?;
    if buf.trim().is_empty() {
        return Ok(serde_json::json!({}));
    }
    serde_json::from_str(&buf).map_err(|e| e.to_string())
}

fn field(body: &serde_json::Value, key: &str) -> String {
    body.get(key).and_then(|v| v.as_str()).unwrap_or("").to_string()
}

/// Only an extension may talk to this, and pairing pins which one.
fn extension_origin(req: &Request) -> Option<String> {
    let origin = header_value(req, "Origin")?;
    // moz-extension:// is here for the Firefox port; Chrome is what ships.
    if origin.starts_with("chrome-extension://") || origin.starts_with("moz-extension://") {
        Some(origin.to_string())
    } else {
        None
    }
}

fn bearer(req: &Request) -> Option<String> {
    header_value(req, "Authorization")?
        .strip_prefix("Bearer ")
        .map(str::to_string)
}

/// Find the paired client this request is authenticated as.
fn client_of<'a>(vault: &'a Vault, origin: &str, token: &str) -> Option<&'a PairedClient> {
    vault
        .paired
        .iter()
        .find(|c| c.origin == origin && ct_eq(&c.token, token))
}

pub fn start(app: &AppHandle) {
    let handle = app.clone();
    let server = match tiny_http::Server::http(("127.0.0.1", PORT)) {
        Ok(s) => s,
        Err(e) => {
            let msg = format!("port {PORT} is not available: {e}");
            crate::log_warn!("bridge", "{msg}");
            *app.state::<Bridge>().listen_error.lock().unwrap() = Some(msg);
            return;
        }
    };
    crate::log_info!("bridge", "listening on 127.0.0.1:{PORT}");
    // A few workers rather than one loop: a local process that opens a
    // connection and then says nothing would otherwise stall every later
    // request behind it.
    // ponytail: four is enough for one browser; it is still a fixed pool, so
    // four silent connections do stall the bridge. Add read timeouts if that
    // ever turns up in practice.
    let server = std::sync::Arc::new(server);
    for _ in 0..BRIDGE_WORKERS {
        let server = server.clone();
        let handle = handle.clone();
        std::thread::spawn(move || loop {
            let Ok(mut req) = server.recv() else { return };
            let response = route(&handle, &mut req);
            let _ = req.respond(response);
        });
    }
}

fn route(app: &AppHandle, req: &mut Request) -> Response<std::io::Cursor<Vec<u8>>> {
    if req.method() != &tiny_http::Method::Post {
        return fail(405, "POST only");
    }
    let Some(origin) = extension_origin(req) else {
        // A browser tab's Origin never starts with chrome-extension://, so
        // this is where a curious web page stops.
        return fail(403, "not a browser extension");
    };
    let body = match read_body(req) {
        Ok(b) => b,
        Err(_) => return fail(400, "malformed request"),
    };
    let path = req.url().split('?').next().unwrap_or("");
    match path {
        "/pair" => pair(app, &origin, &body),
        "/status" => status(app, &origin, req),
        "/matches" => matches(app, &origin, req, &body),
        "/credentials" => credentials(app, &origin, req, &body),
        _ => fail(404, "no such endpoint"),
    }
}

fn pair(
    app: &AppHandle,
    origin: &str,
    body: &serde_json::Value,
) -> Response<std::io::Cursor<Vec<u8>>> {
    let state = app.state::<AppState>();
    if !state.is_unlocked() {
        return fail(423, "unlock the vault before pairing");
    }
    if let Err(e) = app.state::<Bridge>().redeem(&field(body, "code")) {
        crate::log_warn!("bridge", "pairing refused: {e}");
        return fail(403, e);
    }
    let label = {
        let l = field(body, "label");
        let l = l.trim();
        if l.is_empty() { "Browser".to_string() } else { l.chars().take(40).collect() }
    };
    let token = crate::crypto::random_bytes(32).iter().map(|b| format!("{b:02x}")).collect::<String>();

    match crate::commands::add_paired_client(
        &state,
        PairedClient {
            origin: origin.to_string(),
            label,
            token: token.clone(),
            paired_at: chrono::Utc::now().timestamp(),
        },
    ) {
        Ok(()) => {
            crate::log_info!("bridge", "paired origin={origin}");
            json(200, serde_json::json!({ "token": token }))
        }
        Err(e) => fail(500, &e),
    }
}

/// Answered without checking the token, because while the vault is locked
/// there is nothing to check it against. All it admits is that the vault is
/// shut, which is what the extension needs to say on screen.
fn status(app: &AppHandle, origin: &str, req: &Request) -> Response<std::io::Cursor<Vec<u8>>> {
    let state = app.state::<AppState>();
    if !state.is_unlocked() {
        return json(200, serde_json::json!({ "unlocked": false, "paired": true }));
    }
    let Some(token) = bearer(req) else {
        return fail(401, "not paired");
    };
    let vault = state.vault.lock().unwrap();
    let Some(vault) = vault.as_ref() else {
        return json(200, serde_json::json!({ "unlocked": false, "paired": true }));
    };
    if client_of(vault, origin, &token).is_none() {
        return fail(401, "not paired");
    }
    json(200, serde_json::json!({ "unlocked": true, "paired": true }))
}

/// Everything past here needs a live token, so it is all refused while the
/// vault is locked.
fn authed<'a>(
    state: &'a tauri::State<'_, AppState>,
    origin: &str,
    req: &Request,
) -> Result<std::sync::MutexGuard<'a, Option<Vault>>, Response<std::io::Cursor<Vec<u8>>>> {
    let token = bearer(req).ok_or_else(|| fail(401, "not paired"))?;
    let vault = state.vault.lock().unwrap();
    {
        let v = vault.as_ref().ok_or_else(|| fail(423, "the vault is locked"))?;
        if client_of(v, origin, &token).is_none() {
            return Err(fail(401, "not paired"));
        }
    }
    Ok(vault)
}

fn matches(
    app: &AppHandle,
    origin: &str,
    req: &Request,
    body: &serde_json::Value,
) -> Response<std::io::Cursor<Vec<u8>>> {
    let state = app.state::<AppState>();
    let vault = match authed(&state, origin, req) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let items = matches_for(vault.as_ref().expect("checked in authed"), &field(body, "origin"));
    crate::log_info!("bridge", "matches n={}", items.len());
    json(200, serde_json::json!({ "items": items }))
}

fn credentials(
    app: &AppHandle,
    origin: &str,
    req: &Request,
    body: &serde_json::Value,
) -> Response<std::io::Cursor<Vec<u8>>> {
    let state = app.state::<AppState>();
    let out = {
        let vault = match authed(&state, origin, req) {
            Ok(v) => v,
            Err(r) => return r,
        };
        let Ok(id) = Uuid::parse_str(&field(body, "id")) else {
            return fail(400, "not an item id");
        };
        credentials_for(vault.as_ref().expect("checked in authed"), id, &field(body, "origin"))
    };
    match out {
        Ok((username, password)) => {
            // A fill is the user acting, so it counts against the idle lock
            // the same way clicking in the app does. `/status` deliberately
            // does not, or an open browser would hold the vault open.
            state.autolock.lock().unwrap().reset();
            crate::log_info!("bridge", "filled one login");
            json(200, serde_json::json!({ "username": username, "password": password }))
        }
        Err(e) => {
            crate::log_warn!("bridge", "credentials refused: {e}");
            fail(403, e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::{new_vault, ItemBase, LoginFields};

    fn login(title: &str, url: &str, user: &str, pass: &str) -> Item {
        Item::Login {
            base: ItemBase {
                id: Uuid::new_v4(),
                title: title.to_string(),
                notes: String::new(),
                created_at: 0,
                updated_at: 0,
                favicon: String::new(),
            },
            fields: LoginFields {
                method: "credentials".to_string(),
                url: url.to_string(),
                username: user.to_string(),
                password: pass.to_string(),
            },
        }
    }

    #[test]
    fn a_host_covers_itself_and_its_subdomains() {
        assert!(host_covers("github.com", "github.com"));
        assert!(host_covers("github.com", "gist.github.com"));
        assert!(host_covers("github.com", "a.b.github.com"));
    }

    #[test]
    fn a_host_does_not_cover_its_parent_or_a_lookalike() {
        // The saved login is the narrower one; the page is the broader site.
        assert!(!host_covers("gist.github.com", "github.com"));
        // The classic near-miss: a suffix match that is not a domain match.
        assert!(!host_covers("github.com", "notgithub.com"));
        assert!(!host_covers("github.com", "github.com.evil.test"));
    }

    #[test]
    fn a_public_suffix_covers_nothing() {
        // Otherwise one login saved against "co.uk" would be offered to
        // every British site the user ever visits.
        assert!(!host_covers("co.uk", "hsbc.co.uk"));
        assert!(!host_covers("com.au", "anz.com.au"));
        // And a bare TLD is not a domain either.
        assert!(!host_covers("com", "github.com"));
    }

    #[test]
    fn a_plaintext_origin_does_not_get_an_https_login() {
        // Found live: host matched, scheme was ignored, and a page at
        // http://twitch.tv was handed the password saved for https://.
        // Anyone on the network can serve that page.
        let mut v = new_vault(vec![0; 16]);
        let item = login("Bank", "https://bank.test/", "me", "hunter2");
        let id = item.id();
        crate::vault::add_item(&mut v, item);

        assert!(!url_covers("https://bank.test/", "http://bank.test"));
        assert!(matches_for(&v, "http://bank.test").is_empty());
        assert_eq!(
            credentials_for(&v, id, "http://bank.test").unwrap_err(),
            "that item does not belong to this site"
        );
    }

    #[test]
    fn a_login_saved_as_plain_http_still_matches_its_own_origin() {
        // A router on the LAN has no certificate; refusing it outright would
        // make the item unusable rather than safer.
        let mut v = new_vault(vec![0; 16]);
        crate::vault::add_item(&mut v, login("Router", "http://router.lan/", "admin", "pw"));
        assert!(url_covers("http://router.lan/", "http://router.lan"));
        assert_eq!(matches_for(&v, "http://router.lan").len(), 1);
        // And the upgrade does not match either: a stored http item says
        // nothing about who answers on https.
        assert!(matches_for(&v, "https://router.lan").is_empty());
    }

    #[test]
    fn a_non_web_scheme_never_covers_anything() {
        for (item, origin) in [
            ("file:///c:/secrets.html", "file:///c:/secrets.html"),
            ("https://bank.test/", "chrome-extension://abc"),
            ("javascript:alert(1)", "https://bank.test"),
            ("https://bank.test/", "ftp://bank.test"),
        ] {
            assert!(!url_covers(item, origin), "{item} must not cover {origin}");
        }
    }

    #[test]
    fn matches_are_filtered_to_the_asking_origin() {
        let mut v = new_vault(vec![0; 16]);
        crate::vault::add_item(&mut v, login("GitHub", "https://github.com/login", "me", "pw"));
        crate::vault::add_item(&mut v, login("Bank", "https://bank.test/", "me", "pw"));

        let out = matches_for(&v, "https://github.com");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].title, "GitHub");
        assert_eq!(out[0].username, "me");
    }

    #[test]
    fn matches_never_leak_a_password() {
        let mut v = new_vault(vec![0; 16]);
        crate::vault::add_item(&mut v, login("GitHub", "https://github.com/", "me", "hunter2"));
        let body = serde_json::to_string(&matches_for(&v, "https://github.com")).unwrap();
        assert!(!body.contains("hunter2"), "match list carried a password: {body}");
    }

    #[test]
    fn matches_are_empty_for_a_junk_origin() {
        let mut v = new_vault(vec![0; 16]);
        crate::vault::add_item(&mut v, login("GitHub", "https://github.com/", "me", "pw"));
        for origin in ["", "file:///c:/", "chrome-extension://abc", "not a url"] {
            assert!(matches_for(&v, origin).is_empty(), "leaked for {origin}");
        }
    }

    #[test]
    fn credentials_are_refused_for_another_sites_item() {
        // The whole point of doing this check in Rust: naming an id is not
        // enough, the origin has to own it.
        let mut v = new_vault(vec![0; 16]);
        let item = login("Bank", "https://bank.test/", "me", "hunter2");
        let id = item.id();
        crate::vault::add_item(&mut v, item);

        assert_eq!(
            credentials_for(&v, id, "https://evil.test").unwrap_err(),
            "that item does not belong to this site"
        );
        let (user, pass) = credentials_for(&v, id, "https://bank.test").unwrap();
        assert_eq!((user.as_str(), pass.as_str()), ("me", "hunter2"));
    }

    /// A provider login (`method` other than "credentials") may carry no
    /// password of its own and borrow the one saved against the provider.
    fn provider_login(title: &str, url: &str, method: &str, user: &str, pass: &str) -> Item {
        let mut item = login(title, url, user, pass);
        if let Item::Login { fields, .. } = &mut item {
            fields.method = method.to_string();
        }
        item
    }

    #[test]
    fn a_provider_login_never_hands_the_providers_password_to_the_site() {
        // Found live: the Twitch item is method=google with no password of
        // its own, and it borrowed the Google one for twitch.tv. Filling
        // that into Twitch's own form posts a Google password to Twitch.
        let mut v = new_vault(vec![0; 16]);
        let twitch = provider_login("Twitch", "https://twitch.tv/", "google", "me@gmail.test", "");
        let id = twitch.id();
        crate::vault::add_item(&mut v, twitch);
        crate::vault::add_item(
            &mut v,
            provider_login("Google", "https://google.com/", "google", "me@gmail.test", "hunter2"),
        );

        let err = credentials_for(&v, id, "https://twitch.tv").unwrap_err();
        assert!(err.contains("signs in through a provider"), "unexpected: {err}");

        // The Google item itself is what covers Google's own pages, so the
        // borrow was never needed to sign in there.
        let on_google = matches_for(&v, "https://accounts.google.com");
        assert_eq!(on_google.len(), 1);
        assert_eq!(on_google[0].title, "Google");
    }

    #[test]
    fn a_provider_login_is_refused_even_with_a_password_of_its_own() {
        // The stored password is still the provider's, not the site's.
        let mut v = new_vault(vec![0; 16]);
        let item = provider_login("Router", "http://router.lan/", "microsoft", "me", "hunter2");
        let id = item.id();
        crate::vault::add_item(&mut v, item);
        assert!(credentials_for(&v, id, "http://router.lan")
            .unwrap_err()
            .contains("signs in through a provider"));
    }

    #[test]
    fn a_provider_login_is_still_listed_so_the_popup_can_name_it() {
        // Refusing to fill is not the same as hiding it: the whole point is
        // reminding the user which account they used.
        let mut v = new_vault(vec![0; 16]);
        crate::vault::add_item(
            &mut v,
            provider_login("Twitch", "https://twitch.tv/", "google", "me@gmail.test", ""),
        );
        let out = matches_for(&v, "https://twitch.tv");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].method, "google");
        assert_eq!(out[0].username, "me@gmail.test");
    }

    #[test]
    fn credentials_are_refused_for_an_unknown_id() {
        let v = new_vault(vec![0; 16]);
        assert_eq!(
            credentials_for(&v, Uuid::new_v4(), "https://bank.test").unwrap_err(),
            "no such item"
        );
    }

    #[test]
    fn a_pairing_code_works_once() {
        let b = Bridge::default();
        let code = b.new_code();
        assert_eq!(code.chars().count(), CODE_LEN);
        assert!(b.redeem(&code).is_ok());
        // Consumed: a replayed code is worth nothing.
        assert!(b.redeem(&code).is_err());
    }

    #[test]
    fn a_pairing_code_burns_after_three_wrong_guesses() {
        let b = Bridge::default();
        let code = b.new_code();
        for _ in 0..2 {
            assert_eq!(b.redeem("WRONGONE").unwrap_err(), "that pairing code is not right");
        }
        assert_eq!(b.redeem("WRONGONE").unwrap_err(), "too many wrong codes — start pairing again");
        // Even the real code is dead now.
        assert!(b.redeem(&code).is_err());
    }

    #[test]
    fn there_is_no_code_until_one_is_asked_for() {
        let b = Bridge::default();
        assert_eq!(b.redeem("ABCDEFGH").unwrap_err(), "no pairing in progress");
        b.new_code();
        b.cancel_code();
        assert_eq!(b.redeem("ABCDEFGH").unwrap_err(), "no pairing in progress");
    }

    #[test]
    fn pairing_codes_do_not_repeat() {
        let b = Bridge::default();
        let mut seen = std::collections::HashSet::new();
        for _ in 0..50 {
            assert!(seen.insert(b.new_code()), "pairing code repeated");
        }
    }

    #[test]
    fn ct_eq_matches_normal_equality() {
        assert!(ct_eq("abc", "abc"));
        assert!(!ct_eq("abc", "abd"));
        assert!(!ct_eq("abc", "abcd"));
        assert!(ct_eq("", ""));
    }
}

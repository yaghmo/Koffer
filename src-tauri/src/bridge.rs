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
//!
//! # What this does not defend against
//!
//! **The `Origin` header is not a guarantee.** A browser will not let a
//! *page* forge it, so pages really are shut out. Any other local process
//! can set it to whatever it likes — `curl -H 'Origin: chrome-extension://x'`
//! reaches these routes. The header narrows the surface; the pairing code
//! and the token are what actually hold it.
//!
//! **A paired browser holds the whole vault, not one site.** The extension
//! names the origin it is acting for, so whoever holds a token can walk a
//! list of domains, harvest every title and username, and then ask for any
//! password. Per-site scoping protects a *page* from another page's
//! secrets; it does not scope the extension itself.
//!
//! **The token is only as private as the browser's profile.** It is kept in
//! `chrome.storage.local`, a file under the browser's user-data directory,
//! readable by anything running as the same user. Malware with that file can
//! use these routes directly instead of dumping this process's memory. The
//! vault must be unlocked for it to work, and revoking the pairing in
//! Settings kills it immediately — but on a machine that is already
//! compromised, this is a shorter path to the plaintext than existed before
//! the bridge, and that is a deliberate trade for one-click autofill.

use crate::commands::{host_of, AppState};
use crate::crypto::random_bytes;
use crate::vault::{Item, LoginFields, PairedClient, Vault};
use serde::Serialize;
use std::io::Read;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tiny_http::{Header, Request, Response, StatusCode};
use uuid::Uuid;
use zeroize::Zeroizing;

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
/// Longest `Origin` kept. An extension id is ~50 characters; this only stops
/// a paired client writing kilobytes into the vault on every re-pair.
const MAX_ORIGIN: usize = 128;
/// When a fill lands with less than this left on the idle timer, ask whether
/// to stay unlocked. Long enough that the prompt is not a race.
const EXTEND_PROMPT_SECS: u64 = 120;
/// Unambiguous: no O/0, no I/1, no letters that look like each other in the
/// app's font, because this is read off one screen and typed into another.
const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN: usize = 8;

struct PairCode {
    code: String,
    issued: Instant,
    tries: u8,
}

/// Hand-written rather than derived: `#[derive(Debug)]` would print the code
/// itself into any log line or test failure that ever formats one.
impl std::fmt::Debug for PairCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PairCode")
            .field("code", &"<redacted>")
            .field("tries", &self.tries)
            .finish()
    }
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
    ///
    /// On success the code is handed back so the caller can return it if the
    /// pairing does not actually get written. A disk error must not cost the
    /// user their code.
    fn redeem(&self, submitted: &str) -> Result<PairCode, &'static str> {
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
        Ok(slot.take().expect("checked above"))
    }

    /// Put a redeemed code back after a failed pairing.
    fn restore(&self, code: PairCode) {
        let mut slot = self.pending.lock().unwrap();
        if slot.is_none() {
            *slot = Some(code);
        }
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

/// ponytail: the correct answer is the Public Suffix List. This is the
/// handful that actually turns up; swap in `publicsuffix` if a real miss
/// ever shows up.
///
/// Suffixes under which two hosts sharing the tail are still strangers:
/// `a.co.uk` and `b.co.uk` are unrelated sites, and so are two apps on
/// `vercel.app` or two blogs on `blogspot.com`.
const MULTI_LABEL_SUFFIXES: &[&str] = &[
    // Country-code second-level domains.
    "co.uk", "org.uk", "ac.uk", "gov.uk", "co.jp", "or.jp", "com.au", "net.au", "org.au",
    "com.br", "com.mx", "com.ar", "co.in", "co.za", "co.nz", "com.tr", "com.cn", "com.sg",
    // Private suffixes: one company owns the domain, but every subdomain
    // belongs to a different person, which is the same problem.
    "github.io", "gitlab.io", "herokuapp.com", "vercel.app", "netlify.app", "pages.dev",
    "workers.dev", "blogspot.com", "wordpress.com", "tumblr.com", "myshopify.com",
    "azurewebsites.net", "cloudfront.net", "amazonaws.com", "s3.amazonaws.com",
    "firebaseapp.com", "web.app", "glitch.me", "repl.co", "onrender.com", "fly.dev",
    "ngrok.io", "serveo.net", "githubusercontent.com", "translate.goog",
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
    /// ("google", "microsoft", …).
    pub method: String,
    /// Whether a fill would actually be granted here. Decided in Rust so the
    /// popup cannot offer a button that the next call refuses.
    pub fillable: bool,
}

/// Does this login sign in through a provider rather than with a password
/// typed into the site itself?
fn is_provider_login(method: &str) -> bool {
    method != "credentials"
}

/// The domains that *are* each provider, sign-in pages included.
///
/// Base domains only: `host_covers` already reaches every subdomain, so
/// "google.com" takes in `accounts.google.com` and `mail.google.com` alike.
///
/// ponytail: a hand-written table. It only ever widens a provider's own
/// account item onto that provider's own domains, so a missing entry costs
/// a fill that has to be done by hand, not a wrong one.
const PROVIDER_DOMAINS: &[(&str, &[&str])] = &[
    ("google", &["google.com", "gmail.com", "googlemail.com"]),
    (
        "microsoft",
        &["microsoft.com", "microsoftonline.com", "live.com", "outlook.com", "hotmail.com"],
    ),
    ("apple", &["apple.com", "icloud.com"]),
    ("github", &["github.com"]),
    ("facebook", &["facebook.com"]),
];

fn provider_domains(method: &str) -> Option<&'static [&'static str]> {
    PROVIDER_DOMAINS.iter().find(|(m, _)| *m == method).map(|(_, d)| *d)
}

/// Is this the provider's *own* account item, being asked for on one of the
/// provider's own pages?
///
/// "Gmail" is saved at `mail.google.com`, because that is where the user
/// goes. Google asks for the password at `accounts.google.com`, which is a
/// sibling, not a subdomain — so plain host matching misses it and the
/// chain breaks exactly where it matters: the popup says "click the Google
/// button", the button lands on the sign-in page, and the vault offers
/// nothing.
///
/// Only an item already living on the provider's own domain is widened. A
/// Twitch item marked `method=google` stays pinned to twitch.tv, because
/// its password is Google's and Twitch must never see it.
fn provider_account_covers(method: &str, item_url: &str, origin: &str) -> bool {
    if !is_provider_login(method) {
        return false;
    }
    // Sign-in is https everywhere here, and matching schemes is the rule
    // the rest of this module keeps.
    if scheme_of(item_url) != Some("https") || scheme_of(origin) != Some("https") {
        return false;
    }
    let Some(domains) = provider_domains(method) else {
        return false;
    };
    let (Some(item_host), Some(origin_host)) = (host_of(item_url), host_of(origin)) else {
        return false;
    };
    domains.iter().any(|d| host_covers(d, &item_host))
        && domains.iter().any(|d| host_covers(d, &origin_host))
}

/// Why this item must not be typed into this origin's form, if it must not.
///
/// One place, so the list the popup draws and the call that hands over a
/// password can never disagree about what is fillable.
fn refuse_fill(fields: &LoginFields, origin: &str) -> Option<&'static str> {
    let on_provider_page = provider_account_covers(&fields.method, &fields.url, origin);
    if !url_covers(&fields.url, origin) && !on_provider_page {
        return Some("that item does not belong to this site");
    }
    if is_provider_login(&fields.method) && !on_provider_page {
        return Some("that account signs in through a provider, so there is no site password to fill");
    }
    if fields.password.is_empty() {
        return Some("that item has no password");
    }
    None
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
                if !url_covers(&fields.url, origin)
                    && !provider_account_covers(&fields.method, &fields.url, origin)
                {
                    return None;
                }
                Some(Match {
                    id: base.id.to_string(),
                    title: base.title.clone(),
                    username: fields.username.clone(),
                    method: fields.method.clone(),
                    fillable: refuse_fill(fields, origin).is_none(),
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
    if let Some(why) = refuse_fill(fields, origin) {
        return Err(why);
    }
    Ok((fields.username.clone(), fields.password.clone()))
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

fn json(status: u16, body: serde_json::Value) -> Response<std::io::Cursor<Vec<u8>>> {
    json_raw(status, &body.to_string())
}

fn json_raw(status: u16, body: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    let header = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
        .expect("static header");
    // Deliberately no Access-Control-Allow-Origin: a page that guesses the
    // port may reach the socket, but it may never read the answer.
    Response::from_string(body)
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
/// The length cap is not about parsing: it stops a paired client writing
/// kilobytes into the vault on every re-pair. An extension id is ~50 chars.
fn is_extension_origin(origin: &str) -> bool {
    if origin.len() > MAX_ORIGIN {
        return false;
    }
    // moz-extension:// is here for the Firefox port; Chrome is what ships.
    origin.starts_with("chrome-extension://") || origin.starts_with("moz-extension://")
}

fn extension_origin(req: &Request) -> Option<String> {
    let origin = header_value(req, "Origin")?;
    is_extension_origin(origin).then(|| origin.to_string())
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
    let redeemed = match app.state::<Bridge>().redeem(&field(body, "code")) {
        Ok(code) => code,
        Err(e) => {
            crate::log_warn!("bridge", "pairing refused: {e}");
            return fail(403, e);
        }
    };
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
        Err(e) => {
            // The code was good; only the write failed. Give it back rather
            // than making the user fetch a new one, and keep the reason (it
            // can carry a filesystem path) in the log instead of the reply.
            app.state::<Bridge>().restore(redeemed);
            crate::log_warn!("bridge", "pairing could not be saved: {e}");
            fail(500, "the pairing could not be saved")
        }
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
            // A fill deliberately does NOT reset the idle timer. It used to,
            // and that quietly disabled auto-lock: anything holding a token
            // could poll this route every few minutes and keep the vault
            // open forever. Only a human at the app extends the session, so
            // when a fill lands near the end of the timer we ask for one.
            let remaining = state.autolock.lock().unwrap().remaining_secs();
            if remaining <= EXTEND_PROMPT_SECS {
                let _ = app.emit("vault://extend-request", remaining);
                crate::tray::reveal(app);
                crate::log_info!("bridge", "fill near auto-lock, asked to extend");
            }
            crate::log_info!("bridge", "filled one login");
            // Zeroized on the way out. The response buffer tiny_http builds
            // is still its own copy that this cannot reach, so this narrows
            // the window rather than closing it.
            let body = Zeroizing::new(
                serde_json::json!({ "username": username, "password": password }).to_string(),
            );
            json_raw(200, &body)
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
    fn a_provider_account_reaches_the_page_that_asks_for_its_password() {
        // "Gmail" is saved at mail.google.com; Google asks for the password
        // at accounts.google.com, a sibling host. Without the widening the
        // popup sends you to the Google button and then has nothing to give
        // you when you arrive.
        let mut v = new_vault(vec![0; 16]);
        let gmail = provider_login("Gmail", "https://mail.google.com", "google", "me@gmail.test", "hunter2");
        let id = gmail.id();
        crate::vault::add_item(&mut v, gmail);

        for origin in [
            "https://accounts.google.com",
            "https://google.com",
            "https://mail.google.com",
        ] {
            let out = matches_for(&v, origin);
            assert_eq!(out.len(), 1, "not offered on {origin}");
            assert!(out[0].fillable, "offered but not fillable on {origin}");
            let (user, pass) = credentials_for(&v, id, origin).unwrap();
            assert_eq!((user.as_str(), pass.as_str()), ("me@gmail.test", "hunter2"));
        }
    }

    #[test]
    fn the_widening_reaches_only_that_providers_own_domains() {
        let mut v = new_vault(vec![0; 16]);
        let gmail = provider_login("Gmail", "https://mail.google.com", "google", "me@gmail.test", "hunter2");
        let id = gmail.id();
        crate::vault::add_item(&mut v, gmail);

        for origin in [
            "https://twitch.tv",
            "https://google.com.evil.test",
            "https://notgoogle.com",
            "https://login.microsoftonline.com",
            "http://accounts.google.com", // plaintext: sign-in is https
        ] {
            assert!(matches_for(&v, origin).is_empty(), "leaked onto {origin}");
            assert_eq!(
                credentials_for(&v, id, origin).unwrap_err(),
                "that item does not belong to this site",
                "granted on {origin}"
            );
        }
    }

    #[test]
    fn a_site_item_using_a_provider_is_not_widened_onto_that_provider() {
        // The Twitch item is method=google but lives on twitch.tv. It must
        // not become offerable on Google's sign-in page, where its borrowed
        // identity would mean nothing and its presence would only confuse.
        let mut v = new_vault(vec![0; 16]);
        crate::vault::add_item(
            &mut v,
            provider_login("Twitch", "https://twitch.tv/", "google", "me@gmail.test", ""),
        );
        assert!(matches_for(&v, "https://accounts.google.com").is_empty());
    }

    #[test]
    fn microsoft_sign_in_hosts_are_covered_too() {
        let mut v = new_vault(vec![0; 16]);
        crate::vault::add_item(
            &mut v,
            provider_login("Outlook", "https://outlook.live.com", "microsoft", "me@outlook.test", "pw"),
        );
        for origin in ["https://login.microsoftonline.com", "https://login.live.com"] {
            let out = matches_for(&v, origin);
            assert_eq!(out.len(), 1, "not offered on {origin}");
            assert!(out[0].fillable);
        }
    }

    #[test]
    fn the_list_and_the_fill_never_disagree() {
        // Anything the popup draws a button for must actually be granted,
        // and anything it draws as a hint must actually be refused.
        let mut v = new_vault(vec![0; 16]);
        crate::vault::add_item(&mut v, login("Site", "https://site.test/", "me", "pw"));
        crate::vault::add_item(&mut v, login("NoPassword", "https://site.test/", "me", ""));
        crate::vault::add_item(
            &mut v,
            provider_login("Twitch", "https://site.test/", "google", "me@gmail.test", ""),
        );
        crate::vault::add_item(
            &mut v,
            provider_login("Gmail", "https://mail.google.com", "google", "me@gmail.test", "pw"),
        );

        for origin in ["https://site.test", "https://accounts.google.com", "https://other.test"] {
            for m in matches_for(&v, origin) {
                let id = Uuid::parse_str(&m.id).unwrap();
                let granted = credentials_for(&v, id, origin).is_ok();
                assert_eq!(m.fillable, granted, "{} disagreed on {origin}", m.title);
            }
        }
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
    fn a_redeemed_code_can_be_put_back_when_the_pairing_is_not_saved() {
        // A disk error must not cost the user their code.
        let b = Bridge::default();
        let code = b.new_code();
        let held = b.redeem(&code).unwrap();
        assert!(b.redeem(&code).is_err(), "consumed while held");
        b.restore(held);
        assert!(b.redeem(&code).is_ok(), "not usable again after restore");
    }

    #[test]
    fn restoring_never_clobbers_a_newer_code() {
        // The user may have asked for a fresh code in the meantime; that one
        // is the live one and the stale code must not displace it.
        let b = Bridge::default();
        let first = b.new_code();
        let held = b.redeem(&first).unwrap();
        let second = b.new_code();
        b.restore(held);
        assert!(b.redeem(&second).is_ok(), "newer code was clobbered");
    }

    #[test]
    fn a_private_suffix_covers_nothing() {
        // Two apps on vercel.app, or two blogs on blogspot.com, are as much
        // strangers as two sites on co.uk.
        for suffix in ["github.io", "vercel.app", "blogspot.com", "herokuapp.com", "pages.dev"] {
            assert!(
                !host_covers(suffix, &format!("someoneelse.{suffix}")),
                "{suffix} wrongly covered a subdomain"
            );
        }
        // A normal domain under one of them is still fine.
        assert!(host_covers("mysite.github.io", "www.mysite.github.io"));
    }

    #[test]
    fn only_an_extension_origin_of_a_sane_length_is_accepted() {
        assert!(is_extension_origin("chrome-extension://abcdefghijklmnopabcdefghijklmnop"));
        assert!(is_extension_origin("moz-extension://abcdefghijklmnopabcdefghijklmnop"));
        // A page never reaches the routes behind this.
        for origin in ["https://evil.test", "http://localhost:3000", "file://", ""] {
            assert!(!is_extension_origin(origin), "{origin} was accepted");
        }
        // Kilobytes of "origin" would otherwise land in the vault on pairing.
        let long = format!("chrome-extension://{}", "a".repeat(MAX_ORIGIN));
        assert!(!is_extension_origin(&long));
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

    /// Return one function's body, delimited by brace matching. Same trick as
    /// `commands.rs` uses, and for the same reason: some invariants live in
    /// which call a function does *not* make.
    fn body_of<'a>(src: &'a str, sig: &str) -> &'a str {
        let from = src.find(sig).unwrap_or_else(|| panic!("{sig} not found"));
        let rest = &src[from..];
        let open = rest.find('{').expect("function has no body");
        let mut depth = 0usize;
        for (i, c) in rest[open..].char_indices() {
            match c {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        return &rest[open..open + i + 1];
                    }
                }
                _ => {}
            }
        }
        panic!("unbalanced braces after {sig}");
    }

    #[test]
    fn a_fill_never_resets_the_idle_timer_by_itself() {
        // It used to, and that silently disabled auto-lock: anything holding
        // a pairing token could poll /credentials every few minutes and keep
        // the vault open indefinitely. Only a person at the app extends the
        // session, which is what the extend prompt is for.
        let src = std::fs::read_to_string(file!()).unwrap();
        let body = body_of(&src, "fn credentials(");
        assert!(
            !body.contains("reset()"),
            "the fill route must not reset the idle timer"
        );
        assert!(
            body.contains("vault://extend-request"),
            "the fill route must ask the user instead"
        );
    }

    #[test]
    fn ct_eq_matches_normal_equality() {
        assert!(ct_eq("abc", "abc"));
        assert!(!ct_eq("abc", "abd"));
        assert!(!ct_eq("abc", "abcd"));
        assert!(ct_eq("", ""));
    }
}

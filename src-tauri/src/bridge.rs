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
//!    extension should stop being able to ask for anything. Every route
//!    therefore answers an unverifiable caller the same way — `401 not
//!    paired` — whether the vault is locked or the token is simply wrong.
//!    Anything that told those two apart would be a free "is the vault open
//!    right now?" oracle for every process on the machine.
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
//! and the signing key are what actually hold it.
//!
//! **A paired browser may ask about any site; it is only answered for the
//! sites you approved.** For any other site `/matches` gives the same reply
//! whether the vault has logins for it or not — no accounts, no count — so a
//! key holder walking a list of domains learns nothing. A password is refused
//! and the app raises a dialog, which is where the user sees how many logins
//! match. Approvals are remembered per paired client, so the cost is one
//! click per site, once, and a key holder trying to empty the vault is a
//! dialog per site instead of a silent download.
//!
//! **The key is only as private as the browser's profile.** WebCrypto will
//! not export it, but the browser still writes it under its user-data
//! directory, and a program running as the same user that parses that format
//! can recover it. The vault must be unlocked for it to work, and revoking
//! the pairing in Settings kills it immediately.
//!
//! Two things bound it. Keys **rotate**: once the current key is
//! `KEY_ROTATE_SECS` old the app asks the browser to replace it through
//! `/rekey`, so a copy lifted from the profile stops working after the real
//! extension's next call — and whichever of the two is left holding the dead
//! key gets a 401 the user can see. Keys also **expire** `KEY_TTL_SECS` after
//! they were issued, which with hourly rotation means a week without use.

use crate::commands::{host_of, AppState};
use crate::crypto::random_bytes;
use crate::vault::{Item, LoginFields, PairedClient, Vault};
use http_body_util::{BodyExt, Full, Limited};
use hyper::body::Bytes;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use p256::ecdsa::signature::Verifier;
use p256::ecdsa::{Signature, VerifyingKey};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::net::TcpListener;
use tokio::sync::Semaphore;
use uuid::Uuid;
use zeroize::Zeroizing;

/// The one port the bridge listens on.
///
/// A range was tried — bind the first free port, let the extension probe for
/// it — and taken back out, because it quietly broke the rule the whole
/// design rests on: *nothing else on this machine can read the pairing code
/// off the user's screen*. With a range, a local process that squats 38471
/// pushes the app to 38472, and the extension, probing upwards, offers the
/// code to the squatter first. The squatter then redeems that code against
/// the real app and is a paired browser.
///
/// One fixed port fails loudly instead: the bridge does not come up, Settings
/// says why, and no code goes anywhere. If collisions ever turn up in
/// practice, the fix is to stop sending a secret at pairing time at all —
/// have the extension show a fingerprint of its public key and the app ask
/// the user to confirm it — and only then is probing safe.
pub const PORT: u16 = 38471;

/// How long a pairing code stays good once it is on screen.
const CODE_TTL: Duration = Duration::from_secs(180);
/// Wrong codes allowed before the code is burnt, so a local process cannot
/// sit and guess. Three, because the user is typing it by hand.
const CODE_TRIES: u8 = 3;
/// Nothing this endpoint accepts is large.
const MAX_BODY: usize = 8 * 1024;
/// Connections served at once. One browser needs one; the rest are slack.
/// Past this the socket is closed rather than queued, because a queue is what
/// an attacker would be trying to fill.
const MAX_CONNECTIONS: usize = 16;
/// Longest a connection may live, reading and answering included. Without
/// this a process that opens a socket and says nothing holds a task for as
/// long as it likes.
const CONN_DEADLINE: Duration = Duration::from_secs(10);
/// Pause after a failed accept, so a listener that is refusing every
/// connection does not spin a core.
const ACCEPT_BACKOFF: Duration = Duration::from_millis(200);
/// How far the browser's clock may be from this one before a signature is
/// refused. Also the window in which a captured request could be replayed —
/// narrow, and on loopback, where capturing one means already owning the
/// machine.
const SIGNATURE_SKEW_SECS: i64 = 60;
/// Longest `Origin` kept. An extension id is ~50 characters; this only stops
/// a paired client writing kilobytes into the vault on every re-pair.
const MAX_ORIGIN: usize = 128;
/// When a fill lands with less than this left on the idle timer, ask whether
/// to stay unlocked. Long enough that the prompt is not a race.
const EXTEND_PROMPT_SECS: u64 = 120;
/// How long a key stays good without being used. A browser left closed for
/// longer than this has to be paired again.
const KEY_TTL_SECS: i64 = 7 * 24 * 60 * 60;
/// How old the current key may get before the app asks the browser to
/// replace it. An hour: short enough that key material recovered from the
/// browser profile is stale before it is useful, long enough that a day of
/// browsing costs one vault write.
const KEY_ROTATE_SECS: i64 = 60 * 60;
/// How long the key a rekey replaced keeps working. Only long enough to cover
/// a call the browser had already signed when the swap happened.
const KEY_GRACE_SECS: i64 = 30;
/// How long a password copied through `/copy` stays on the clipboard. Same
/// TTL the app's own copy buttons use.
const COPY_TTL: Duration = Duration::from_secs(60);
/// Quiet window after an approval dialog goes up, so an extension that
/// retries — or a script that hammers the route — cannot stack prompts.
const APPROVE_REPROMPT: Duration = Duration::from_secs(10);
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
    /// None until `start` has run; Some(err) when no port was available.
    listen_error: Mutex<Option<String>>,

    /// When the last approval dialog was asked for. One dialog per
    /// `APPROVE_REPROMPT`, for *any* host, not one per host: a caller holding
    /// the key can name whatever hosts it likes, and a per-host limit lets it
    /// cycle them to put a dialog on screen as fast as it can ask. A stream
    /// of prompts that keep pulling the window forward is how a person ends
    /// up clicking Allow on one they did not read.
    last_ask: Mutex<Option<Instant>>,
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

    /// True at most once per `APPROVE_REPROMPT`, whatever is being asked
    /// about.
    fn may_ask(&self) -> bool {
        let mut slot = self.last_ask.lock().unwrap();
        if let Some(when) = slot.as_ref() {
            if when.elapsed() < APPROVE_REPROMPT {
                return false;
            }
        }
        *slot = Some(Instant::now());
        true
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

/// Is this host a public suffix in its own right?
///
/// It has to be the real Public Suffix List, because the answer decides
/// whether one site's saved login may be offered to another. This was a
/// hand-written table of the couple of dozen suffixes that had turned up so
/// far, which is fine until the first one that has not: a login saved against
/// a missing entry gets offered to every site under it.
///
/// The `psl` crate compiles the list in, private section included, so
/// `github.io` and `vercel.app` are suffixes here too — two sites under those
/// are strangers in exactly the way two sites under `co.uk` are.
fn is_public_suffix(host: &str) -> bool {
    psl::suffix_str(host) == Some(host)
}

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
    if is_public_suffix(item_host) || item_host.matches('.').count() < 1 {
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
/// What one item can put into one page.
///
/// `Debug` is hand-written for the same reason `PairCode`'s is: derived, it
/// would print the password into any test failure that formats a
/// `Result<Handout, _>`, and `unwrap_err` formats one on every assertion.
pub(crate) struct Handout {
    pub username: String,
    pub password: String,
    /// The phone number this account signs in with, if it has one. Sites that
    /// ask for a phone instead of a username get it here; the extension
    /// splits the dial code off itself.
    pub phone: String,
}

impl std::fmt::Debug for Handout {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Handout")
            .field("username", &"<redacted>")
            .field("password", &"<redacted>")
            .field("phone", &"<redacted>")
            .finish()
    }
}

pub(crate) fn credentials_for(
    vault: &Vault,
    id: Uuid,
    origin: &str,
) -> Result<Handout, &'static str> {
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
    Ok(Handout {
        username: fields.username.clone(),
        password: fields.password.clone(),
        phone: fields.phone.clone(),
    })
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

type Reply = Response<Full<Bytes>>;

fn json(status: u16, body: serde_json::Value) -> Reply {
    json_raw(status, &body.to_string())
}

fn json_raw(status: u16, body: &str) -> Reply {
    Response::builder()
        .status(status)
        .header("Content-Type", "application/json")
        // Deliberately no Access-Control-Allow-Origin: a page that guesses the
        // port may reach the socket, but it may never read the answer.
        .body(Full::new(Bytes::copy_from_slice(body.as_bytes())))
        .expect("a header map this small cannot fail")
}

fn fail(status: u16, message: &str) -> Reply {
    json(status, serde_json::json!({ "error": message }))
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

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn from_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 || s.len() > 512 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

/// One request, already read off the socket.
///
/// Built while still async and then handed to the blocking router, so the
/// runtime is never holding a lock or waiting on the disk.
struct Incoming {
    path: String,
    origin: String,
    /// The body exactly as it arrived. The signature covers these bytes, so
    /// re-serialising the parsed JSON would break it.
    raw_body: String,
    body: serde_json::Value,
    timestamp: i64,
    signature: Vec<u8>,
}

// ---------------------------------------------------------------------------
// Proof of possession
// ---------------------------------------------------------------------------

/// What the extension signs.
///
/// Path, clock and body, so a signature proves this exact call and nothing
/// else: it cannot be lifted off one request and put on another, and it
/// cannot be replayed once the clock has moved past the skew window. WebCrypto
/// hashes this with SHA-256 before signing, and `verify` does the same.
fn signed_payload(path: &str, timestamp: i64, raw_body: &str) -> String {
    let digest = Sha256::digest(raw_body.as_bytes());
    format!("{path}\n{timestamp}\n{}", to_hex(&digest))
}

/// Does this request carry a signature made by the private half of
/// `public_key`?
///
/// There is no secret to compare here. The browser generated a P-256 key
/// WebCrypto will not export, kept the private half, and sent the public
/// point at pairing time. Reading the vault tells you how to *check* a
/// signature, never how to make one.
fn signed_by(public_key: &str, inc: &Incoming, now: i64) -> bool {
    if public_key.is_empty() || inc.signature.len() != 64 {
        return false;
    }
    if (now - inc.timestamp).abs() > SIGNATURE_SKEW_SECS {
        return false;
    }
    let Some(point) = from_hex(public_key) else {
        return false;
    };
    let Ok(key) = VerifyingKey::from_sec1_bytes(&point) else {
        return false;
    };
    let Ok(sig) = Signature::from_slice(&inc.signature) else {
        return false;
    };
    key.verify(signed_payload(&inc.path, inc.timestamp, &inc.raw_body).as_bytes(), &sig)
        .is_ok()
}

/// Is this a P-256 public point the app could ever check a signature against?
fn is_public_key(hex: &str) -> bool {
    from_hex(hex)
        .map(|b| VerifyingKey::from_sec1_bytes(&b).is_ok())
        .unwrap_or(false)
}

/// Seconds since this client's current key was registered.
fn key_age(client: &PairedClient, now: i64) -> i64 {
    now - client.key_issued_at
}

/// Which paired client signed this request, if any did.
///
/// An index rather than a reference, because the caller may go on to replace
/// the key, which needs the vault mutably.
fn client_index(vault: &Vault, inc: &Incoming, now: i64) -> Option<usize> {
    vault.paired.iter().position(|c| {
        if c.origin != inc.origin {
            return false;
        }
        // The key a rekey replaced, for a few seconds: a call the browser had
        // already signed when the swap landed is not an intruder.
        if now <= c.prev_until && signed_by(&c.prev_public_key, inc, now) {
            return true;
        }
        key_age(c, now) <= KEY_TTL_SECS && signed_by(&c.public_key, inc, now)
    })
}

/// Has the user allowed this browser to be handed a password for this host?
///
/// Exact host, deliberately: approving `github.com` does not approve
/// `gist.github.com`. Widening it would mean the dialog the user answered
/// said less than what it granted, which is the whole point of asking.
fn approved(client: &PairedClient, host: &str) -> bool {
    client.allowed_hosts.iter().any(|h| h == host)
}

/// Put the approval dialog on screen and bring the app forward.
///
/// Only ever a *request*. Nothing here writes the approval — that happens in
/// `bridge_approve`, from a click in the app, which is the only place it can
/// happen without the dialog being theatre.
///
/// `count` is how many saved logins match the site. It goes to the app's own
/// window and nowhere else: the browser is never told, so a copied key cannot
/// learn which sites the vault holds.
fn ask_approval(app: &AppHandle, label: &str, origin: &str, host: &str, count: usize) {
    if !app.state::<Bridge>().may_ask() {
        return;
    }
    let _ = app.emit(
        "vault://approve-request",
        serde_json::json!({ "label": label, "origin": origin, "host": host, "count": count }),
    );
    crate::tray::reveal(app);
    crate::log_info!("bridge", "approval asked for host={host}");
}

/// A secret just left the vault for the browser.
///
/// The handout deliberately does NOT reset the idle timer. It used to, and
/// that quietly disabled auto-lock: anything holding a key could poll every
/// few minutes and keep the vault open forever. Only a human at the app
/// extends the session, so when a handout lands near the end of the timer we
/// ask for one.
fn after_handout(app: &AppHandle, state: &tauri::State<'_, AppState>) {
    let remaining = state.autolock.lock().unwrap().remaining_secs();
    if remaining <= EXTEND_PROMPT_SECS {
        let _ = app.emit("vault://extend-request", remaining);
        crate::tray::reveal(app);
        crate::log_info!("bridge", "handout near auto-lock, asked to extend");
    }
}

// ---------------------------------------------------------------------------
// Listening
// ---------------------------------------------------------------------------

pub fn start(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(e) => {
                let msg = format!("the bridge could not start: {e}");
                crate::log_warn!("bridge", "{msg}");
                *handle.state::<Bridge>().listen_error.lock().unwrap() = Some(msg);
                return;
            }
        };
        rt.block_on(serve(handle));
    });
}

async fn serve(app: AppHandle) {
    let listener = match TcpListener::bind(("127.0.0.1", PORT)).await {
        Ok(l) => l,
        Err(e) => {
            let msg = format!("port {PORT} is not available: {e}");
            crate::log_warn!("bridge", "{msg}");
            *app.state::<Bridge>().listen_error.lock().unwrap() = Some(msg);
            return;
        }
    };
    crate::log_info!("bridge", "listening on 127.0.0.1:{PORT}");

    // Two things a connection cannot do: live forever, or arrive in numbers.
    // A process that opens a socket and then says nothing used to cost one OS
    // thread for as long as it cared to hold it.
    let live = std::sync::Arc::new(Semaphore::new(MAX_CONNECTIONS));
    loop {
        let stream = match listener.accept().await {
            Ok((stream, _)) => stream,
            Err(e) => {
                // Out of file descriptors, usually. Retrying instantly turns
                // that into a busy loop on a core, so give it a moment.
                crate::log_warn!("bridge", "accept failed: {e}");
                tokio::time::sleep(ACCEPT_BACKOFF).await;
                continue;
            }
        };
        let Ok(permit) = live.clone().try_acquire_owned() else {
            // Dropping the stream closes it. Refusing is the right answer:
            // one browser needs one connection at a time.
            drop(stream);
            continue;
        };
        let app = app.clone();
        tokio::spawn(async move {
            let _permit = permit;
            let io = TokioIo::new(stream);
            let service = service_fn(move |req| serve_one(app.clone(), req));
            let conn = http1::Builder::new().serve_connection(io, service);
            // The deadline covers reading the request as well as answering it,
            // which is the half tiny_http gave no way to bound.
            let _ = tokio::time::timeout(CONN_DEADLINE, conn).await;
        });
    }
}

async fn serve_one(
    app: AppHandle,
    req: Request<hyper::body::Incoming>,
) -> Result<Reply, std::convert::Infallible> {
    Ok(read_request(&app, req).await)
}

async fn read_request(app: &AppHandle, req: Request<hyper::body::Incoming>) -> Reply {
    if req.method() != hyper::Method::POST {
        return fail(405, "POST only");
    }
    let (parts, body) = req.into_parts();
    let head = |name: &str| {
        parts
            .headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string()
    };
    let origin = head("origin");
    if !is_extension_origin(&origin) {
        // A browser tab's Origin never starts with chrome-extension://, so
        // this is where a curious web page stops.
        return fail(403, "not a browser extension");
    }
    let raw_body = match Limited::new(body, MAX_BODY).collect().await {
        Ok(b) => match String::from_utf8(b.to_bytes().to_vec()) {
            Ok(s) => s,
            Err(_) => return fail(400, "malformed request"),
        },
        Err(_) => return fail(413, "that request is too large"),
    };
    let body = if raw_body.trim().is_empty() {
        serde_json::json!({})
    } else {
        match serde_json::from_str(&raw_body) {
            Ok(v) => v,
            Err(_) => return fail(400, "malformed request"),
        }
    };
    let inc = Incoming {
        path: parts.uri.path().to_string(),
        origin,
        raw_body,
        body,
        timestamp: head("x-pm-timestamp").parse().unwrap_or(0),
        signature: from_hex(&head("x-pm-signature")).unwrap_or_default(),
    };
    // Everything past here locks the vault and may write the disk, so it runs
    // off the runtime rather than on it.
    let app = app.clone();
    match tokio::task::spawn_blocking(move || route(&app, &inc)).await {
        Ok(reply) => reply,
        Err(_) => fail(500, "the request could not be handled"),
    }
}

fn route(app: &AppHandle, inc: &Incoming) -> Reply {
    match inc.path.as_str() {
        "/pair" => pair(app, inc),
        "/rekey" => rekey(app, inc),
        "/status" => status(app, inc),
        "/matches" => matches(app, inc),
        "/credentials" => credentials(app, inc),
        "/copy" => copy(app, inc),
        "/ask" => ask(app, inc),
        _ => fail(404, "no such endpoint"),
    }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

fn pair(app: &AppHandle, inc: &Incoming) -> Reply {
    let state = app.state::<AppState>();
    if !state.is_unlocked() {
        // The same answer a good code gets when no pairing is in progress. A
        // locked vault cannot have one anyway — the code is issued from
        // Settings, which is behind the unlock — so saying "unlock first"
        // only ever told a local process that the vault was shut.
        return fail(403, "no pairing in progress");
    }
    let public_key = field(&inc.body, "publicKey");
    if !is_public_key(&public_key) {
        return fail(400, "that is not a P-256 public key");
    }
    let redeemed = match app.state::<Bridge>().redeem(&field(&inc.body, "code")) {
        Ok(code) => code,
        Err(e) => {
            crate::log_warn!("bridge", "pairing refused: {e}");
            return fail(403, e);
        }
    };
    let label = {
        let l = field(&inc.body, "label");
        let l = l.trim();
        if l.is_empty() { "Browser".to_string() } else { l.chars().take(40).collect() }
    };
    let now = chrono::Utc::now().timestamp();

    match crate::commands::add_paired_client(
        &state,
        PairedClient {
            origin: inc.origin.clone(),
            label,
            public_key,
            paired_at: now,
            key_issued_at: now,
            prev_public_key: String::new(),
            prev_until: 0,
            // Pairing grants the ability to ask, not the vault. Every host is
            // approved on screen, one at a time, from here on.
            allowed_hosts: Vec::new(),
        },
    ) {
        Ok(()) => {
            crate::log_info!("bridge", "paired origin={}", inc.origin);
            json(200, serde_json::json!({ "paired": true }))
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

/// Register a new key, signed by the one it replaces.
///
/// This is why the key is asymmetric. A shared secret could only be rotated
/// by sending the new secret over the wire, which means generating one the
/// browser can export — and an exportable key is the thing this design
/// exists to avoid. A public point can be shouted.
///
/// The old key stays valid for `KEY_GRACE_SECS`, because the browser may have
/// signed another call before this one landed.
fn rekey(app: &AppHandle, inc: &Incoming) -> Reply {
    let state = app.state::<AppState>();
    let fresh = field(&inc.body, "publicKey");
    if !is_public_key(&fresh) {
        return fail(400, "that is not a P-256 public key");
    }
    let now = chrono::Utc::now().timestamp();
    let mut guard = state.vault.lock().unwrap();
    let Some(vault) = guard.as_mut() else {
        return fail(401, "not paired");
    };
    let Some(idx) = client_index(vault, inc, now) else {
        return fail(401, "not paired");
    };
    let (was_key, was_issued, was_prev, was_until) = {
        let c = &mut vault.paired[idx];
        let was_key = std::mem::replace(&mut c.public_key, fresh);
        let was_issued = c.key_issued_at;
        let was_prev = std::mem::replace(&mut c.prev_public_key, was_key.clone());
        let was_until = c.prev_until;
        c.key_issued_at = now;
        c.prev_until = now + KEY_GRACE_SECS;
        (was_key, was_issued, was_prev, was_until)
    };
    if let Err(e) = crate::commands::save_unlocked(&state, vault) {
        // Put the old key back. Accepting a key this vault will not honour
        // after a restart would unpair the browser for real.
        let c = &mut vault.paired[idx];
        c.public_key = was_key;
        c.key_issued_at = was_issued;
        c.prev_public_key = was_prev;
        c.prev_until = was_until;
        crate::log_warn!("bridge", "rekey could not be saved: {e}");
        return fail(500, "the new key could not be saved");
    }
    crate::log_info!("bridge", "rekeyed origin={}", inc.origin);
    json(200, serde_json::json!({ "rekeyed": true }))
}

/// Is the vault open to *this* extension right now?
///
/// There is no answer for anyone else. This used to reply `unlocked: false`
/// without looking at the caller, on the grounds that a locked vault has
/// nothing to check a signature against and the extension needs the state to
/// put on screen. Both halves were true and the result was still an oracle:
/// any process on the machine could poll this port and watch, in real time,
/// for the moment the vault opened.
///
/// So a locked vault answers exactly what an unsigned request answers,
/// because a locked vault genuinely cannot tell them apart. The extension
/// reads 401 as "locked, or not paired any more", keeps its key, and says so.
fn status(app: &AppHandle, inc: &Incoming) -> Reply {
    let state = app.state::<AppState>();
    let session = match authed(&state, inc) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let due = rekey_due(&session);
    reply(serde_json::json!({ "unlocked": true, "paired": true }), due)
}

/// An authenticated request: the unlocked vault, held open, plus which paired
/// client signed it.
struct Session<'a> {
    guard: std::sync::MutexGuard<'a, Option<Vault>>,
    client: usize,
    now: i64,
}

impl Session<'_> {
    fn vault(&self) -> &Vault {
        self.guard.as_ref().expect("checked in authed")
    }

    fn client(&self) -> &PairedClient {
        &self.vault().paired[self.client]
    }
}

/// Every route past `/pair` needs a live key *and* an open vault.
///
/// One failure for both, always `401 not paired`. A locked vault cannot
/// decrypt its own key list, so it cannot tell a real extension from a
/// stranger — and any status code that admitted the difference would tell
/// every process on this machine when the vault was open.
// The Err is a whole HTTP response rather than a code to look up later.
// clippy calls 144 bytes large; on a loopback endpoint answering one browser
// it is not worth a Box and an extra deref at every route.
#[allow(clippy::result_large_err)]
fn authed<'a>(state: &'a tauri::State<'_, AppState>, inc: &Incoming) -> Result<Session<'a>, Reply> {
    let now = chrono::Utc::now().timestamp();
    let guard = state.vault.lock().unwrap();
    let client = guard
        .as_ref()
        .and_then(|v| client_index(v, inc, now))
        .ok_or_else(|| fail(401, "not paired"))?;
    Ok(Session { guard, client, now })
}

/// Is this client's key old enough that the browser should replace it?
///
/// The app keeps this clock rather than the extension, so there is one answer
/// and clearing the browser's storage cannot quietly stop rotation.
fn rekey_due(session: &Session) -> bool {
    key_age(session.client(), session.now) >= KEY_ROTATE_SECS
}

/// A 200, with a nudge to rekey when the key has aged.
fn reply(mut body: serde_json::Value, rekey_due: bool) -> Reply {
    if rekey_due {
        body["rekey"] = serde_json::Value::Bool(true);
    }
    json(200, body)
}

fn matches(app: &AppHandle, inc: &Incoming) -> Reply {
    let state = app.state::<AppState>();
    let session = match authed(&state, inc) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let due = rekey_due(&session);
    let page = field(&inc.body, "origin");
    let Some(host) = host_of(&page) else {
        return reply(serde_json::json!({ "items": [] }), due);
    };
    if !approved(session.client(), &host) {
        // The same answer for every unapproved site, whether the vault has
        // anything for it or not. Even a count, or a yes/no, would let a
        // copied key map which sites the vault holds. How many logins there
        // are is shown in the app's approval dialog instead, where only the
        // user can read it.
        crate::log_info!("bridge", "matches withheld host={host}");
        return reply(
            serde_json::json!({ "items": [], "needsApproval": true, "host": host }),
            due,
        );
    }
    let items = matches_for(session.vault(), &page);
    crate::log_info!("bridge", "matches n={}", items.len());
    reply(serde_json::json!({ "items": items }), due)
}

/// Ask the app to put the approval dialog up, and nothing else.
///
/// The popup and the context menu both need a way to say "let me use this
/// site" that does not involve clicking an account and watching it fail.
/// Nothing leaves the vault here, so this is the one route that hands back no
/// information at all.
fn ask(app: &AppHandle, inc: &Incoming) -> Reply {
    let state = app.state::<AppState>();
    let session = match authed(&state, inc) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let due = rekey_due(&session);
    let Some(host) = host_of(&field(&inc.body, "origin")) else {
        return fail(400, "not a web origin");
    };
    // Already approved: say so instead of putting a dialog up for a question
    // that has been answered. The extension caches refusals, and the app has
    // no way to tell it when one stops being true, so this is how a stale
    // menu finds out.
    if approved(session.client(), &host) {
        return reply(serde_json::json!({ "asked": false, "approved": true }), due);
    }
    let (label, origin) = (session.client().label.clone(), session.client().origin.clone());
    let count = matches_for(session.vault(), &field(&inc.body, "origin")).len();
    // The vault lock goes before the window comes forward. See `Gate::Ask`.
    drop(session);
    ask_approval(app, &label, &origin, &host, count);
    reply(serde_json::json!({ "asked": true, "approved": false }), due)
}

/// What the gate below decided.
enum Gate {
    /// Cleared: this item, for this page origin.
    Go(Uuid, String),
    /// Refused outright, with the answer to send.
    Stop(Reply),
    /// Refused, and a human should be asked. The caller sends `reply` after
    /// letting the vault lock go — `ask_approval` pulls the app window
    /// forward, and doing that from inside the lock would have the bridge
    /// holding the vault while it waits on the UI thread.
    Ask { reply: Reply, label: String, origin: String, host: String, count: usize },
}

/// The checks every route that hands out a secret runs, in one place.
///
/// Both callers need the identical decision, and a second copy of it is how
/// one of them ends up a version behind. It decides and returns; it does not
/// act, so that the acting can happen with no locks held.
fn gate(session: &Session, inc: &Incoming) -> Gate {
    let Ok(id) = Uuid::parse_str(&field(&inc.body, "id")) else {
        return Gate::Stop(fail(400, "not an item id"));
    };
    let page = field(&inc.body, "origin");
    let Some(host) = host_of(&page) else {
        return Gate::Stop(fail(400, "not a web origin"));
    };
    if !approved(session.client(), &host) {
        // Refused either way. Approving is a click in the app; nothing the
        // caller sends can stand in for it.
        return Gate::Ask {
            reply: json(
                403,
                serde_json::json!({
                    "error": format!("{host} is not approved for this browser yet"),
                    "needsApproval": true,
                    "host": host,
                }),
            ),
            label: session.client().label.clone(),
            origin: session.client().origin.clone(),
            count: matches_for(session.vault(), &page).len(),
            host,
        };
    }
    Gate::Go(id, page)
}

fn credentials(app: &AppHandle, inc: &Incoming) -> Reply {
    let state = app.state::<AppState>();
    let session = match authed(&state, inc) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let due = rekey_due(&session);
    let (id, page) = match gate(&session, inc) {
        Gate::Go(id, page) => (id, page),
        Gate::Stop(r) => return r,
        Gate::Ask { reply, label, origin, host, count } => {
            drop(session);
            ask_approval(app, &label, &origin, &host, count);
            return reply;
        }
    };
    match credentials_for(session.vault(), id, &page) {
        Ok(out) => {
            drop(session);
            after_handout(app, &state);
            crate::log_info!("bridge", "filled one login");
            let mut body = serde_json::json!({
                "username": out.username,
                "password": out.password,
                "phone": out.phone,
            });
            let out = &mut body;
            if due {
                out["rekey"] = serde_json::Value::Bool(true);
            }
            // Zeroized on the way out. The response buffer hyper builds is
            // still its own copy that this cannot reach, so this narrows the
            // window rather than closing it.
            let body = Zeroizing::new(out.to_string());
            json_raw(200, &body)
        }
        Err(e) => {
            crate::log_warn!("bridge", "credentials refused: {e}");
            fail(403, e)
        }
    }
}

/// Put a value on the clipboard **without letting the extension see it**.
///
/// The filler matches login forms. A PIN box, a CVV, a second form on the
/// same page — those it cannot name, and the answer used to be nothing at
/// all. Showing the password in the popup instead would park the plaintext in
/// the popup's DOM until it closed, for a value the user is going to paste
/// anyway.
///
/// So the *app* does the copying, with the same 60-second clear its own copy
/// buttons use, and the reply says only that it happened. Same origin check,
/// same approval, same item rules as a fill: this is the same secret leaving
/// by a different door.
fn copy(app: &AppHandle, inc: &Incoming) -> Reply {
    let state = app.state::<AppState>();
    let session = match authed(&state, inc) {
        Ok(s) => s,
        Err(r) => return r,
    };
    let due = rekey_due(&session);
    let which = field(&inc.body, "field");
    if which != "password" && which != "username" && which != "phone" {
        return fail(400, "copy password, username or phone");
    }
    let (id, page) = match gate(&session, inc) {
        Gate::Go(id, page) => (id, page),
        Gate::Stop(r) => return r,
        Gate::Ask { reply, label, origin, host, count } => {
            drop(session);
            ask_approval(app, &label, &origin, &host, count);
            return reply;
        }
    };
    let value = match credentials_for(session.vault(), id, &page) {
        Ok(out) => Zeroizing::new(match which.as_str() {
            "username" => out.username,
            "phone" => out.phone,
            _ => out.password,
        }),
        Err(e) => {
            crate::log_warn!("bridge", "copy refused: {e}");
            return fail(403, e);
        }
    };
    drop(session);
    if let Err(e) = crate::clipboard::copy_with_ttl(&value, COPY_TTL) {
        crate::log_warn!("bridge", "copy failed: {e}");
        return fail(500, "the clipboard could not be written");
    }
    after_handout(app, &state);
    crate::log_info!("bridge", "copied {which} to the clipboard");
    reply(
        serde_json::json!({ "copied": which, "seconds": COPY_TTL.as_secs() }),
        due,
    )
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
                phone: String::new(),
                totp: String::new(),
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
        let out = credentials_for(&v, id, "https://bank.test").unwrap();
        let (user, pass) = (out.username, out.password);
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
            let out = credentials_for(&v, id, origin).unwrap();
            let (user, pass) = (out.username, out.password);
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
    fn handing_out_a_secret_never_resets_the_idle_timer_by_itself() {
        // It used to, and that silently disabled auto-lock: anything holding
        // a pairing token could poll /credentials every few minutes and keep
        // the vault open indefinitely. Only a person at the app extends the
        // session, which is what the extend prompt is for.
        let src = std::fs::read_to_string(file!()).unwrap();
        for route in ["fn credentials(", "fn copy("] {
            let body = body_of(&src, route);
            assert!(!body.contains("reset()"), "{route} must not reset the idle timer");
            assert!(
                body.contains("after_handout("),
                "{route} must run the post-handout check"
            );
        }
        let shared = body_of(&src, "fn after_handout(");
        assert!(!shared.contains("reset()"), "the shared check must not reset the timer");
        assert!(
            shared.contains("vault://extend-request"),
            "the shared check must ask the user instead"
        );
    }

    #[test]
    fn a_secret_never_leaves_without_an_approval_check() {
        // Both handout routes go through the same gate. A second copy of
        // this decision is how one of them ends up a version behind, so the
        // test pins that there is only ever one.
        let src = std::fs::read_to_string(file!()).unwrap();
        for route in ["fn credentials(", "fn copy("] {
            let body = body_of(&src, route);
            assert!(body.contains("gate(&session"), "{route} must go through the approval gate");
        }
        assert!(
            body_of(&src, "fn gate(").contains("approved("),
            "the gate must actually check the approval list"
        );
    }

    use p256::ecdsa::signature::Signer;
    use p256::ecdsa::SigningKey;

    const EXT: &str = "chrome-extension://abcdef";

    /// A deterministic key pair, and its public point as the vault stores it.
    fn keypair(seed: u8) -> (SigningKey, String) {
        let mut scalar = [1u8; 32];
        scalar[31] = seed;
        let sk = SigningKey::from_bytes(&scalar.into()).expect("a valid scalar");
        let point = sk.verifying_key().to_encoded_point(false);
        (sk, to_hex(point.as_bytes()))
    }

    fn client(origin: &str, public_key: &str, issued: i64) -> PairedClient {
        PairedClient {
            origin: origin.to_string(),
            label: "Chrome".to_string(),
            public_key: public_key.to_string(),
            paired_at: 0,
            key_issued_at: issued,
            prev_public_key: String::new(),
            prev_until: 0,
            allowed_hosts: Vec::new(),
        }
    }

    /// A request signed the way the extension signs one.
    fn signed(sk: &SigningKey, path: &str, body: &str, ts: i64) -> Incoming {
        let sig: Signature = sk.sign(signed_payload(path, ts, body).as_bytes());
        Incoming {
            path: path.to_string(),
            origin: EXT.to_string(),
            raw_body: body.to_string(),
            body: serde_json::from_str(body).expect("test body is json"),
            timestamp: ts,
            signature: sig.to_bytes().to_vec(),
        }
    }

    fn vault_with(client: PairedClient) -> Vault {
        let mut v = new_vault(vec![0; 16]);
        v.paired.push(client);
        v
    }

    #[test]
    fn a_signed_request_is_matched_to_the_browser_that_signed_it() {
        let now = 1_700_000_000;
        let (sk, pk) = keypair(7);
        let v = vault_with(client(EXT, &pk, now - 60));
        assert_eq!(
            client_index(&v, &signed(&sk, "/status", "{}", now), now),
            Some(0)
        );
    }

    #[test]
    fn a_signature_from_another_key_is_nobody() {
        // The vault holds a public point. Reading it tells you how to check a
        // signature and never how to make one, which is the whole reason the
        // key is asymmetric.
        let now = 1_700_000_000;
        let (_, pk) = keypair(7);
        let (other, _) = keypair(9);
        let v = vault_with(client(EXT, &pk, now));
        assert_eq!(client_index(&v, &signed(&other, "/status", "{}", now), now), None);
    }

    #[test]
    fn a_signature_does_not_travel_to_another_request() {
        let now = 1_700_000_000;
        let (sk, pk) = keypair(7);
        let v = vault_with(client(EXT, &pk, now));

        // Same signature, different route: signing covers the path.
        let mut moved = signed(&sk, "/status", "{}", now);
        moved.path = "/credentials".to_string();
        assert_eq!(client_index(&v, &moved, now), None);

        // Same signature, edited body: signing covers the bytes that arrived.
        let mut tampered = signed(&sk, "/credentials", "{\"id\":\"a\"}", now);
        tampered.raw_body = "{\"id\":\"b\"}".to_string();
        assert_eq!(client_index(&v, &tampered, now), None);

        // Same signature, later: signing covers the clock.
        let stale = signed(&sk, "/status", "{}", now - SIGNATURE_SKEW_SECS - 1);
        assert_eq!(client_index(&v, &stale, now), None);
        // And a clock running ahead is refused the same way.
        let ahead = signed(&sk, "/status", "{}", now + SIGNATURE_SKEW_SECS + 1);
        assert_eq!(client_index(&v, &ahead, now), None);
    }

    #[test]
    fn a_key_is_honoured_until_it_expires() {
        let now = 1_700_000_000;
        let (sk, pk) = keypair(7);
        let v = vault_with(client(EXT, &pk, now - 60));
        assert_eq!(client_index(&v, &signed(&sk, "/status", "{}", now), now), Some(0));

        // A browser shut for longer than the TTL pairs again. The signature
        // has to be made at the later time too, or the skew check catches it
        // first and the test proves nothing about expiry.
        let later = now + KEY_TTL_SECS + 1;
        assert_eq!(client_index(&v, &signed(&sk, "/status", "{}", later), later), None);
    }

    #[test]
    fn a_key_is_only_honoured_for_the_origin_it_was_issued_to() {
        let now = 1_700_000_000;
        let (sk, pk) = keypair(7);
        let v = vault_with(client(EXT, &pk, now));
        let mut elsewhere = signed(&sk, "/status", "{}", now);
        elsewhere.origin = "chrome-extension://other".to_string();
        assert_eq!(client_index(&v, &elsewhere, now), None);
    }

    #[test]
    fn a_key_is_due_for_replacement_only_once_it_is_old() {
        let now = 1_700_000_000;
        let (_, pk) = keypair(7);
        assert!(key_age(&client(EXT, &pk, now), now) < KEY_ROTATE_SECS);
        assert!(key_age(&client(EXT, &pk, now - KEY_ROTATE_SECS), now) >= KEY_ROTATE_SECS);
    }

    #[test]
    fn the_replaced_key_still_works_for_a_few_seconds() {
        // The browser can have a call signed and in flight when a rekey
        // lands. Cut it off and the extension reports "not paired", which
        // sends the user to re-pair a browser that was never unpaired.
        let now = 1_700_000_000;
        let (old_sk, old_pk) = keypair(7);
        let (new_sk, new_pk) = keypair(9);
        let mut c = client(EXT, &new_pk, now);
        c.prev_public_key = old_pk;
        c.prev_until = now + KEY_GRACE_SECS;
        let v = vault_with(c);

        assert_eq!(client_index(&v, &signed(&new_sk, "/status", "{}", now), now), Some(0));
        assert_eq!(client_index(&v, &signed(&old_sk, "/status", "{}", now), now), Some(0));

        // And not a second longer than the grace window.
        let after = now + KEY_GRACE_SECS + 1;
        assert_eq!(client_index(&v, &signed(&old_sk, "/status", "{}", after), after), None);
    }

    #[test]
    fn a_pairing_with_no_key_is_not_a_way_in() {
        // `public_key` defaults to empty on a vault written before signatures
        // replaced tokens, and an empty string must never verify anything.
        let now = 1_700_000_000;
        let (sk, _) = keypair(7);
        let v = vault_with(client(EXT, "", now));
        assert_eq!(client_index(&v, &signed(&sk, "/status", "{}", now), now), None);

        let mut unsigned = signed(&sk, "/status", "{}", now);
        unsigned.signature = Vec::new();
        assert_eq!(client_index(&vault_with(client(EXT, "", now)), &unsigned, now), None);
    }

    #[test]
    fn only_a_real_public_point_can_be_paired() {
        let (_, pk) = keypair(7);
        assert!(is_public_key(&pk));
        assert!(!is_public_key(""));
        assert!(!is_public_key("nothex"));
        // Right length, not a point on the curve.
        assert!(!is_public_key(&"04".repeat(65)));
    }

    #[test]
    fn a_public_suffix_is_recognised_from_the_real_list() {
        // The hand-written table this replaced had two dozen entries, and a
        // miss meant one site's login offered to every site under it.
        for suffix in ["co.uk", "com.au", "github.io", "vercel.app", "com"] {
            assert!(is_public_suffix(suffix), "{suffix} is a public suffix");
        }
        for domain in ["github.com", "hsbc.co.uk", "someone.github.io"] {
            assert!(!is_public_suffix(domain), "{domain} is a domain");
        }
        // Entries the hand-written table never had.
        assert!(!host_covers("s3.eu-west-1.amazonaws.com", "evil.s3.eu-west-1.amazonaws.com"));
        assert!(!host_covers("ap-south-1.elasticbeanstalk.com", "evil.ap-south-1.elasticbeanstalk.com"));
        // And a multi-label name that is *not* a suffix still covers its own
        // subdomains: nsw.gov.au is one registrant, unlike co.uk.
        assert!(host_covers("nsw.gov.au", "roads.nsw.gov.au"));
    }

    #[test]
    fn pairing_approves_nothing_on_its_own() {
        // The whole point of the prompt: a key is permission to ask, and the
        // answer only ever comes from a click in the app.
        let (_, pk) = keypair(7);
        assert!(!approved(&client(EXT, &pk, 0), "github.com"));
    }

    #[test]
    fn an_approval_covers_that_host_and_no_other() {
        let (_, pk) = keypair(7);
        let mut c = client(EXT, &pk, 0);
        c.allowed_hosts.push("github.com".to_string());
        assert!(approved(&c, "github.com"));
        // Not the subdomain: the dialog said "github.com", so that is all it
        // may grant. gist.github.com asks for itself.
        assert!(!approved(&c, "gist.github.com"));
        // And nothing that merely ends the same way.
        assert!(!approved(&c, "notgithub.com"));
        assert!(!approved(&c, "github.com.evil.test"));
    }

    #[test]
    fn ct_eq_matches_normal_equality() {
        assert!(ct_eq("abc", "abc"));
        assert!(!ct_eq("abc", "abd"));
        assert!(!ct_eq("abc", "abcd"));
        assert!(ct_eq("", ""));
    }
}

//! Tauri IPC command handlers.
//!
//! Sensitive state (the derived key, the in-memory vault, the active
//! account) lives behind Mutex<Option<...>> in the app's managed state.

use crate::accounts::{self, Account, AccountError, AccountMeta};
use crate::autolock::AutoLock;
use crate::cloud;
use crate::config::{self, Config};
use crate::metadata::{self, UrlMetadata};
use crate::password::{self, GenOpts};
use crate::storage;
use crate::vault::{self, Item, LoginFields, PersonalInfo, Vault};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

pub struct AppState {
    /// The unlocked key set: the data key that decrypts the vault plus the
    /// wrapping keys needed to write it back.
    pub key: Mutex<Option<storage::KeySet>>,
    pub vault: Mutex<Option<Vault>>,
    pub autolock: Mutex<AutoLock>,
    pub current_account: Mutex<Option<Account>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

impl AppState {
    pub fn new() -> Self {
        Self {
            key: Mutex::new(None),
            vault: Mutex::new(None),
            autolock: Mutex::new(AutoLock::new(15)),
            current_account: Mutex::new(None),
        }
    }

    /// Read everything an upload needs while the vault is still unlocked.
    ///
    /// Returns `None` when there is nothing to do: locked, unconfigured, or
    /// unchanged since the last successful upload. The caller runs the upload
    /// after the wipe, which is safe because the job carries only the file
    /// path — the bytes on disk are already ciphertext.
    fn take_backup_job(&self) -> Option<(cloud::BackupConfig, std::path::PathBuf, Account)> {
        let account = self.current_account.lock().ok()?.clone()?;
        let cfg = {
            let vault = self.vault.lock().ok()?;
            vault.as_ref()?.backup.clone()?
        };
        let path = storage::vault_path(&account);
        let last = config::load(&account).last_cloud_backup_mtime_ms;
        if !needs_upload(&path, last) {
            return None;
        }
        Some((cfg, path, account))
    }

    fn lock_and_clear(&self) {
        if let Ok(mut k) = self.key.lock() {
            if let Some(keys) = k.as_mut() {
                // Covers the recovery KEK too, which also unwraps the data
                // key. `KeySet` wipes itself on drop as well; this stays
                // explicit so locking does not depend on when the drop runs.
                keys.wipe();
            }
            *k = None;
        }
        if let Ok(mut v) = self.vault.lock() {
            if let Some(vault) = v.as_mut() {
                vault::zeroize_secrets(vault);
            }
            *v = None;
        }
        if let Ok(mut a) = self.current_account.lock() {
            *a = None;
        }
    }

    /// Lock at the end of a session, backing up first if the vault changed.
    ///
    /// Separate from `lock_and_clear` because `reset_vault` also locks, and a
    /// reset means the user is destroying this vault — uploading it on the way
    /// out would hand the cloud a copy of exactly what they asked to erase.
    /// Whether a key is currently held. Drives the tray's lock indicator.
    pub fn is_unlocked(&self) -> bool {
        self.key.lock().map(|k| k.is_some()).unwrap_or(false)
    }

    pub(crate) fn lock_and_backup(&self) {
        // Captured before the wipe: afterwards the vault's backup config is
        // gone from memory. The upload itself runs from the on-disk file.
        let job = self.take_backup_job();
        self.lock_and_clear();
        if let Some((cfg, path, account)) = job {
            spawn_backup(cfg, path, account);
        }
    }

    /// Arm the idle timer for a new session with the account's configured
    /// timeout. Call before storing the key, so the watchdog never sees an
    /// unlocked vault paired with the previous session's expired timer.
    fn start_autolock(&self, account: &Account) {
        let mut al = self.autolock.lock().unwrap();
        // Same range `set_autolock_mins` accepts, or Settings would show a
        // timeout the watchdog silently ignores.
        al.set_timeout(config::load(account).autolock_mins.clamp(15, 90));
        al.reset();
    }

    /// Lock if the vault is unlocked and the idle timeout has elapsed.
    /// Returns true when it locked. Guards are taken one at a time: commands
    /// hold `vault` while locking `autolock`, so holding `autolock` here while
    /// clearing could deadlock.
    pub fn autolock_if_idle(&self) -> bool {
        let unlocked = self.key.lock().map(|k| k.is_some()).unwrap_or(false);
        if !unlocked {
            return false;
        }
        let expired = self.autolock.lock().map(|mut a| a.tick()).unwrap_or(false);
        if expired {
            self.lock_and_backup();
        }
        expired
    }
}

#[derive(Serialize, Clone)]
pub struct ItemMeta {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub updated_at: i64,
    pub favicon: String,
    pub method: Option<String>,
    pub username: Option<String>,
    pub card_bin: Option<String>,
    /// Bare domain of a login's URL ("twitch.tv"), used by the UI to group
    /// several accounts on the same platform under one card.
    pub host: Option<String>,
    pub pinned: bool,
    /// Unix seconds of the last favicon check; 0 when never checked.
    pub icon_checked_at: i64,
}

/// "https://www.twitch.tv/login" -> "twitch.tv". Returns None for anything
/// that isn't a usable http(s) host.
pub(crate) fn host_of(url: &str) -> Option<String> {
    let rest = url
        .trim()
        .strip_prefix("https://")
        .or_else(|| url.trim().strip_prefix("http://"))?;
    let host = rest.split(['/', '?', '#']).next()?.split('@').next_back()?;
    let host = host.split(':').next()?.trim_end_matches('.').to_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
    if host.is_empty() || !host.contains('.') {
        None
    } else {
        Some(host)
    }
}

fn to_meta_in(item: &Item, pinned: bool, icon_checked_at: i64) -> ItemMeta {
    ItemMeta { pinned, icon_checked_at, ..to_meta(item) }
}

fn to_meta(item: &Item) -> ItemMeta {
    ItemMeta {
        id: item.id().to_string(),
        kind: match item {
            Item::Login { .. } => "login",
            Item::Note { .. } => "note",
            Item::Card { .. } => "card",
        }
        .to_string(),
        title: item.base().title.clone(),
        updated_at: item.base().updated_at,
        favicon: item.base().favicon.clone(),
        method: match item {
            Item::Login { fields, .. } => Some(fields.method.clone()),
            _ => None,
        },
        username: match item {
            Item::Login { fields, .. } => {
                if fields.username.is_empty() {
                    None
                } else {
                    Some(fields.username.clone())
                }
            }
            _ => None,
        },
        host: match item {
            Item::Login { fields, .. } => host_of(&fields.url),
            _ => None,
        },
        pinned: false,
        icon_checked_at: 0,
        card_bin: match item {
            // BIN (first 6 digits) is all brand detection needs.
            Item::Card { fields, .. } => {
                let digits: String = fields.number.chars().filter(|c| c.is_ascii_digit()).take(6).collect();
                if digits.is_empty() { None } else { Some(digits) }
            }
            _ => None,
        },
    }
}

#[tauri::command]
pub fn list_accounts() -> Result<Vec<AccountMeta>, String> {
    let out = accounts::list_accounts().map_err(|e| e.to_string());
    match &out {
        Ok(v) => crate::log_info!("list_accounts", "count={}", v.len()),
        Err(e) => crate::log_warn!("list_accounts", "failed: {e}"),
    }
    out
}

#[tauri::command]
pub fn setup_vault(
    password: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<AccountMeta, String> {
    crate::log_info!("setup_vault", "requested");
    if password.len() < 8 {
        crate::log_warn!("setup_vault", "rejected: password shorter than 8 chars");
        return Err("password must be at least 8 characters".to_string());
    }
    let account = accounts::create_account(&name).map_err(|e| {
        crate::log_warn!("setup_vault", "create_account failed: {e}");
        e.to_string()
    })?;
    let keys = storage::KeySet::new(&password);
    let vault = vault::new_vault(keys.master_salt.clone());
    storage::save_vault(&account, &vault, &keys).map_err(|e| e.to_string())?;
    state.start_autolock(&account);
    *state.key.lock().unwrap() = Some(keys);
    *state.vault.lock().unwrap() = Some(vault);
    *state.current_account.lock().unwrap() = Some(account.clone());
    crate::log_info!("setup_vault", "created account={}", account.id);
    Ok((&account).into())
}

#[tauri::command]
pub fn unlock_vault(
    password: String,
    account_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    crate::log_info!("unlock_vault", "attempt account={account_id}");
    let id = Uuid::parse_str(&account_id).map_err(|e| e.to_string())?;
    let account = accounts::get_account_legacy_fallback(id).map_err(|e| e.to_string())?;
    let (vault, keys) = storage::load_vault(&account, &password).map_err(|_| {
        crate::log_warn!("unlock_vault", "failed account={account_id} (bad password)");
        "invalid password".to_string()
    })?;
    state.start_autolock(&account);
    *state.key.lock().unwrap() = Some(keys);
    *state.vault.lock().unwrap() = Some(vault);
    *state.current_account.lock().unwrap() = Some(account);
    crate::log_info!("unlock_vault", "unlocked account={account_id}");
    crate::tray::sync(&app);
    Ok(())
}

#[tauri::command]
pub fn lock_vault(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    crate::log_info!("lock_vault", "locked");
    state.lock_and_backup();
    let _ = app.emit("vault://locked", ());
    crate::tray::sync(&app);
    Ok(())
}

#[tauri::command]
pub fn is_unlocked(state: State<'_, AppState>) -> bool {
    state.key.lock().unwrap().is_some()
}

#[derive(Serialize)]
pub struct AutolockStatus {
    pub locked: bool,
    pub remaining_secs: u64,
    pub timeout_secs: u64,
}

/// Polled by the frontend while unlocked. Doubles as the idle-lock
/// enforcement point: nothing else calls `autolock_if_idle`.
#[tauri::command]
pub fn autolock_status(state: State<'_, AppState>, app: AppHandle) -> AutolockStatus {
    let locked = state.autolock_if_idle();
    if locked {
        let _ = app.emit("vault://locked", ());
        return AutolockStatus { locked: true, remaining_secs: 0, timeout_secs: 0 };
    }
    let al = state.autolock.lock().unwrap();
    AutolockStatus {
        locked: false,
        remaining_secs: al.remaining_secs(),
        timeout_secs: al.timeout_secs(),
    }
}

#[tauri::command]
pub fn list_items(
    query: Option<String>,
    kind: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<ItemMeta>, String> {
    let vault = state.vault.lock().unwrap();
    let vault = vault.as_ref().ok_or_else(|| "locked".to_string())?;
    let q = query.as_deref().map(str::to_lowercase);
    let mut out: Vec<ItemMeta> = vault
        .items
        .iter()
        .filter(|i| {
            if let Some(ref k) = kind {
                let actual = match i {
                    Item::Login { .. } => "login",
                    Item::Note { .. } => "note",
                    Item::Card { .. } => "card",
                };
                if actual != k.as_str() {
                    return false;
                }
            }
            if let Some(ref qq) = q {
                if !i.base().title.to_lowercase().contains(qq) {
                    return false;
                }
            }
            true
        })
        .map(|i| to_meta_in(i, vault::is_pinned(vault, i.id()), vault::icon_checked_at(vault, i.id())))
        .collect();
    out.sort_by_key(|i| std::cmp::Reverse(i.updated_at));
    crate::log_info!(
        "list_items",
        "kind={} query={} count={}",
        kind.as_deref().unwrap_or("all"),
        q.is_some(),
        out.len()
    );
    Ok(out)
}

#[tauri::command]
pub fn vault_stats(state: State<'_, AppState>) -> Result<vault::VaultStats, String> {
    let vault = state.vault.lock().unwrap();
    let vault = vault.as_ref().ok_or_else(|| "locked".to_string())?;
    let stats = vault::compute_stats(vault, chrono::Utc::now().timestamp());
    crate::log_info!(
        "vault_stats",
        "total={} logins={} weak={} reused={} stale={} score={}",
        stats.total,
        stats.logins,
        stats.weak.len(),
        stats.reused.len(),
        stats.old.len(),
        stats.health_score
    );
    Ok(stats)
}

#[tauri::command]
pub fn get_item(id: String, state: State<'_, AppState>) -> Result<Item, String> {
    crate::log_info!("get_item", "id={id}");
    let vault = state.vault.lock().unwrap();
    let vault = vault.as_ref().ok_or_else(|| "locked".to_string())?;
    let uuid = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    vault::get_item(vault, uuid)
        .cloned()
        .ok_or_else(|| "not found".to_string())
}

#[tauri::command]
pub fn save_item(item: Item, state: State<'_, AppState>) -> Result<(), String> {
    let account = {
        let a = state.current_account.lock().unwrap();
        a.clone().ok_or_else(|| "locked".to_string())?
    };
    let keys = {
        let k = state.key.lock().unwrap();
        k.as_ref().ok_or_else(|| "locked".to_string())?.clone()
    };
    // A 2FA key that cannot make a code is caught here, while the site's
    // setup page is still open, not the first time a code is needed.
    if let Item::Login { fields, .. } = &item {
        if !fields.totp.trim().is_empty() {
            crate::totp::parse(&fields.totp)?;
        }
    }
    let mut vault = state.vault.lock().unwrap();
    let vault = vault.as_mut().ok_or_else(|| "locked".to_string())?;
    let now = chrono::Utc::now().timestamp();
    // The editor always sends created_at: 0, so the stored value is the only
    // record of when an item was first added — take it back from the vault
    // instead of restamping it on every edit.
    let previous_created_at = vault::get_item(vault, item.id()).map(|i| i.base().created_at);
    let mut item = item;
    let base = item.base_mut();
    base.created_at = match previous_created_at {
        Some(created) if created != 0 => created,
        _ if base.created_at != 0 => base.created_at,
        _ => now,
    };
    base.updated_at = now;
    // Shape only. The log file sits unencrypted beside the vault, so it must
    // not become an inventory of which sites and institutions you hold
    // accounts with: no titles, no urls, no usernames — ids and flags only.
    let (kind, method, has_url, has_password) = match &item {
        Item::Login { fields, .. } => (
            "login",
            fields.method.clone(),
            !fields.url.is_empty(),
            !fields.password.is_empty(),
        ),
        Item::Note { .. } => ("note", String::new(), false, false),
        Item::Card { .. } => ("card", String::new(), false, false),
    };
    let existing = vault::get_item(vault, item.id()).is_some();
    crate::log_info!(
        "save_item",
        "{} id={} kind={} titled={} method={} url={} password={}",
        if existing { "update" } else { "create" },
        item.id(),
        kind,
        !item.base().title.is_empty(),
        if method.is_empty() { "-" } else { method.as_str() },
        has_url,
        has_password
    );
    if existing {
        vault::update_item(vault, item);
    } else {
        vault::add_item(vault, item);
    }
    storage::save_vault(&account, vault, &keys).map_err(|e| e.to_string())?;
    state.autolock.lock().unwrap().reset();
    Ok(())
}

/// Pin or unpin an item. Pins are vault-level and carry no timestamp, so
/// this never disturbs `updated_at` or the health stats built on it.
#[tauri::command]
pub fn set_item_pinned(
    id: String,
    pinned: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let account = {
        let a = state.current_account.lock().unwrap();
        a.clone().ok_or_else(|| "locked".to_string())?
    };
    let keys = {
        let k = state.key.lock().unwrap();
        k.as_ref().ok_or_else(|| "locked".to_string())?.clone()
    };
    let mut vault = state.vault.lock().unwrap();
    let vault = vault.as_mut().ok_or_else(|| "locked".to_string())?;
    let uuid = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    vault::set_pinned(vault, uuid, pinned).map_err(|e| {
        crate::log_warn!("set_item_pinned", "refused id={id}: {e}");
        e
    })?;
    storage::save_vault(&account, vault, &keys).map_err(|e| e.to_string())?;
    crate::log_info!("set_item_pinned", "id={id} pinned={pinned} total={}", vault.pinned.len());
    Ok(())
}

/// Record a favicon check. Passing `favicon: None` means "looked, nothing
/// new" — the timestamp still moves so the 30-day refresh does not retry the
/// same site on the next unlock.
///
/// Unlike `save_item` this keeps `updated_at` as it was: a logo re-fetch is
/// not a password change, so it must not reset the "stale password" clock
/// the health stats are built on.
#[tauri::command]
pub fn set_item_favicon(
    id: String,
    favicon: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let account = {
        let a = state.current_account.lock().unwrap();
        a.clone().ok_or_else(|| "locked".to_string())?
    };
    let keys = {
        let k = state.key.lock().unwrap();
        k.as_ref().ok_or_else(|| "locked".to_string())?.clone()
    };
    let mut vault = state.vault.lock().unwrap();
    let vault = vault.as_mut().ok_or_else(|| "locked".to_string())?;
    let uuid = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let mut item = vault::get_item(vault, uuid)
        .cloned()
        .ok_or_else(|| "item not found".to_string())?;
    crate::log_info!(
        "set_item_favicon",
        "id={id} bytes={}",
        favicon.as_ref().map(|f| f.len()).unwrap_or(0)
    );
    if let Some(favicon) = favicon {
        item.base_mut().favicon = favicon;
        vault::update_item(vault, item);
    }
    vault.icon_checked.insert(uuid, chrono::Utc::now().timestamp());
    storage::save_vault(&account, vault, &keys).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_item(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let account = {
        let a = state.current_account.lock().unwrap();
        a.clone().ok_or_else(|| "locked".to_string())?
    };
    let keys = {
        let k = state.key.lock().unwrap();
        k.as_ref().ok_or_else(|| "locked".to_string())?.clone()
    };
    let mut vault = state.vault.lock().unwrap();
    let vault = vault.as_mut().ok_or_else(|| "locked".to_string())?;
    let uuid = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    crate::log_info!("delete_item", "id={id}");
    vault::delete_item(vault, uuid);
    storage::save_vault(&account, vault, &keys).map_err(|e| e.to_string())?;
    state.autolock.lock().unwrap().reset();
    Ok(())
}

#[tauri::command]
pub fn get_personal_info(state: State<'_, AppState>) -> Result<PersonalInfo, String> {
    crate::log_info!("get_personal_info", "read");
    let vault = state.vault.lock().unwrap();
    let vault = vault.as_ref().ok_or_else(|| "locked".to_string())?;
    Ok(vault.personal.clone())
}

#[tauri::command]
pub fn save_personal_info(
    info: PersonalInfo,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let account = {
        let a = state.current_account.lock().unwrap();
        a.clone().ok_or_else(|| "locked".to_string())?
    };
    let keys = {
        let k = state.key.lock().unwrap();
        k.as_ref().ok_or_else(|| "locked".to_string())?.clone()
    };
    let mut vault = state.vault.lock().unwrap();
    let vault = vault.as_mut().ok_or_else(|| "locked".to_string())?;
    vault.personal = info;
    storage::save_vault(&account, vault, &keys).map_err(|e| e.to_string())?;
    state.autolock.lock().unwrap().reset();
    Ok(())
}

#[tauri::command]
pub fn generate_password(opts: GenOpts) -> Result<String, String> {
    crate::log_info!(
        "generate_password",
        "length={} lower={} upper={} digits={} symbols={}",
        opts.length,
        opts.lower,
        opts.upper,
        opts.digits,
        opts.symbols
    );
    password::generate(&opts).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn copy_to_clipboard(
    text: String,
    ttl_secs: Option<u32>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let ttl = std::time::Duration::from_secs(ttl_secs.unwrap_or(30) as u64);
    // No length: the log file is plaintext beside the vault, and a per-copy
    // character count is an exact inventory of your password lengths.
    crate::log_info!("copy_to_clipboard", "ttl_secs={}", ttl.as_secs());
    crate::clipboard::copy_with_ttl(&text, ttl).map_err(|e| e.to_string())?;
    state.autolock.lock().unwrap().reset();
    Ok(())
}

/// The current 2FA code for a login item.
#[tauri::command]
pub fn totp_code(id: String, state: State<'_, AppState>) -> Result<crate::totp::Code, String> {
    let vault = state.vault.lock().unwrap();
    let vault = vault.as_ref().ok_or_else(|| "locked".to_string())?;
    let uuid = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let Some(Item::Login { fields, .. }) = vault::get_item(vault, uuid) else {
        return Err("not found".into());
    };
    let totp = crate::totp::parse(&fields.totp)?;
    let now = chrono::Utc::now().timestamp().max(0) as u64;
    Ok(crate::totp::code_at(&totp, now))
}

/// Read a 2FA setup QR code out of a screenshot on the clipboard.
#[tauri::command]
pub fn totp_from_clipboard() -> Result<String, String> {
    let image = arboard::Clipboard::new()
        .and_then(|mut c| c.get_image())
        .map_err(|_| "No image on the clipboard. Screenshot the QR code first.".to_string())?;
    let link = crate::totp::qr_from_rgba(image.width, image.height, &image.bytes)?;
    crate::log_info!("totp_from_clipboard", "read a 2FA setup code");
    Ok(link)
}

fn current_account(state: &State<'_, AppState>) -> Result<accounts::Account, String> {
    state
        .current_account
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "no active account".to_string())
}

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> Result<Config, String> {
    crate::log_info!("get_config", "read");
    let account = state
        .current_account
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "no active account".to_string())?;
    Ok(config::load(&account))
}

#[tauri::command]
pub fn set_autolock_mins(mins: u8, state: State<'_, AppState>) -> Result<(), String> {
    if !(15..=90).contains(&mins) {
        return Err("autolock must be between 15 and 90 minutes".to_string());
    }
    let account = state
        .current_account
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "no active account".to_string())?;
    crate::log_info!("set_autolock_mins", "mins={mins}");
    let mut c = config::load(&account);
    c.autolock_mins = mins;
    config::save(&account, &c).map_err(|e| e.to_string())?;
    state.autolock.lock().unwrap().set_timeout(mins);
    Ok(())
}

/// Turn the unlock-time favicon refresh on or off. Off by default — see
/// `Config::auto_refresh_icons`.
#[tauri::command]
pub fn set_auto_refresh_icons(on: bool, state: State<'_, AppState>) -> Result<(), String> {
    let account = current_account(&state)?;
    crate::log_info!("set_auto_refresh_icons", "on={on}");
    let mut c = config::load(&account);
    c.auto_refresh_icons = on;
    config::save(&account, &c).map_err(|e| e.to_string())
}

/// On-disk footprint of the active vault, for the Settings storage card.
#[derive(Serialize)]
pub struct VaultStorage {
    pub path: String,
    pub bytes: u64,
    pub modified_secs: i64,
}

#[tauri::command]
pub fn vault_storage(state: State<'_, AppState>) -> Result<VaultStorage, String> {
    let account = state
        .current_account
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "no active account".to_string())?;
    let path = storage::vault_path(&account);
    let meta = std::fs::metadata(&path).map_err(|e| {
        crate::log_warn!("vault_storage", "stat failed: {e}");
        e.to_string()
    })?;
    crate::log_info!("vault_storage", "bytes={}", meta.len());
    let modified_secs = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    Ok(VaultStorage {
        path: path.to_string_lossy().into_owned(),
        bytes: meta.len(),
        modified_secs,
    })
}

/// Log sink for the UI. Levels other than "warn" are recorded as INFO, and
/// callers must pass descriptions, never secret values.
#[tauri::command]
pub fn log_event(level: String, scope: String, message: String) {
    let level = if level == "warn" { "WARN" } else { "INFO" };
    crate::logging::write(level, &format!("ui:{scope}"), &message);
}

#[derive(Serialize)]
pub struct SecurityState {
    pub has_recovery: bool,
    pub last_export_secs: i64,
}

/// What the Security card in Settings shows: whether a recovery code exists
/// and how long ago the vault was last exported.
#[tauri::command]
pub fn security_state(state: State<'_, AppState>) -> Result<SecurityState, String> {
    let account = current_account(&state)?;
    let cfg = config::load(&account);
    Ok(SecurityState {
        has_recovery: storage::has_recovery_slot(&account),
        last_export_secs: cfg.last_export_secs,
    })
}

/// Mint a recovery code, wrap the data key under it, and return the code.
/// Shown once — only the wrapped key is kept, never the code itself.
#[tauri::command]
pub fn create_recovery_code(
    password: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let account = current_account(&state)?;
    // Re-authenticate: a recovery code is a second key to the vault, so an
    // unattended unlocked window must not be enough to mint one.
    let (mut vault, mut keys) = storage::load_vault(&account, &password)
        .map_err(|_| "invalid password".to_string())?;

    let (secret, code) = crate::recovery::generate();
    keys.set_recovery_secret(&secret);
    let saved = storage::save_vault(&account, &vault, &keys);
    // A second fully decrypted vault, separate from the one in AppState and
    // dropped here — wipe it rather than leave it in freed memory.
    vault::zeroize_secrets(&mut vault);
    saved.map_err(|e| e.to_string())?;
    *state.key.lock().unwrap() = Some(keys);
    crate::log_warn!("create_recovery_code", "new recovery code issued");
    Ok(crate::recovery::format_for_display(&code))
}

/// Open a vault with a recovery code and set a new master password.
#[tauri::command]
pub fn recover_vault(
    code: String,
    new_password: String,
    account_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if new_password.len() < 8 {
        return Err("password must be at least 8 characters".to_string());
    }
    let id = Uuid::parse_str(&account_id).map_err(|e| e.to_string())?;
    let account = accounts::get_account_legacy_fallback(id).map_err(|e| e.to_string())?;
    let secret = crate::recovery::decode(&code).map_err(|e| e.to_string())?;

    let (vault, mut keys) = storage::load_vault_with_recovery(&account, &secret).map_err(|e| {
        crate::log_warn!("recover_vault", "failed account={account_id}: {e}");
        match e {
            storage::StorageError::NoRecovery => e.to_string(),
            _ => "that recovery code does not open this vault".to_string(),
        }
    })?;

    // The code stays valid; only the master half is rewrapped.
    keys.set_master_password(&new_password);
    storage::save_vault(&account, &vault, &keys).map_err(|e| e.to_string())?;

    state.start_autolock(&account);
    *state.key.lock().unwrap() = Some(keys);
    *state.vault.lock().unwrap() = Some(vault);
    *state.current_account.lock().unwrap() = Some(account);
    crate::log_warn!("recover_vault", "vault recovered account={account_id}");
    Ok(())
}

/// Change the master password. With key wrapping this only rewraps the data
/// key, so the vault itself is not re-encrypted and the recovery code keeps
/// working.
#[tauri::command]
pub fn change_master_password(
    current: String,
    new_password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if new_password.len() < 8 {
        return Err("password must be at least 8 characters".to_string());
    }
    let account = current_account(&state)?;
    let (mut vault, mut keys) = storage::load_vault(&account, &current).map_err(|_| {
        crate::log_warn!("change_master_password", "refused (bad current password)");
        "current password is not correct".to_string()
    })?;

    // The recovery slot rides along sealed, so an existing recovery code
    // keeps opening the vault after the password changes.
    keys.set_master_password(&new_password);
    let saved = storage::save_vault(&account, &vault, &keys);
    // Second decrypted copy, dropped here; the AppState one is untouched.
    vault::zeroize_secrets(&mut vault);
    saved.map_err(|e| e.to_string())?;
    // Every retained copy is still wrapped under the password being rotated
    // away from — often the reason for the change. Keeping them would leave
    // the old password opening ten full vaults.
    storage::delete_backups(&account);
    *state.key.lock().unwrap() = Some(keys);
    crate::log_warn!("change_master_password", "master password changed");
    Ok(())
}

#[tauri::command]
pub fn reset_activity(state: State<'_, AppState>) {
    state.autolock.lock().unwrap().reset();
}

/// Wipe the vault and config for the given account after verifying the
/// current master password. Used by the Lock-screen "forgot password"
/// flow to escape a forgotten password. Returns Err("invalid password")
/// on bad pw.
#[tauri::command]
pub fn reset_vault(
    password: String,
    account_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    crate::log_warn!("reset_vault", "requested account={account_id}");
    let id = Uuid::parse_str(&account_id).map_err(|e| e.to_string())?;
    let account = accounts::get_account_legacy_fallback(id).map_err(|e| e.to_string())?;

    // Verify by attempting a full unlock cycle against the existing vault.
    // The decrypted copy is only proof the password is right; wipe it instead
    // of dropping a whole plaintext vault into freed memory.
    let (mut proof, _keys) = storage::load_vault(&account, &password).map_err(|_| {
        crate::log_warn!("reset_vault", "refused account={account_id} (bad password)");
        "invalid password".to_string()
    })?;
    vault::zeroize_secrets(&mut proof);
    drop(proof);

    // Wipe the in-memory key first, then delete the files. If the
    // currently unlocked account is the one being reset, also clear
    // in-memory state.
    {
        let current = state.current_account.lock().unwrap();
        if current.as_ref().map(|a| a.id) == Some(account.id) {
            drop(current);
            state.lock_and_clear();
        }
    }
    storage::delete_vault_and_config(&account).map_err(|e| e.to_string())?;
    crate::log_warn!("reset_vault", "wiped account={account_id}");
    // Drop the registry row too, or the lock screen keeps listing an account
    // whose vault is gone. Legacy-fallback ids were never registered.
    match accounts::delete_account(account.id) {
        Ok(()) | Err(AccountError::NotFound(_)) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Write a just-shown recovery code to a `.txt` file the user picked.
///
/// Only a valid recovery code, and only to a `.txt`: this must not become a
/// general "write anything anywhere" command for the webview.
#[tauri::command]
pub fn save_recovery_code(dest: String, code: String) -> Result<(), String> {
    let path = std::path::Path::new(&dest);
    if !path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("txt"))
    {
        return Err("The file must end in .txt.".into());
    }
    crate::recovery::decode(&code).map_err(|e| e.to_string())?;
    let text = format!(
        "Password Manager recovery code\r\n\r\n{code}\r\n\r\n\
         This code opens your vault if you forget the master password.\r\n\
         Anyone with this code and a copy of your vault file can open it.\r\n\
         Move this file off this computer (print it, or keep it on a USB stick),\r\n\
         then delete it here.\r\n"
    );
    std::fs::write(path, text).map_err(|e| e.to_string())?;
    crate::log_info!("save_recovery_code", "written");
    Ok(())
}

#[tauri::command]
pub fn export_vault(dest: String, state: State<'_, AppState>) -> Result<(), String> {
    let account = {
        let a = state.current_account.lock().unwrap();
        a.clone().ok_or_else(|| "locked".to_string())?
    };
    crate::log_info!("export_vault", "requested");
    storage::export_vault_file(&account, std::path::Path::new(&dest)).map_err(|e| {
        crate::log_warn!("export_vault", "failed: {e}");
        e.to_string()
    })?;
    // Remembered so Settings can point out a vault that has not been backed
    // up in a long time.
    let mut cfg = config::load(&account);
    cfg.last_export_secs = chrono::Utc::now().timestamp();
    let _ = config::save(&account, &cfg);
    Ok(())
}

#[tauri::command]
pub fn import_vault(src: String, name: String) -> Result<AccountMeta, String> {
    crate::log_info!("import_vault", "requested");
    let account = accounts::import_account(std::path::Path::new(&src), &name).map_err(|e| {
        crate::log_warn!("import_vault", "failed: {e}");
        e.to_string()
    })?;
    crate::log_info!("import_vault", "imported account={}", account.id);
    Ok(AccountMeta::from(&account))
}

/// What the Cloud backup card in Settings shows. Deliberately has no token
/// field: the UI never needs the secret back, only whether one is set.
#[derive(Serialize, Clone)]
pub struct BackupState {
    pub configured: bool,
    pub url: String,
    pub last_backup_secs: i64,
    /// The last auto/manual upload's failure message, empty when it
    /// succeeded or none has run yet. This is the *last* attempt, not
    /// necessarily the vault's current backup status.
    pub last_backup_error: String,
}

#[tauri::command]
pub fn get_backup_config(state: State<'_, AppState>) -> Result<BackupState, String> {
    let account = current_account(&state)?;
    let vault = state.vault.lock().unwrap();
    let vault = vault.as_ref().ok_or_else(|| "locked".to_string())?;
    let cfg = vault.backup.as_ref();
    let saved = config::load(&account);
    Ok(BackupState {
        configured: cfg.is_some(),
        url: cfg.map(|c| c.url.clone()).unwrap_or_default(),
        last_backup_secs: saved.last_cloud_backup_secs,
        last_backup_error: saved.last_cloud_backup_error,
    })
}

/// `put_token: None` (or blank) keeps the currently stored token — used when
/// the user only wants to change the URL, since `get_backup_config` never
/// hands the token back for them to re-enter. Rejected only when there is no
/// existing config to fall back on.
/// Pick the PUT token to store: the supplied one when it is non-blank,
/// otherwise the one already saved.
///
/// Lives outside `set_backup_config` so it can be tested — the command itself
/// takes a `tauri::State`, which a unit test cannot readily build. The blank
/// case exists so the URL can be changed on its own: `get_backup_config`
/// never returns the token, so the user has nothing to re-type.
fn resolve_put_token(supplied: Option<&str>, existing: Option<&str>) -> Result<String, String> {
    match supplied.map(str::trim).filter(|t| !t.is_empty()) {
        Some(t) => Ok(t.to_string()),
        // Blank with nothing stored would configure a backup that can never
        // authenticate, and every upload would fail 401 with no obvious cause.
        None => existing
            .map(str::to_string)
            .ok_or_else(|| "token cannot be empty".to_string()),
    }
}

#[tauri::command]
pub fn set_backup_config(
    url: String,
    put_token: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use zeroize::Zeroize;
    cloud::validate_url(&url).map_err(|e| e.to_string())?;
    let account = current_account(&state)?;
    // Cloned and the guard dropped before the vault guard is taken, matching
    // save_item's pattern — this is the only pair of commands that used to
    // hold both guards at once.
    let keys = {
        let k = state.key.lock().unwrap();
        k.as_ref().ok_or_else(|| "locked".to_string())?.clone()
    };
    let mut vault = state.vault.lock().unwrap();
    let vault = vault.as_mut().ok_or_else(|| "locked".to_string())?;

    let new_token = resolve_put_token(
        put_token.as_deref(),
        vault.backup.as_ref().map(|b| b.put_token.as_str()),
    )?;

    if let Some(mut old) = vault.backup.take() {
        old.put_token.zeroize();
    }
    vault.backup = Some(cloud::BackupConfig {
        url: url.trim().trim_end_matches('/').to_string(),
        put_token: new_token,
    });
    storage::save_vault(&account, vault, &keys).map_err(|e| e.to_string())?;
    // Clear any recorded failure: the settings just changed, so the stored
    // error describes an attempt against a configuration that no longer
    // exists. Leaving it would show a user who just fixed a bad token the
    // same failure until the next upload happens to run.
    let mut cfg = config::load(&account);
    if !cfg.last_cloud_backup_error.is_empty() {
        cfg.last_cloud_backup_error = String::new();
        let _ = config::save(&account, &cfg);
    }
    // The URL is as sensitive as the domain list the vault protects, so it is
    // absent here on purpose.
    crate::log_info!("set_backup_config", "cloud backup configured");
    Ok(())
}

#[tauri::command]
pub fn clear_backup_config(state: State<'_, AppState>) -> Result<(), String> {
    use zeroize::Zeroize;
    let account = current_account(&state)?;
    let keys = {
        let k = state.key.lock().unwrap();
        k.as_ref().ok_or_else(|| "locked".to_string())?.clone()
    };
    let mut vault = state.vault.lock().unwrap();
    let vault = vault.as_mut().ok_or_else(|| "locked".to_string())?;

    if let Some(mut old) = vault.backup.take() {
        old.put_token.zeroize();
    }
    storage::save_vault(&account, vault, &keys).map_err(|e| e.to_string())?;
    crate::log_info!("clear_backup_config", "cloud backup disabled");
    Ok(())
}

// ---------------------------------------------------------------------------
// Browser extension pairing
// ---------------------------------------------------------------------------

/// One paired browser, as Settings shows it. No token: it never goes up to
/// the UI, the same way the cloud backup PUT token never does.
#[derive(Serialize)]
pub struct PairedInfo {
    pub origin: String,
    pub label: String,
    pub paired_at: i64,
    /// Hosts this browser has been approved to be handed a password for, so
    /// Settings can list them and take one back.
    pub allowed_hosts: Vec<String>,
}

#[derive(Serialize)]
pub struct BridgeState {
    /// Empty when the listener came up; the reason it did not, otherwise.
    pub listen_error: String,
    pub port: u16,
    pub clients: Vec<PairedInfo>,
}

/// Write an already-open vault back to disk.
///
/// Takes the vault by reference rather than locking it, because the bridge
/// calls this while holding the lock: token rotation has to read the current
/// token, replace it, and persist it without another thread slipping in
/// between and handing out the one being replaced.
pub(crate) fn save_unlocked(state: &State<'_, AppState>, vault: &Vault) -> Result<(), String> {
    let account = current_account(state)?;
    let keys = {
        let k = state.key.lock().unwrap();
        k.as_ref().ok_or_else(|| "locked".to_string())?.clone()
    };
    storage::save_vault(&account, vault, &keys).map_err(|e| e.to_string())
}

/// Record a newly paired extension. Called from the bridge thread, which is
/// why it lives here with the other writers rather than inline over there.
pub(crate) fn add_paired_client(
    state: &State<'_, AppState>,
    client: crate::vault::PairedClient,
) -> Result<(), String> {
    let mut guard = state.vault.lock().unwrap();
    let vault = guard.as_mut().ok_or_else(|| "locked".to_string())?;
    // Re-pairing the same extension replaces its key rather than stacking a
    // second one, so "unpair" always means the browser really is cut off.
    // The approvals go with it: a browser that had to be paired again is not
    // obviously the same browser, and re-approving a handful of sites is
    // cheaper than a stale grant nobody remembers making.
    if let Some(old) = vault.paired.iter_mut().find(|c| c.origin == client.origin) {
        *old = client;
    } else {
        vault.paired.push(client);
    }
    save_unlocked(state, vault)
}

/// Allow a paired browser to be handed passwords for one host.
///
/// Called from the dialog the bridge raises, never from the bridge itself:
/// the whole value of the prompt is that answering it takes a click in this
/// window, which a token on its own cannot produce.
#[tauri::command]
pub fn bridge_approve(
    origin: String,
    host: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let host = host.trim().to_lowercase();
    if host.is_empty() {
        return Err("no host".to_string());
    }
    let mut guard = state.vault.lock().unwrap();
    let vault = guard.as_mut().ok_or_else(|| "locked".to_string())?;
    let client = vault
        .paired
        .iter_mut()
        .find(|c| c.origin == origin)
        .ok_or_else(|| "that extension is not paired".to_string())?;
    if !client.allowed_hosts.contains(&host) {
        client.allowed_hosts.push(host.clone());
    }
    save_unlocked(&state, vault)?;
    crate::log_info!("bridge_approve", "approved host={host}");
    Ok(())
}

/// Take one host's approval back. The browser stays paired.
#[tauri::command]
pub fn bridge_revoke_host(
    origin: String,
    host: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut guard = state.vault.lock().unwrap();
    let vault = guard.as_mut().ok_or_else(|| "locked".to_string())?;
    let client = vault
        .paired
        .iter_mut()
        .find(|c| c.origin == origin)
        .ok_or_else(|| "that extension is not paired".to_string())?;
    client.allowed_hosts.retain(|h| *h != host);
    save_unlocked(&state, vault)?;
    crate::log_info!("bridge_revoke_host", "revoked host={host}");
    Ok(())
}

/// Put a fresh pairing code on screen. Shown once, good for three minutes.
#[tauri::command]
pub fn bridge_pair_code(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    if !state.is_unlocked() {
        return Err("locked".to_string());
    }
    // The code itself is never logged: it is the one thing standing between
    // any local process and a paired extension.
    crate::log_info!("bridge_pair_code", "pairing code issued");
    Ok(app.state::<crate::bridge::Bridge>().new_code())
}

#[tauri::command]
pub fn bridge_cancel_pairing(app: AppHandle) {
    app.state::<crate::bridge::Bridge>().cancel_code();
    crate::log_info!("bridge_cancel_pairing", "pairing cancelled");
}

#[tauri::command]
pub fn bridge_state(app: AppHandle, state: State<'_, AppState>) -> Result<BridgeState, String> {
    let vault = state.vault.lock().unwrap();
    let clients = vault
        .as_ref()
        .map(|v| {
            v.paired
                .iter()
                .map(|c| PairedInfo {
                    origin: c.origin.clone(),
                    label: c.label.clone(),
                    paired_at: c.paired_at,
                    allowed_hosts: c.allowed_hosts.clone(),
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(BridgeState {
        listen_error: app
            .state::<crate::bridge::Bridge>()
            .listen_error()
            .unwrap_or_default(),
        port: crate::bridge::PORT,
        clients,
    })
}

#[tauri::command]
pub fn bridge_unpair(origin: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.vault.lock().unwrap();
    let vault = guard.as_mut().ok_or_else(|| "locked".to_string())?;

    let before = vault.paired.len();
    vault.paired.retain(|c| c.origin != origin);
    if vault.paired.len() == before {
        return Err("that extension is not paired".to_string());
    }
    save_unlocked(&state, vault)?;
    crate::log_info!("bridge_unpair", "unpaired origin={origin}");
    Ok(())
}

/// Whether the vault has been written since the last successful upload.
///
/// This compares the file's mtime against a stored timestamp rather than
/// tracking a dirty flag: `save_vault` has nine call sites and no shared
/// wrapper, so a flag would mean nine edits today and a missed one the first
/// time a tenth call site appears. The mtime is the same signal with none of
/// that surface, and it survives a restart.
///
/// Millisecond precision with strict `>`: whole-second precision cannot tell
/// two saves in the same second apart, and `>=` (the earlier fix for that)
/// would make the stamp equal the mtime on every subsequent lock once the
/// caller starts stamping the file's own mtime instead of wall-clock time —
/// uploading forever. Milliseconds make an exact-equal stamp mean "this exact
/// file version was already uploaded", so `>` is then the correct read.
///
/// That precision comes from the filesystem, not from this code. NTFS, APFS
/// and ext4 all carry sub-second mtimes, so the shipped targets are fine; a
/// coarse-grained filesystem (FAT32 at 2s, ext3 at 1s) collapses two saves in
/// the same tick and would skip the second one. Storing the vault on such a
/// filesystem is out of scope, but the decision below is only as exact as the
/// mtime it reads.
pub fn needs_upload(vault_path: &std::path::Path, last_uploaded_mtime_ms: i64) -> bool {
    let modified = match std::fs::metadata(vault_path).and_then(|m| m.modified()) {
        Ok(t) => t,
        Err(_) => return false,
    };
    let ms = match modified.duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => d.as_millis() as i64,
        Err(_) => return false,
    };
    ms > last_uploaded_mtime_ms
}

/// The vault file's mtime in milliseconds, read before the blob so the
/// caller stamps the version it actually uploaded. Capturing it here (before
/// the read) rather than after is what makes a save landing mid-upload safe:
/// the newer bytes go up, but the OLDER mtime gets stamped, so the next lock
/// re-uploads instead of wrongly skipping the save that snuck in.
fn mtime_ms(path: &std::path::Path) -> Option<i64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let ms = modified.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis();
    Some(ms as i64)
}

/// Fire the upload without blocking the caller.
///
/// Locking must never wait on the network: the keys are already wiped by the
/// time this runs, and a hung request must not hold the app. A failure needs
/// no retry queue either — the stamp is only written on success, so the file's
/// mtime stays newer and the next lock tries again.
pub fn spawn_backup(cfg: cloud::BackupConfig, path: std::path::PathBuf, account: Account) {
    tauri::async_runtime::spawn(async move {
        // Captured before the read — see `mtime_ms`'s doc comment for why.
        let stamp = mtime_ms(&path);

        let blob = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) => {
                crate::log_warn!("auto_backup", "could not read vault: {e}");
                return;
            }
        };
        match cloud::upload(&cfg, blob).await {
            Ok(()) => {
                let mut c = config::load(&account);
                // Display-only; does not drive the upload decision.
                c.last_cloud_backup_secs = chrono::Utc::now().timestamp();
                if let Some(ms) = stamp {
                    c.last_cloud_backup_mtime_ms = ms;
                }
                c.last_cloud_backup_error = String::new();
                let _ = config::save(&account, &c);
                crate::log_info!("auto_backup", "cloud backup uploaded on lock");
            }
            Err(e) => {
                let mut c = config::load(&account);
                c.last_cloud_backup_error = e.to_string();
                let _ = config::save(&account, &c);
                crate::log_warn!("auto_backup", "failed: {e}");
            }
        }
    });
}

/// Upload the vault now, whether or not it has changed. Wired to the "Back up
/// now" button, which is an explicit instruction.
#[tauri::command]
pub async fn backup_now(state: State<'_, AppState>) -> Result<(), String> {
    let (account, cfg) = {
        let account = current_account(&state)?;
        let vault = state.vault.lock().unwrap();
        let vault = vault.as_ref().ok_or_else(|| "locked".to_string())?;
        let cfg = vault
            .backup
            .clone()
            .ok_or_else(|| "cloud backup is not configured".to_string())?;
        (account, cfg)
    };

    // The on-disk file is already ciphertext, so the upload needs no key.
    let path = storage::vault_path(&account);
    // Captured before the read — see `mtime_ms`'s doc comment for why.
    let stamp = mtime_ms(&path);
    let blob = std::fs::read(&path).map_err(|e| e.to_string())?;

    if let Err(e) = cloud::upload(&cfg, blob).await {
        crate::log_warn!("backup_now", "failed: {e}");
        let mut c = config::load(&account);
        c.last_cloud_backup_error = e.to_string();
        let _ = config::save(&account, &c);
        return Err(e.to_string());
    }

    let mut c = config::load(&account);
    // Display-only; does not drive the upload decision.
    c.last_cloud_backup_secs = chrono::Utc::now().timestamp();
    if let Some(ms) = stamp {
        c.last_cloud_backup_mtime_ms = ms;
    }
    c.last_cloud_backup_error = String::new();
    let _ = config::save(&account, &c);
    crate::log_info!("backup_now", "cloud backup uploaded");
    Ok(())
}

/// Download the newest backup and register it as a **new** account.
///
/// Never overwrites an existing vault: the restored copy lands beside whatever
/// is already there, so a bad restore is discarded with the vault switcher
/// rather than being a data-loss event. Reuses `import_account`, which already
/// owns registration, name collisions, and the malformed-vault precheck.
#[tauri::command]
pub async fn restore_from_cloud(
    url: String,
    get_token: String,
    name: String,
) -> Result<AccountMeta, String> {
    cloud::validate_url(&url).map_err(|e| e.to_string())?;
    if name.trim().is_empty() {
        return Err("name cannot be empty".into());
    }
    crate::log_info!("restore_from_cloud", "requested");

    let blob = cloud::download(&url, &get_token).await.map_err(|e| {
        crate::log_warn!("restore_from_cloud", "download failed: {e}");
        e.to_string()
    })?;

    // A temp file, because import_account copies from a path. Removed on every
    // path out, including the error ones.
    let tmp = std::env::temp_dir().join(format!("vault-restore-{}.enc", Uuid::new_v4()));
    if let Err(e) = std::fs::write(&tmp, &blob) {
        // A failed write can still leave a partial file behind; removed on
        // every path out, including this one.
        let _ = std::fs::remove_file(&tmp);
        return Err(e.to_string());
    }

    let result = accounts::import_account(&tmp, &name);
    let _ = std::fs::remove_file(&tmp);

    let account = result.map_err(|e| {
        crate::log_warn!("restore_from_cloud", "import failed: {e}");
        e.to_string()
    })?;
    crate::log_info!("restore_from_cloud", "restored account={}", account.id);
    Ok(AccountMeta::from(&account))
}

/// Fetch URL metadata: title + favicon.
/// Returns None fields when scrape fails (not an error).
#[tauri::command]
pub async fn fetch_url_metadata(url: String) -> Result<UrlMetadata, String> {
    // The url is deliberately absent: logging it would rebuild the very list
    // of sites the encrypted vault exists to keep private.
    let out = metadata::fetch_metadata(&url).await.map_err(|e| e.to_string());
    match &out {
        Ok(m) => crate::log_info!(
            "fetch_url_metadata",
            "ok title={} favicon={}",
            m.title.is_some(),
            m.favicon_data_url.is_some()
        ),
        Err(e) => crate::log_warn!("fetch_url_metadata", "failed: {e}"),
    }
    out
}

/// Open a login item's URL in the default browser.
///
/// For credential logins, the password is copied to the clipboard first
/// (60s TTL). The desktop app cannot inject into an external browser, so
/// copy-then-open is the pragmatic autofill. The password never crosses
/// IPC — this runs entirely in Rust.
#[tauri::command]
#[allow(deprecated)] // shell().open works; tauri-plugin-opener not worth the dep yet
pub fn open_login_url(
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    crate::log_info!("open_login_url", "id={id}");
    let vault = state.vault.lock().unwrap();
    let vault = vault.as_ref().ok_or_else(|| "locked".to_string())?;
    let uuid = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let item = vault::get_item(vault, uuid).ok_or_else(|| "not found".to_string())?;

    let url = match &item {
        Item::Login { fields, .. } => fields.url.clone(),
        _ => return Err("not a login item".to_string()),
    };
    if url.is_empty() {
        return Err("item has no URL".to_string());
    }
    // Checked before the clipboard is primed, not just before the open: a
    // refused URL must not leave the password sitting on the clipboard.
    if !is_browser_url(&url) {
        crate::log_warn!("open_login_url", "refused id={id}: not an http(s) URL");
        return Err("that item's URL is not a web address (http or https)".to_string());
    }

    if let Item::Login { fields, .. } = &item {
        if let Some(pw) = login_password(vault, fields) {
            crate::clipboard::copy_with_ttl(pw, std::time::Duration::from_secs(60))
                .map_err(|e| e.to_string())?;
        }
    }

    use tauri_plugin_shell::ShellExt;
    app.shell().open(&url, None).map_err(|e| e.to_string())?;
    state.autolock.lock().unwrap().reset();
    Ok(())
}

/// Whether a stored URL may be handed to the OS's default handler.
///
/// `shell().open(.., None)` skips the plugin's own scheme allow-list when it
/// is called from Rust, so `open::that_detached` — `ShellExecuteExW` on
/// Windows — would happily launch `file:///…`, `ms-msdt:` or a UNC path as a
/// program. Nothing else in the app checks: `host_of` is display-only and
/// `metadata::is_public_http` guards favicon fetching, not this.
fn is_browser_url(url: &str) -> bool {
    reqwest::Url::parse(url.trim())
        .map(|u| matches!(u.scheme(), "http" | "https"))
        .unwrap_or(false)
}

/// Password to prime the clipboard with when opening a login: the item's
/// own password, else (provider logins) the vault account saved for the same
/// provider and username. Never an unrelated login that merely shares the
/// username — one email is typically reused across many sites.
pub(crate) fn login_password<'a>(vault: &'a Vault, fields: &'a LoginFields) -> Option<&'a str> {
    if !fields.password.is_empty() {
        return Some(&fields.password);
    }
    if fields.method == "credentials" || fields.username.is_empty() {
        return None;
    }
    vault.items.iter().find_map(|i| match i {
        Item::Login { fields: f, .. }
            if f.method == fields.method
                && f.username == fields.username
                && !f.password.is_empty() =>
        {
            Some(f.password.as_str())
        }
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::{new_vault, ItemBase};

    #[test]
    fn recovery_file_takes_only_a_real_code_and_only_a_txt() {
        let (_, code) = crate::recovery::generate();
        let dir = std::env::temp_dir();
        let txt = dir.join(format!("recovery-{}.txt", Uuid::new_v4()));
        let other = dir.join(format!("recovery-{}.bat", Uuid::new_v4()));
        let dest = |p: &std::path::Path| p.to_string_lossy().to_string();

        assert!(save_recovery_code(dest(&other), code.clone()).is_err());
        assert!(!other.exists());
        assert!(save_recovery_code(dest(&txt), "echo anything".into()).is_err());
        assert!(!txt.exists());

        save_recovery_code(dest(&txt), code.clone()).unwrap();
        let written = std::fs::read_to_string(&txt).unwrap();
        let _ = std::fs::remove_file(&txt);
        assert!(written.contains(&code));
        assert!(written.contains("Move this file off this computer"));
    }

    #[test]
    fn backup_state_never_carries_the_token() {
        // Exact key-set check, not a substring scan: a leak through a field
        // named e.g. "secret" or "credential" would slip past a "token"
        // substring match but must still fail this test.
        let s = BackupState {
            configured: true,
            url: "https://w.example.dev".into(),
            last_backup_secs: 42,
            last_backup_error: String::new(),
        };
        let v = serde_json::to_value(&s).unwrap();
        let keys: std::collections::BTreeSet<&str> =
            v.as_object().unwrap().keys().map(String::as_str).collect();
        let expected: std::collections::BTreeSet<&str> =
            ["configured", "url", "last_backup_secs", "last_backup_error"].into_iter().collect();
        assert_eq!(keys, expected, "BackupState field set changed unexpectedly");
    }

    #[test]
    fn a_supplied_token_wins_and_is_trimmed() {
        assert_eq!(resolve_put_token(Some("  fresh  "), None).unwrap(), "fresh");
        assert_eq!(resolve_put_token(Some("fresh"), Some("stored")).unwrap(), "fresh");
    }

    #[test]
    fn a_blank_token_keeps_the_stored_one() {
        // This is what makes a URL-only edit possible: get_backup_config never
        // returns the token, so the user has nothing to re-type.
        assert_eq!(resolve_put_token(None, Some("stored")).unwrap(), "stored");
        assert_eq!(resolve_put_token(Some(""), Some("stored")).unwrap(), "stored");
        assert_eq!(resolve_put_token(Some("   "), Some("stored")).unwrap(), "stored");
    }

    #[test]
    fn a_blank_token_with_nothing_stored_is_rejected() {
        // Otherwise the vault would carry a backup config that can never
        // authenticate, and every upload would 401 with no obvious cause.
        for supplied in [None, Some(""), Some("   ")] {
            let out = resolve_put_token(supplied, None);
            assert_eq!(out.unwrap_err(), "token cannot be empty");
        }
    }

    #[test]
    fn restore_rejects_an_insecure_url_before_touching_the_disk() {
        let _g = crate::test_env::lock_recover(&crate::test_env::ENV_LOCK);
        crate::test_env::override_data_dir_to_tmp("restore-insecure");
        let out = tauri::async_runtime::block_on(restore_from_cloud(
            "http://w.example.dev".into(),
            "token".into(),
            "Restored".into(),
        ));
        assert!(out.is_err());
        let msg = out.unwrap_err();
        assert!(msg.contains("https"), "unexpected error: {msg}");
        // Nothing may have been registered.
        assert!(crate::accounts::list_accounts().unwrap().is_empty());
    }

    #[test]
    fn restore_rejects_an_empty_name() {
        let _g = crate::test_env::lock_recover(&crate::test_env::ENV_LOCK);
        crate::test_env::override_data_dir_to_tmp("restore-empty-name");
        let out = tauri::async_runtime::block_on(restore_from_cloud(
            "https://w.example.dev".into(),
            "token".into(),
            "   ".into(),
        ));
        assert!(out.is_err());
    }

    #[test]
    fn only_http_urls_may_reach_the_os_handler() {
        // These open in a browser.
        for ok in [
            "https://example.com/login",
            "http://example.com",
            "  https://example.com  ",
            "HTTPS://example.com",
        ] {
            assert!(is_browser_url(ok), "should be allowed: {ok}");
        }
        // These would hand ShellExecuteExW something to *run*. The password is
        // already on the clipboard by the time the user clicks Open.
        for bad in [
            "file:///C:/Windows/System32/calc.exe",
            "ms-msdt:-id PCWDiagnostic",
            r"\\10.0.0.5\share\update.exe",
            "example.com",
            "javascript:alert(1)",
            "vbscript:msgbox(1)",
            "C:\\Windows\\System32\\calc.exe",
            "",
        ] {
            assert!(!is_browser_url(bad), "should be refused: {bad}");
        }
    }

    fn login(method: &str, username: &str, password: &str) -> LoginFields {
        LoginFields {
            method: method.to_string(),
            url: String::new(),
            username: username.to_string(),
            password: password.to_string(),
            phone: String::new(),
            totp: String::new(),
        }
    }

    fn item(fields: LoginFields) -> Item {
        Item::Login {
            base: ItemBase {
                id: Uuid::new_v4(),
                title: String::new(),
                notes: String::new(),
                created_at: 0,
                updated_at: 0,
                favicon: String::new(),
            },
            fields,
        }
    }

    fn card_item(number: &str) -> Item {
        Item::Card {
            base: ItemBase {
                id: Uuid::new_v4(),
                title: String::new(),
                notes: String::new(),
                created_at: 0,
                updated_at: 0,
                favicon: String::new(),
            },
            fields: crate::vault::CardFields {
                cardholder: String::new(),
                number: number.to_string(),
                exp: String::new(),
                cvv: String::new(),
            },
        }
    }

    #[test]
    fn host_of_strips_scheme_www_port_and_path() {
        assert_eq!(host_of("https://www.twitch.tv/login").as_deref(), Some("twitch.tv"));
        assert_eq!(host_of("http://mail.google.com").as_deref(), Some("mail.google.com"));
        assert_eq!(host_of("https://EXAMPLE.com:8443/x?y#z").as_deref(), Some("example.com"));
    }

    #[test]
    fn host_of_rejects_non_http_and_hostless_strings() {
        assert_eq!(host_of(""), None);
        assert_eq!(host_of("ftp://example.com"), None);
        assert_eq!(host_of("https://localhost"), None);
    }

    #[test]
    fn to_meta_sets_host_for_logins_only() {
        let mut fields = login("credentials", "u", "p");
        fields.url = "https://www.twitch.tv".to_string();
        let meta = to_meta(&item(fields));
        assert_eq!(meta.host.as_deref(), Some("twitch.tv"));
        assert_eq!(to_meta(&card_item("4111-2222-3333-4444")).host, None);
    }

    #[test]
    fn to_meta_extracts_card_bin_from_formatted_number() {
        let meta = to_meta(&card_item("4111-2222-3333-4444"));
        assert_eq!(meta.card_bin.as_deref(), Some("411122"));
    }

    #[test]
    fn to_meta_card_bin_none_for_non_card_items() {
        let meta = to_meta(&item(login("credentials", "u", "p")));
        assert_eq!(meta.card_bin, None);
    }

    #[test]
    fn login_password_only_borrows_matching_provider_account() {
        let mut v = new_vault(vec![]);
        v.items.push(item(login("credentials", "me@gmail.com", "shop-pw")));
        v.items.push(item(login("google", "me@gmail.com", "google-pw")));

        let google = login("google", "me@gmail.com", "");
        assert_eq!(login_password(&v, &google), Some("google-pw"));
        let github = login("github", "me@gmail.com", "");
        assert_eq!(login_password(&v, &github), None);
        let own = login("credentials", "me@gmail.com", "own-pw");
        assert_eq!(login_password(&v, &own), Some("own-pw"));
        let empty = login("credentials", "me@gmail.com", "");
        assert_eq!(login_password(&v, &empty), None);
    }

    #[test]
    fn autolock_if_idle_clears_only_expired_unlocked_session() {
        let s = AppState::new();
        assert!(!s.autolock_if_idle(), "locked vault: nothing to do");

        *s.key.lock().unwrap() = Some(storage::KeySet::new("test-master"));
        *s.vault.lock().unwrap() = Some(new_vault(vec![]));
        assert!(!s.autolock_if_idle(), "fresh timer must not lock");

        s.autolock.lock().unwrap().set_timeout(0);
        assert!(s.autolock_if_idle());
        assert!(s.key.lock().unwrap().is_none());
        assert!(s.vault.lock().unwrap().is_none());
    }

    #[test]
    fn needs_upload_is_true_when_never_backed_up() {
        let _g = crate::test_env::lock_recover(&crate::test_env::ENV_LOCK);
        crate::test_env::override_data_dir_to_tmp("needs-upload-never");
        let p = crate::storage::data_dir().join("v.enc");
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, b"x").unwrap();
        assert!(needs_upload(&p, 0));
    }

    #[test]
    fn needs_upload_is_false_when_the_stamp_is_newer_than_the_file() {
        let _g = crate::test_env::lock_recover(&crate::test_env::ENV_LOCK);
        crate::test_env::override_data_dir_to_tmp("needs-upload-fresh");
        let p = crate::storage::data_dir().join("v.enc");
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, b"x").unwrap();
        let future_ms = (chrono::Utc::now().timestamp() + 3600) * 1000;
        assert!(!needs_upload(&p, future_ms));
    }

    #[test]
    fn needs_upload_is_true_when_the_file_is_newer_than_the_stamp() {
        let _g = crate::test_env::lock_recover(&crate::test_env::ENV_LOCK);
        crate::test_env::override_data_dir_to_tmp("needs-upload-stale");
        let p = crate::storage::data_dir().join("v.enc");
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, b"x").unwrap();
        let ancient_ms = (chrono::Utc::now().timestamp() - 86_400) * 1000;
        assert!(needs_upload(&p, ancient_ms));
    }

    #[test]
    fn needs_upload_is_false_when_the_vault_file_is_missing() {
        let _g = crate::test_env::lock_recover(&crate::test_env::ENV_LOCK);
        crate::test_env::override_data_dir_to_tmp("needs-upload-missing");
        let p = crate::storage::data_dir().join("nope.enc");
        assert!(!needs_upload(&p, 0));
    }

    fn file_mtime_ms(p: &std::path::Path) -> i64 {
        std::fs::metadata(p)
            .unwrap()
            .modified()
            .unwrap()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64
    }

    #[test]
    fn needs_upload_is_false_when_the_stamp_equals_the_file_mtime() {
        // Under millisecond precision, an equal stamp means "this exact file
        // version was already uploaded" — the opposite of the old
        // whole-second `>=` boundary, which had to treat equal as "still
        // needs upload" because it could not tell two same-second saves
        // apart. Renamed and re-asserted for the new semantics.
        let _g = crate::test_env::lock_recover(&crate::test_env::ENV_LOCK);
        crate::test_env::override_data_dir_to_tmp("needs-upload-equal");
        let p = crate::storage::data_dir().join("v.enc");
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, b"x").unwrap();
        let mtime_ms = file_mtime_ms(&p);
        assert!(!needs_upload(&p, mtime_ms));
    }

    #[test]
    fn needs_upload_is_true_when_the_file_is_a_millisecond_newer_than_the_stamp() {
        let _g = crate::test_env::lock_recover(&crate::test_env::ENV_LOCK);
        crate::test_env::override_data_dir_to_tmp("needs-upload-1ms-newer");
        let p = crate::storage::data_dir().join("v.enc");
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, b"x").unwrap();
        let mtime_ms = file_mtime_ms(&p);
        assert!(needs_upload(&p, mtime_ms - 1));
    }

    #[test]
    fn take_backup_job_is_none_when_locked() {
        let st = AppState::new();
        assert!(st.take_backup_job().is_none());
    }

    #[test]
    fn take_backup_job_is_none_without_a_backup_config() {
        let _g = crate::test_env::lock_recover(&crate::test_env::ENV_LOCK);
        crate::test_env::override_data_dir_to_tmp("take-job-unconfigured");
        let account = crate::accounts::create_account("job-test").unwrap();
        let st = AppState::new();
        *st.current_account.lock().unwrap() = Some(account);
        *st.vault.lock().unwrap() = Some(crate::vault::new_vault(vec![1, 2, 3]));
        assert!(st.take_backup_job().is_none());
    }

    #[test]
    fn take_backup_job_is_some_when_unlocked_configured_and_never_uploaded() {
        // Both existing take_backup_job tests return at the `backup.clone()?`
        // short-circuit and never reach needs_upload; this exercises the
        // positive path so inverting that condition can't silently pass.
        let _g = crate::test_env::lock_recover(&crate::test_env::ENV_LOCK);
        crate::test_env::override_data_dir_to_tmp("take-job-positive");
        let account = crate::accounts::create_account("job-positive").unwrap();
        let keys = storage::KeySet::new("test-master-pw");
        let mut vault = crate::vault::new_vault(keys.master_salt.clone());
        vault.backup = Some(cloud::BackupConfig {
            url: "https://w.example.dev".into(),
            put_token: "t".into(),
        });
        // Written to disk so needs_upload's mtime check has a real file to
        // read — take_backup_job compares against storage::vault_path.
        storage::save_vault(&account, &vault, &keys).unwrap();

        let st = AppState::new();
        *st.current_account.lock().unwrap() = Some(account);
        *st.vault.lock().unwrap() = Some(vault);

        let job = st.take_backup_job();
        assert!(job.is_some(), "expected a job: unlocked, configured, never uploaded");
    }

    #[test]
    fn resetting_a_vault_does_not_back_it_up() {
        // A reset destroys the vault on purpose. Uploading it on the way out
        // would leave in the cloud exactly what the user asked to erase.
        let src = std::fs::read_to_string(file!()).unwrap();
        assert!(
            !body_of(&src, "fn reset_vault").contains("lock_and_backup"),
            "reset_vault must lock without backing up"
        );

        // This alone only proves reset_vault's own body is clean. Moving the
        // spawn INTO lock_and_clear itself — which reset_vault also calls —
        // would upload on reset too and still pass the assertion above, so
        // pin lock_and_clear's body separately.
        assert!(
            !body_of(&src, "fn lock_and_clear").contains("spawn_backup"),
            "lock_and_clear must not itself call spawn_backup"
        );
    }

    /// Return one function's body, delimited by brace matching.
    ///
    /// Bounding by "the next `fn`" looked simpler and was wrong: adding
    /// `pub(crate)` to the following method silently widened the slice to the
    /// rest of the file, and the assertion then read a body it was never
    /// meant to see. Counting braces survives visibility changes, reordering
    /// and renames of neighbours. `sig` is matched without a visibility
    /// prefix for the same reason.
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
    fn body_of_stops_at_the_functions_own_closing_brace() {
        let src = "fn a() {\n    let x = Foo { y: 1 };\n}\nfn b() {\n    poison();\n}\n";
        let body = body_of(src, "fn a");
        assert!(body.contains("let x"), "must include the real body");
        assert!(!body.contains("poison"), "must not bleed into the next fn");
    }
}

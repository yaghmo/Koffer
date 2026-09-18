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
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

pub struct AppState {
    /// The unlocked key set: the data key that decrypts the vault plus the
    /// wrapping keys needed to write it back.
    pub key: Mutex<Option<storage::KeySet>>,
    pub vault: Mutex<Option<Vault>>,
    pub autolock: Mutex<AutoLock>,
    pub current_account: Mutex<Option<Account>>,
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
        let last = config::load(&account).last_cloud_backup_secs;
        if !needs_upload(&path, last) {
            return None;
        }
        Some((cfg, path, account))
    }

    fn lock_and_clear(&self) {
        if let Ok(mut k) = self.key.lock() {
            if let Some(keys) = k.as_mut() {
                for b in keys.data_key.iter_mut() {
                    *b = 0;
                }
                if let Some(kek) = keys.master_kek.as_mut() {
                    for b in kek.iter_mut() {
                        *b = 0;
                    }
                }
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
    fn lock_and_backup(&self) {
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
        al.set_timeout(config::load(account).autolock_mins.clamp(15, 30));
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
fn host_of(url: &str) -> Option<String> {
    let rest = url
        .trim()
        .strip_prefix("https://")
        .or_else(|| url.trim().strip_prefix("http://"))?;
    let host = rest.split(['/', '?', '#']).next()?.split('@').last()?;
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
    Ok(())
}

#[tauri::command]
pub fn lock_vault(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    crate::log_info!("lock_vault", "locked");
    state.lock_and_backup();
    let _ = app.emit("vault://locked", ());
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
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
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
    crate::log_info!("copy_to_clipboard", "chars={} ttl_secs={}", text.chars().count(), ttl.as_secs());
    crate::clipboard::copy_with_ttl(&text, ttl).map_err(|e| e.to_string())?;
    state.autolock.lock().unwrap().reset();
    Ok(())
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
    pub last_cloud_backup_secs: i64,
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
        last_cloud_backup_secs: cfg.last_cloud_backup_secs,
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
    let (vault, mut keys) = storage::load_vault(&account, &password)
        .map_err(|_| "invalid password".to_string())?;

    let (secret, code) = crate::recovery::generate();
    keys.set_recovery_secret(&secret);
    storage::save_vault(&account, &vault, &keys).map_err(|e| e.to_string())?;
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
    let (vault, mut keys) = storage::load_vault(&account, &current).map_err(|_| {
        crate::log_warn!("change_master_password", "refused (bad current password)");
        "current password is not correct".to_string()
    })?;

    // The recovery slot rides along sealed, so an existing recovery code
    // keeps opening the vault after the password changes.
    keys.set_master_password(&new_password);
    storage::save_vault(&account, &vault, &keys).map_err(|e| e.to_string())?;
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
    storage::load_vault(&account, &password).map_err(|_| {
        crate::log_warn!("reset_vault", "refused account={account_id} (bad password)");
        "invalid password".to_string()
    })?;

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
}

#[tauri::command]
pub fn get_backup_config(state: State<'_, AppState>) -> Result<BackupState, String> {
    let account = current_account(&state)?;
    let vault = state.vault.lock().unwrap();
    let vault = vault.as_ref().ok_or_else(|| "locked".to_string())?;
    let cfg = vault.backup.as_ref();
    Ok(BackupState {
        configured: cfg.is_some(),
        url: cfg.map(|c| c.url.clone()).unwrap_or_default(),
        last_backup_secs: config::load(&account).last_cloud_backup_secs,
    })
}

#[tauri::command]
pub fn set_backup_config(
    url: String,
    put_token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    cloud::validate_url(&url).map_err(|e| e.to_string())?;
    if put_token.trim().is_empty() {
        return Err("token cannot be empty".into());
    }
    let account = current_account(&state)?;
    let keys = state.key.lock().unwrap();
    let keys = keys.as_ref().ok_or_else(|| "locked".to_string())?;
    let mut vault = state.vault.lock().unwrap();
    let vault = vault.as_mut().ok_or_else(|| "locked".to_string())?;

    vault.backup = Some(cloud::BackupConfig {
        url: url.trim().trim_end_matches('/').to_string(),
        put_token: put_token.trim().to_string(),
    });
    storage::save_vault(&account, vault, keys).map_err(|e| e.to_string())?;
    // The URL is as sensitive as the domain list the vault protects, so it is
    // absent here on purpose.
    crate::log_info!("set_backup_config", "cloud backup configured");
    Ok(())
}

#[tauri::command]
pub fn clear_backup_config(state: State<'_, AppState>) -> Result<(), String> {
    let account = current_account(&state)?;
    let keys = state.key.lock().unwrap();
    let keys = keys.as_ref().ok_or_else(|| "locked".to_string())?;
    let mut vault = state.vault.lock().unwrap();
    let vault = vault.as_mut().ok_or_else(|| "locked".to_string())?;

    vault.backup = None;
    storage::save_vault(&account, vault, keys).map_err(|e| e.to_string())?;
    crate::log_info!("clear_backup_config", "cloud backup disabled");
    Ok(())
}

/// Whether the vault has been written since the last successful upload.
///
/// This compares the file's mtime against a stored timestamp rather than
/// tracking a dirty flag: `save_vault` has nine call sites and no shared
/// wrapper, so a flag would mean nine edits today and a missed one the first
/// time a tenth call site appears. The mtime is the same signal with none of
/// that surface, and it survives a restart.
pub fn needs_upload(vault_path: &std::path::Path, last_backup_secs: i64) -> bool {
    let modified = match std::fs::metadata(vault_path).and_then(|m| m.modified()) {
        Ok(t) => t,
        Err(_) => return false,
    };
    let secs = match modified.duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => d.as_secs() as i64,
        Err(_) => return false,
    };
    // `>=`, not `>`: both sides are whole seconds, so an upload that finishes
    // in the same second as the save it uploaded stamps a time equal to the
    // file's mtime. Treating equal as "already backed up" would permanently
    // skip a later edit made in that same second. The cost of being wrong the
    // other way is one redundant upload, which then stamps a later second and
    // settles.
    secs >= last_backup_secs
}

/// Fire the upload without blocking the caller.
///
/// Locking must never wait on the network: the keys are already wiped by the
/// time this runs, and a hung request must not hold the app. A failure needs
/// no retry queue either — the stamp is only written on success, so the file's
/// mtime stays newer and the next lock tries again.
pub fn spawn_backup(cfg: cloud::BackupConfig, path: std::path::PathBuf, account: Account) {
    tauri::async_runtime::spawn(async move {
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
                c.last_cloud_backup_secs = chrono::Utc::now().timestamp();
                let _ = config::save(&account, &c);
                crate::log_info!("auto_backup", "cloud backup uploaded on lock");
            }
            Err(e) => crate::log_warn!("auto_backup", "failed: {e}"),
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
    let blob = std::fs::read(&path).map_err(|e| e.to_string())?;

    cloud::upload(&cfg, blob).await.map_err(|e| {
        crate::log_warn!("backup_now", "failed: {e}");
        e.to_string()
    })?;

    let mut c = config::load(&account);
    c.last_cloud_backup_secs = chrono::Utc::now().timestamp();
    let _ = config::save(&account, &c);
    crate::log_info!("backup_now", "cloud backup uploaded");
    Ok(())
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

/// Password to prime the clipboard with when opening a login: the item's
/// own password, else (provider logins) the vault account saved for the same
/// provider and username. Never an unrelated login that merely shares the
/// username — one email is typically reused across many sites.
fn login_password<'a>(vault: &'a Vault, fields: &'a LoginFields) -> Option<&'a str> {
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
    fn backup_state_never_carries_the_token() {
        // The UI only ever needs to know that a token exists. Returning it
        // would push a live credential across IPC on every Settings render.
        let s = BackupState {
            configured: true,
            url: "https://w.example.dev".into(),
            last_backup_secs: 42,
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(!json.contains("token"), "BackupState exposes a token field: {json}");
    }

    fn login(method: &str, username: &str, password: &str) -> LoginFields {
        LoginFields {
            method: method.to_string(),
            url: String::new(),
            username: username.to_string(),
            password: password.to_string(),
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
        let future = chrono::Utc::now().timestamp() + 3600;
        assert!(!needs_upload(&p, future));
    }

    #[test]
    fn needs_upload_is_true_when_the_file_is_newer_than_the_stamp() {
        let _g = crate::test_env::lock_recover(&crate::test_env::ENV_LOCK);
        crate::test_env::override_data_dir_to_tmp("needs-upload-stale");
        let p = crate::storage::data_dir().join("v.enc");
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, b"x").unwrap();
        let ancient = chrono::Utc::now().timestamp() - 86_400;
        assert!(needs_upload(&p, ancient));
    }

    #[test]
    fn needs_upload_is_false_when_the_vault_file_is_missing() {
        let _g = crate::test_env::lock_recover(&crate::test_env::ENV_LOCK);
        crate::test_env::override_data_dir_to_tmp("needs-upload-missing");
        let p = crate::storage::data_dir().join("nope.enc");
        assert!(!needs_upload(&p, 0));
    }

    #[test]
    fn needs_upload_is_true_when_the_stamp_equals_the_file_mtime() {
        // A same-second upload stamps a time equal to the mtime. That must not
        // read as "already backed up", or an edit made in that same second is
        // never uploaded.
        let _g = crate::test_env::lock_recover(&crate::test_env::ENV_LOCK);
        crate::test_env::override_data_dir_to_tmp("needs-upload-equal");
        let p = crate::storage::data_dir().join("v.enc");
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, b"x").unwrap();
        let mtime = std::fs::metadata(&p)
            .unwrap()
            .modified()
            .unwrap()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        assert!(needs_upload(&p, mtime));
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
    fn resetting_a_vault_does_not_back_it_up() {
        // A reset destroys the vault on purpose. Uploading it on the way out
        // would leave in the cloud exactly what the user asked to erase.
        let src = std::fs::read_to_string(file!()).unwrap();
        let reset = src
            .split("pub fn reset_vault")
            .nth(1)
            .expect("reset_vault not found");
        let body = &reset[..reset.find("\npub fn ").unwrap_or(reset.len())];
        assert!(
            !body.contains("lock_and_backup"),
            "reset_vault must lock without backing up"
        );
    }
}

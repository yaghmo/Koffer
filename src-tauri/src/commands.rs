//! Tauri IPC command handlers.
//!
//! Sensitive state (the derived key, the in-memory vault, the active
//! account) lives behind Mutex<Option<...>> in the app's managed state.

use crate::accounts::{self, Account, AccountMeta};
use crate::autolock::AutoLock;
use crate::config::{self, Config};
use crate::crypto::{derive_key, random_bytes};
use crate::password::{self, GenOpts};
use crate::storage;
use crate::vault::{self, Item, Vault};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

pub struct AppState {
    pub key: Mutex<Option<[u8; 32]>>,
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

    fn lock_and_clear(&self) {
        if let Ok(mut k) = self.key.lock() {
            if let Some(ref mut bytes) = *k {
                for b in bytes.iter_mut() {
                    *b = 0;
                }
            }
            *k = None;
        }
        if let Ok(mut v) = self.vault.lock() {
            *v = None;
        }
        if let Ok(mut a) = self.current_account.lock() {
            *a = None;
        }
    }
}

#[derive(Serialize, Clone)]
pub struct ItemMeta {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub updated_at: i64,
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
    }
}

#[tauri::command]
pub fn list_accounts() -> Result<Vec<AccountMeta>, String> {
    accounts::list_accounts().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn setup_vault(
    password: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<AccountMeta, String> {
    if password.len() < 8 {
        return Err("password must be at least 8 characters".to_string());
    }
    let account = accounts::create_account(&name).map_err(|e| e.to_string())?;
    let salt = random_bytes(16);
    let key = derive_key(&password, &salt);
    let vault = vault::new_vault(salt);
    storage::save_vault(&account, &vault, &key).map_err(|e| e.to_string())?;
    *state.key.lock().unwrap() = Some(key);
    *state.vault.lock().unwrap() = Some(vault);
    *state.current_account.lock().unwrap() = Some(account.clone());
    state.autolock.lock().unwrap().reset();
    Ok((&account).into())
}

#[tauri::command]
pub fn unlock_vault(
    password: String,
    account_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let id = Uuid::parse_str(&account_id).map_err(|e| e.to_string())?;
    let account = accounts::get_account_legacy_fallback(id).map_err(|e| e.to_string())?;
    let vault_on_disk = storage::load_vault_unverified(&account)
        .map_err(|_| "invalid password".to_string())?;
    let key = derive_key(&password, &vault_on_disk.kdf_salt);
    storage::load_vault_with_key(&account, &key).map_err(|_| "invalid password".to_string())?;
    *state.key.lock().unwrap() = Some(key);
    *state.vault.lock().unwrap() = Some(vault_on_disk);
    *state.current_account.lock().unwrap() = Some(account);
    state.autolock.lock().unwrap().reset();
    Ok(())
}

#[tauri::command]
pub fn lock_vault(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    state.lock_and_clear();
    let _ = app.emit("vault://locked", ());
    Ok(())
}

#[tauri::command]
pub fn is_unlocked(state: State<'_, AppState>) -> bool {
    state.key.lock().unwrap().is_some()
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
        .map(to_meta)
        .collect();
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(out)
}

#[tauri::command]
pub fn get_item(id: String, state: State<'_, AppState>) -> Result<Item, String> {
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
    let key = {
        let k = state.key.lock().unwrap();
        *k.as_ref().ok_or_else(|| "locked".to_string())?
    };
    let mut vault = state.vault.lock().unwrap();
    let vault = vault.as_mut().ok_or_else(|| "locked".to_string())?;
    let now = chrono::Utc::now().timestamp();
    let mut item = item;
    let base = item.base_mut();
    if base.created_at == 0 {
        base.created_at = now;
    }
    base.updated_at = now;
    if vault::get_item(vault, item.id()).is_some() {
        vault::update_item(vault, item);
    } else {
        vault::add_item(vault, item);
    }
    storage::save_vault(&account, vault, &key).map_err(|e| e.to_string())?;
    state.autolock.lock().unwrap().reset();
    Ok(())
}

#[tauri::command]
pub fn delete_item(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let account = {
        let a = state.current_account.lock().unwrap();
        a.clone().ok_or_else(|| "locked".to_string())?
    };
    let key = {
        let k = state.key.lock().unwrap();
        *k.as_ref().ok_or_else(|| "locked".to_string())?
    };
    let mut vault = state.vault.lock().unwrap();
    let vault = vault.as_mut().ok_or_else(|| "locked".to_string())?;
    let uuid = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    vault::delete_item(vault, uuid);
    storage::save_vault(&account, vault, &key).map_err(|e| e.to_string())?;
    state.autolock.lock().unwrap().reset();
    Ok(())
}

#[tauri::command]
pub fn generate_password(opts: GenOpts) -> Result<String, String> {
    password::generate(&opts).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn copy_to_clipboard(
    text: String,
    ttl_secs: Option<u32>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let ttl = std::time::Duration::from_secs(ttl_secs.unwrap_or(30) as u64);
    crate::clipboard::copy_with_ttl(&text, ttl).map_err(|e| e.to_string())?;
    state.autolock.lock().unwrap().reset();
    Ok(())
}

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> Result<Config, String> {
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
    if !(15..=30).contains(&mins) {
        return Err("autolock must be between 15 and 30 minutes".to_string());
    }
    let account = state
        .current_account
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "no active account".to_string())?;
    let mut c = config::load(&account);
    c.autolock_mins = mins;
    config::save(&account, &c).map_err(|e| e.to_string())?;
    state.autolock.lock().unwrap().set_timeout(mins);
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
    let id = Uuid::parse_str(&account_id).map_err(|e| e.to_string())?;
    let account = accounts::get_account_legacy_fallback(id).map_err(|e| e.to_string())?;

    // Verify by attempting a full unlock cycle against the existing vault.
    let vault_on_disk = storage::load_vault_unverified(&account)
        .map_err(|_| "invalid password".to_string())?;
    let key = derive_key(&password, &vault_on_disk.kdf_salt);
    storage::load_vault_with_key(&account, &key)
        .map_err(|_| "invalid password".to_string())?;

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
    Ok(())
}

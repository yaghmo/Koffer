//! Tauri IPC command handlers.
//!
//! All sensitive state (the derived key) lives behind a Mutex<Option<...>>
//! in the app's managed state. Commands acquire the lock briefly, do their
//! work, and release.

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
}

impl AppState {
    pub fn new() -> Self {
        let cfg = config::load();
        Self {
            key: Mutex::new(None),
            vault: Mutex::new(None),
            autolock: Mutex::new(AutoLock::new(cfg.autolock_mins)),
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
pub fn vault_exists() -> bool {
    storage::vault_exists()
}

#[tauri::command]
pub fn setup_vault(password: String, state: State<'_, AppState>) -> Result<(), String> {
    if password.len() < 8 {
        return Err("password must be at least 8 characters".to_string());
    }
    let salt = random_bytes(16);
    let key = derive_key(&password, &salt);
    let vault = vault::new_vault(salt);
    storage::save_vault(&vault, &key).map_err(|e| e.to_string())?;
    *state.key.lock().unwrap() = Some(key);
    *state.vault.lock().unwrap() = Some(vault);
    state.autolock.lock().unwrap().reset();
    Ok(())
}

#[tauri::command]
pub fn unlock_vault(password: String, state: State<'_, AppState>) -> Result<(), String> {
    let vault_on_disk = match storage::load_vault_unverified() {
        Ok(v) => v,
        Err(_) => return Err("invalid password".to_string()),
    };
    let key = derive_key(&password, &vault_on_disk.kdf_salt);
    storage::load_vault_with_key(&key).map_err(|_| "invalid password".to_string())?;
    *state.key.lock().unwrap() = Some(key);
    *state.vault.lock().unwrap() = Some(vault_on_disk);
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
    storage::save_vault(vault, &key).map_err(|e| e.to_string())?;
    state.autolock.lock().unwrap().reset();
    Ok(())
}

#[tauri::command]
pub fn delete_item(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let key = {
        let k = state.key.lock().unwrap();
        *k.as_ref().ok_or_else(|| "locked".to_string())?
    };
    let mut vault = state.vault.lock().unwrap();
    let vault = vault.as_mut().ok_or_else(|| "locked".to_string())?;
    let uuid = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    vault::delete_item(vault, uuid);
    storage::save_vault(vault, &key).map_err(|e| e.to_string())?;
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
pub fn get_config() -> Config {
    config::load()
}

#[tauri::command]
pub fn set_autolock_mins(mins: u8, state: State<'_, AppState>) -> Result<(), String> {
    if !(15..=30).contains(&mins) {
        return Err("autolock must be between 15 and 30 minutes".to_string());
    }
    let mut c = config::load();
    c.autolock_mins = mins;
    config::save(&c).map_err(|e| e.to_string())?;
    state.autolock.lock().unwrap().set_timeout(mins);
    Ok(())
}

#[tauri::command]
pub fn reset_activity(state: State<'_, AppState>) {
    state.autolock.lock().unwrap().reset();
}

/// Wipe the vault and config from disk after verifying the user can re-enter
/// the current master password. Used by the Lock-screen "forgot password" flow
/// to escape a forgotten password. Returns Err("invalid password") on bad pw.
#[tauri::command]
pub fn reset_vault(password: String, state: State<'_, AppState>) -> Result<(), String> {
    // Verify by attempting a full unlock cycle against the existing vault.
    // load_vault_with_key will only succeed for the correct password.
    let vault_on_disk = storage::load_vault_unverified()
        .map_err(|_| "invalid password".to_string())?;
    let key = derive_key(&password, &vault_on_disk.kdf_salt);
    storage::load_vault_with_key(&key).map_err(|_| "invalid password".to_string())?;

    // Wipe the in-memory key first, then delete the files.
    state.lock_and_clear();
    storage::delete_vault_and_config().map_err(|e| e.to_string())?;
    Ok(())
}

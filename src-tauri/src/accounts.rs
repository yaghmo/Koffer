//! Account registry — one account per encrypted vault on disk.
//!
//! Each account has its own `vault-<id>.enc` and `config-<id>.json` files
//! inside the app data dir. The registry is a small JSON file
//! `accounts.json` listing `{id, name, vault_filename, config_filename}`.
//!
//! Pre-existing single-vault installs (a stray `vault.enc` with no
//! `accounts.json`) are auto-migrated on first `list_accounts()` call
//! into a single "Default" account pointing at the legacy filenames.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use thiserror::Error;
use uuid::Uuid;

const ACCOUNTS_FILE: &str = "accounts.json";
const LEGACY_VAULT_FILE: &str = "vault.enc";
const LEGACY_CONFIG_FILE: &str = "config.json";

#[derive(Debug, Error)]
pub enum AccountError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serde error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("account not found: {0}")]
    NotFound(String),
    #[error("account name cannot be empty")]
    EmptyName,
    #[error("an account named \"{0}\" already exists")]
    DuplicateName(String),
    #[error("not a valid vault file")]
    InvalidVaultFile,
}

/// Case-insensitive so "Work" and "work" can't coexist and confuse the switcher.
fn ensure_unique_name(existing: &[Account], name: &str) -> Result<(), AccountError> {
    if existing.iter().any(|a| a.name.eq_ignore_ascii_case(name)) {
        return Err(AccountError::DuplicateName(name.to_string()));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: Uuid,
    pub name: String,
    pub vault_filename: String,
    pub config_filename: String,
}

/// Lightweight view of an account, safe to send to the frontend. The full
/// `Account` struct also leaves the backend — filenames are not sensitive
/// but we keep them off the wire for now.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountMeta {
    pub id: Uuid,
    pub name: String,
}

impl From<&Account> for AccountMeta {
    fn from(a: &Account) -> Self {
        AccountMeta { id: a.id, name: a.name.clone() }
    }
}

fn data_dir() -> PathBuf {
    if let Some(p) = std::env::var_os("APPDATA") {
        return PathBuf::from(p).join("koffer");
    }
    dirs::data_dir()
        .expect("platform data dir must exist")
        .join("koffer")
}

fn accounts_path() -> PathBuf {
    data_dir().join(ACCOUNTS_FILE)
}

fn legacy_vault_path() -> PathBuf {
    data_dir().join(LEGACY_VAULT_FILE)
}

fn read_registry() -> Result<Vec<Account>, AccountError> {
    let path = accounts_path();
    if !path.exists() {
        return Ok(Vec::new());
    }
    let s = fs::read_to_string(&path)?;
    if s.trim().is_empty() {
        return Ok(Vec::new());
    }
    Ok(serde_json::from_str(&s)?)
}

fn write_registry(accounts: &[Account]) -> Result<(), AccountError> {
    if let Some(parent) = accounts_path().parent() {
        fs::create_dir_all(parent)?;
    }
    let s = serde_json::to_string_pretty(accounts)?;
    let tmp = accounts_path().with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(s.as_bytes())?;
        f.sync_all()?;
    }
    fs::rename(&tmp, accounts_path())?;
    Ok(())
}

/// One-shot migration of a pre-multi-account install: if `accounts.json`
/// doesn't exist but a legacy `vault.enc` does, register it as a single
/// "Default" account pointing at the legacy filenames. Idempotent.
fn migrate_legacy_if_needed() -> Result<(), AccountError> {
    if accounts_path().exists() {
        return Ok(());
    }
    if !legacy_vault_path().exists() {
        return Ok(());
    }
    let account = Account {
        id: Uuid::new_v4(),
        name: "Default".to_string(),
        vault_filename: LEGACY_VAULT_FILE.to_string(),
        config_filename: LEGACY_CONFIG_FILE.to_string(),
    };
    write_registry(&[account])
}

pub fn list_accounts() -> Result<Vec<AccountMeta>, AccountError> {
    migrate_legacy_if_needed()?;
    Ok(read_registry()?.iter().map(AccountMeta::from).collect())
}

pub fn get_account(id: Uuid) -> Result<Account, AccountError> {
    migrate_legacy_if_needed()?;
    read_registry()?
        .into_iter()
        .find(|a| a.id == id)
        .ok_or_else(|| AccountError::NotFound(id.to_string()))
}

/// Convenience: same as `get_account` but on lookup miss AND a legacy
/// `vault.enc` still on disk, treats the legacy file as the target. Used
/// to gracefully handle an id that points at a migrated account.
pub fn get_account_legacy_fallback(id: Uuid) -> Result<Account, AccountError> {
    match get_account(id) {
        Ok(a) => Ok(a),
        Err(_) if legacy_vault_path().exists() => Ok(Account {
            id,
            name: "Default".to_string(),
            vault_filename: LEGACY_VAULT_FILE.to_string(),
            config_filename: LEGACY_CONFIG_FILE.to_string(),
        }),
        Err(e) => Err(e),
    }
}

pub fn create_account(name: &str) -> Result<Account, AccountError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AccountError::EmptyName);
    }
    migrate_legacy_if_needed()?;
    let mut all = read_registry()?;
    ensure_unique_name(&all, trimmed)?;
    let id = Uuid::new_v4();
    let account = Account {
        id,
        name: trimmed.to_string(),
        vault_filename: format!("vault-{}.enc", id),
        config_filename: format!("config-{}.json", id),
    };
    all.push(account.clone());
    write_registry(&all)?;
    Ok(account)
}

/// Narrow header-format precheck (no decryption, no content parsing): reject
/// anything whose magic bytes/version don't look like a vault file at all,
/// so a garbage import can't create an account that's undeletable (unlock
/// and reset_vault both require successful decryption, which is unreachable
/// for a garbage file). Mirrors the same check `storage::load_vault_unverified`
/// does before trusting a file's header.
fn precheck_vault_header(src: &std::path::Path) -> Result<(), AccountError> {
    let bytes = fs::read(src)?;
    if bytes.len() < 4 + 4 + 16 + 12 {
        return Err(AccountError::InvalidVaultFile);
    }
    if &bytes[0..4] != crate::storage::MAGIC {
        return Err(AccountError::InvalidVaultFile);
    }
    let version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    if version != crate::storage::VERSION {
        return Err(AccountError::InvalidVaultFile);
    }
    Ok(())
}

pub fn import_account(src: &std::path::Path, name: &str) -> Result<Account, AccountError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AccountError::EmptyName);
    }
    precheck_vault_header(src)?;
    migrate_legacy_if_needed()?;
    let mut all = read_registry()?;
    ensure_unique_name(&all, trimmed)?;
    let id = Uuid::new_v4();
    let vault_filename = format!("vault-{}.enc", id);
    let config_filename = format!("config-{}.json", id);
    fs::create_dir_all(data_dir())?;
    fs::copy(src, data_dir().join(&vault_filename))?;

    let account = Account {
        id,
        name: trimmed.to_string(),
        vault_filename,
        config_filename,
    };
    all.push(account.clone());
    write_registry(&all)?;
    Ok(account)
}

pub fn delete_account(id: Uuid) -> Result<(), AccountError> {
    let mut all = read_registry()?;
    let pos = all
        .iter()
        .position(|a| a.id == id)
        .ok_or_else(|| AccountError::NotFound(id.to_string()))?;
    let account = all.remove(pos);
    write_registry(&all)?;

    // Best-effort file cleanup. The vault file is the encrypted blob; the
    // config file is plaintext but only contains the autolock setting.
    let vpath = data_dir().join(&account.vault_filename);
    if vpath.exists() {
        let _ = fs::remove_file(&vpath);
    }
    let cpath = data_dir().join(&account.config_filename);
    if cpath.exists() {
        let _ = fs::remove_file(&cpath);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_env::{lock_recover, override_data_dir_to_tmp};

    fn lock_env() -> std::sync::MutexGuard<'static, ()> {
        lock_recover(&crate::test_env::ENV_LOCK)
    }

    fn fresh_tmp() {
        override_data_dir_to_tmp("acct");
    }

    #[test]
    fn list_accounts_empty_when_no_files() {
        let _g = lock_env();
        fresh_tmp();
        let list = list_accounts().unwrap();
        assert!(list.is_empty());
    }

    #[test]
    fn create_then_list_returns_account() {
        let _g = lock_env();
        fresh_tmp();
        let acct = create_account("user1").unwrap();
        assert_eq!(acct.name, "user1");
        let list = list_accounts().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, acct.id);
        assert_eq!(list[0].name, "user1");
    }

    #[test]
    fn create_rejects_duplicate_name_case_insensitively() {
        let _g = lock_env();
        fresh_tmp();
        create_account("Work").unwrap();
        assert!(matches!(create_account("work"), Err(AccountError::DuplicateName(_))));
        assert_eq!(list_accounts().unwrap().len(), 1);
    }

    #[test]
    fn create_rejects_empty_name() {
        let _g = lock_env();
        fresh_tmp();
        assert!(create_account("").is_err());
        assert!(create_account("   ").is_err());
    }

    /// Builds bytes that pass the header precheck (valid MAGIC/VERSION) but
    /// are not a real encrypted vault otherwise — good enough for tests that
    /// only care about the copy/registry behavior, not decryption.
    fn fixture_vault_bytes(tail: &[u8]) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(crate::storage::MAGIC);
        bytes.extend_from_slice(&crate::storage::VERSION.to_le_bytes());
        bytes.extend_from_slice(&[0u8; 16]); // fake salt
        bytes.extend_from_slice(&[0u8; 12]); // fake nonce
        bytes.extend_from_slice(tail);
        bytes
    }

    #[test]
    fn import_account_copies_file_and_registers_new_account() {
        let _g = lock_env();
        fresh_tmp();
        let src_dir = std::env::temp_dir().join(format!("import-src-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&src_dir).unwrap();
        let src = src_dir.join("backup.enc");
        let content = fixture_vault_bytes(b"pretend-ciphertext");
        std::fs::write(&src, &content).unwrap();

        let acct = import_account(&src, "restored").unwrap();

        assert_eq!(acct.name, "restored");
        let copied = std::fs::read(data_dir().join(&acct.vault_filename)).unwrap();
        assert_eq!(copied, content);
        let list = list_accounts().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, acct.id);
    }

    #[test]
    fn import_account_rejects_garbage_file_without_registering() {
        let _g = lock_env();
        fresh_tmp();
        let src_dir = std::env::temp_dir().join(format!("import-src-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&src_dir).unwrap();
        let src = src_dir.join("garbage.enc");
        std::fs::write(&src, b"definitely not a vault file").unwrap();
        assert!(import_account(&src, "restored").is_err());
        assert!(list_accounts().unwrap().is_empty());
    }

    #[test]
    fn import_account_rejects_duplicate_name_without_copying_file() {
        let _g = lock_env();
        fresh_tmp();
        create_account("restored").unwrap();
        let src_dir = std::env::temp_dir().join(format!("import-src-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&src_dir).unwrap();
        let src = src_dir.join("backup.enc");
        std::fs::write(&src, fixture_vault_bytes(b"x")).unwrap();
        assert!(matches!(
            import_account(&src, "restored"),
            Err(AccountError::DuplicateName(_))
        ));
        assert_eq!(list_accounts().unwrap().len(), 1);
    }

    #[test]
    fn import_account_rejects_empty_name() {
        let _g = lock_env();
        fresh_tmp();
        let src_dir = std::env::temp_dir().join(format!("import-src-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&src_dir).unwrap();
        let src = src_dir.join("backup.enc");
        std::fs::write(&src, b"x").unwrap();
        assert!(import_account(&src, "").is_err());
    }

    #[test]
    fn import_account_errors_on_missing_source_without_registering() {
        let _g = lock_env();
        fresh_tmp();
        let missing = std::env::temp_dir().join(format!("no-such-file-{}.enc", Uuid::new_v4()));
        assert!(import_account(&missing, "restored").is_err());
        assert!(list_accounts().unwrap().is_empty());
    }

    #[test]
    fn get_account_returns_matching_row() {
        let _g = lock_env();
        fresh_tmp();
        let a = create_account("alice").unwrap();
        let b = create_account("bob").unwrap();
        let got = get_account(a.id).unwrap();
        assert_eq!(got.name, "alice");
        let got = get_account(b.id).unwrap();
        assert_eq!(got.name, "bob");
    }

    #[test]
    fn get_account_404s_for_unknown_id() {
        let _g = lock_env();
        fresh_tmp();
        assert!(get_account(Uuid::new_v4()).is_err());
    }

    #[test]
    fn delete_account_removes_row_and_files() {
        let _g = lock_env();
        fresh_tmp();
        let a = create_account("temp").unwrap();
        let vpath = data_dir().join(&a.vault_filename);
        let cpath = data_dir().join(&a.config_filename);
        std::fs::write(&vpath, b"x").unwrap();
        std::fs::write(&cpath, b"x").unwrap();
        delete_account(a.id).unwrap();
        assert!(list_accounts().unwrap().is_empty());
        assert!(!vpath.exists());
        assert!(!cpath.exists());
    }

    #[test]
    fn delete_unknown_id_errors() {
        let _g = lock_env();
        fresh_tmp();
        assert!(delete_account(Uuid::new_v4()).is_err());
    }

    #[test]
    fn migrate_legacy_creates_default_account() {
        let _g = lock_env();
        fresh_tmp();
        // Drop a legacy vault file with no registry.
        std::fs::create_dir_all(data_dir()).unwrap();
        std::fs::write(legacy_vault_path(), b"PM01legacy").unwrap();
        let list = list_accounts().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Default");
    }

    #[test]
    fn migrate_legacy_is_idempotent() {
        let _g = lock_env();
        fresh_tmp();
        std::fs::create_dir_all(data_dir()).unwrap();
        std::fs::write(legacy_vault_path(), b"PM01legacy").unwrap();
        let _ = list_accounts().unwrap();
        let _ = list_accounts().unwrap();
        let list = list_accounts().unwrap();
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn migrate_does_not_run_when_registry_exists() {
        let _g = lock_env();
        fresh_tmp();
        let a = create_account("first").unwrap();
        // Now drop a legacy file as if it were a leftover. Migration should
        // not re-run because the registry already exists.
        std::fs::create_dir_all(data_dir()).unwrap();
        std::fs::write(legacy_vault_path(), b"orphan").unwrap();
        let list = list_accounts().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, a.id);
    }
}

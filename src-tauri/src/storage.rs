//! Encrypted on-disk storage for the vault. Per-account: each account has
//! its own vault file under the data dir; see `accounts.rs` for the
//! registry.

use crate::accounts::Account;
use crate::crypto::encrypt;
use crate::vault::{deserialize_vault, serialize_vault, Vault, VaultError};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use thiserror::Error;

pub const MAGIC: &[u8; 4] = b"PM01";
pub const VERSION: u32 = 1;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("vault error: {0}")]
    Vault(#[from] VaultError),
    #[error("crypto error: {0}")]
    Crypto(#[from] crate::crypto::CryptoError),
    #[error("invalid vault file")]
    Invalid,
}

fn data_dir() -> PathBuf {
    if let Some(p) = std::env::var_os("APPDATA") {
        return PathBuf::from(p).join("password_manager");
    }
    dirs::data_dir()
        .expect("platform data dir must exist")
        .join("password_manager")
}

pub fn vault_path(account: &Account) -> PathBuf {
    data_dir().join(&account.vault_filename)
}

pub fn config_path(account: &Account) -> PathBuf {
    data_dir().join(&account.config_filename)
}

pub fn vault_exists(account: &Account) -> bool {
    vault_path(account).exists()
}

pub fn delete_vault_and_config(account: &Account) -> Result<(), StorageError> {
    let vp = vault_path(account);
    if vp.exists() {
        fs::remove_file(&vp)?;
    }
    let cp = config_path(account);
    if cp.exists() {
        fs::remove_file(&cp)?;
    }
    Ok(())
}

pub fn save_vault(account: &Account, vault: &Vault, key: &[u8; 32]) -> Result<(), StorageError> {
    fs::create_dir_all(data_dir())?;
    let plaintext = serialize_vault(vault)?;
    let (nonce, ciphertext) = encrypt(key, &plaintext);

    let mut blob = Vec::new();
    blob.extend_from_slice(MAGIC);
    blob.extend_from_slice(&VERSION.to_le_bytes());
    blob.extend_from_slice(&vault.kdf_salt);
    blob.extend_from_slice(&nonce);
    blob.extend_from_slice(&ciphertext);

    let path = vault_path(account);
    let tmp = path.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(&blob)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

/// Read the salt from the vault file without verifying the key.
pub fn load_vault_unverified(account: &Account) -> Result<Vault, StorageError> {
    let bytes = fs::read(vault_path(account))?;
    if bytes.len() < 4 + 4 + 16 + 12 {
        return Err(StorageError::Invalid);
    }
    if &bytes[0..4] != MAGIC {
        return Err(StorageError::Invalid);
    }
    let version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    if version != VERSION {
        return Err(StorageError::Invalid);
    }
    let salt = bytes[8..24].to_vec();
    Ok(Vault {
        version: 1,
        kdf_salt: salt,
        items: Vec::new(),
    })
}

/// Load and decrypt the vault with the given key.
pub fn load_vault_with_key(account: &Account, key: &[u8; 32]) -> Result<Vault, StorageError> {
    load_vault(account, key)
}

pub fn load_vault(account: &Account, key: &[u8; 32]) -> Result<Vault, StorageError> {
    let bytes = fs::read(vault_path(account))?;
    if bytes.len() < 4 + 4 + 16 + 12 {
        return Err(StorageError::Invalid);
    }
    if &bytes[0..4] != MAGIC {
        return Err(StorageError::Invalid);
    }
    let version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    if version != VERSION {
        return Err(StorageError::Invalid);
    }
    let salt = &bytes[8..24];
    let nonce = &bytes[24..36];
    let ct = &bytes[36..];

    let plaintext = crate::crypto::decrypt(key, nonce, ct)?;
    let vault = deserialize_vault(&plaintext)?;
    if vault.kdf_salt != salt {
        return Err(StorageError::Invalid);
    }
    Ok(vault)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts::{create_account, Account};
    use crate::crypto::derive_key;
    use crate::test_env::{lock_recover, override_data_dir_to_tmp};
    use crate::vault::new_vault;

    fn lock_env() -> std::sync::MutexGuard<'static, ()> {
        lock_recover(&crate::test_env::ENV_LOCK)
    }

    fn fresh_tmp() {
        override_data_dir_to_tmp("store");
    }

    fn fixture_account() -> Account {
        // create_account also runs migration; safe to use as a fixture.
        create_account("test").unwrap()
    }

    #[test]
    fn save_then_load_roundtrips() {
        let _g = lock_env();
        fresh_tmp();
        let acct = fixture_account();
        let salt = crate::crypto::random_bytes(16);
        let key = derive_key("master", &salt);
        let mut v = new_vault(salt.clone());
        v.items.push(crate::vault::Item::Note {
            base: crate::vault::ItemBase {
                id: uuid::Uuid::new_v4(),
                title: "test".to_string(),
                notes: "".to_string(),
                created_at: 0,
                updated_at: 0,
                favicon: String::new(),
            },
            fields: crate::vault::NoteFields {
                body: "secret body".to_string(),
            },
        });
        save_vault(&acct, &v, &key).unwrap();
        assert!(vault_exists(&acct));
        let v2 = load_vault(&acct, &key).unwrap();
        assert_eq!(v2.items.len(), 1);
    }

    #[test]
    fn load_with_wrong_key_fails() {
        let _g = lock_env();
        fresh_tmp();
        let acct = fixture_account();
        let salt = crate::crypto::random_bytes(16);
        let key = derive_key("master", &salt);
        let v = new_vault(salt);
        save_vault(&acct, &v, &key).unwrap();
        let wrong = derive_key("wrong", &crate::crypto::random_bytes(16));
        assert!(load_vault(&acct, &wrong).is_err());
    }

    #[test]
    fn load_corrupt_file_fails() {
        let _g = lock_env();
        fresh_tmp();
        let acct = fixture_account();
        fs::create_dir_all(data_dir()).unwrap();
        fs::write(vault_path(&acct), b"corrupt data here").unwrap();
        let key = derive_key("master", &crate::crypto::random_bytes(16));
        assert!(load_vault(&acct, &key).is_err());
    }

    #[test]
    fn vault_exists_false_when_no_file() {
        let _g = lock_env();
        fresh_tmp();
        let acct = fixture_account();
        assert!(!vault_exists(&acct));
    }

    #[test]
    fn load_rejects_wrong_magic() {
        let _g = lock_env();
        fresh_tmp();
        let acct = fixture_account();
        let salt = crate::crypto::random_bytes(16);
        let key = derive_key("master", &salt);
        let v = new_vault(salt);
        save_vault(&acct, &v, &key).unwrap();
        let mut bytes = fs::read(vault_path(&acct)).unwrap();
        bytes[0] = b'X';
        fs::write(vault_path(&acct), &bytes).unwrap();
        assert!(load_vault(&acct, &key).is_err());
    }

    #[test]
    fn delete_vault_and_config_removes_both_files() {
        let _g = lock_env();
        fresh_tmp();
        let acct = fixture_account();
        let salt = crate::crypto::random_bytes(16);
        let key = derive_key("master", &salt);
        let v = new_vault(salt);
        save_vault(&acct, &v, &key).unwrap();
        crate::config::save(&acct, &crate::config::Config::default()).unwrap();
        assert!(vault_exists(&acct));
        assert!(config_path(&acct).exists());
        delete_vault_and_config(&acct).unwrap();
        assert!(!vault_exists(&acct));
        assert!(!config_path(&acct).exists());
    }

    #[test]
    fn delete_when_nothing_to_delete_succeeds() {
        let _g = lock_env();
        fresh_tmp();
        let acct = fixture_account();
        delete_vault_and_config(&acct).unwrap();
    }
}

//! Encrypted on-disk storage for the vault.

use crate::crypto::{derive_key, encrypt};
use crate::vault::{deserialize_vault, new_vault, serialize_vault, Vault, VaultError};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use thiserror::Error;

const MAGIC: &[u8; 4] = b"PM01";
const VERSION: u32 = 1;
const APP_DIR: &str = "password_manager";
const VAULT_FILE: &str = "vault.enc";

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
    dirs::data_dir()
        .expect("platform data dir must exist")
        .join(APP_DIR)
}

pub fn vault_path() -> PathBuf {
    data_dir().join(VAULT_FILE)
}

pub fn config_path() -> PathBuf {
    data_dir().join("config.json")
}

pub fn vault_exists() -> bool {
    vault_path().exists()
}

pub fn save_vault(vault: &Vault, key: &[u8; 32]) -> Result<(), StorageError> {
    fs::create_dir_all(data_dir())?;
    let plaintext = serialize_vault(vault)?;
    let (nonce, ciphertext) = encrypt(key, &plaintext);

    let mut blob = Vec::new();
    blob.extend_from_slice(MAGIC);
    blob.extend_from_slice(&VERSION.to_le_bytes());
    blob.extend_from_slice(&vault.kdf_salt);
    blob.extend_from_slice(&nonce);
    blob.extend_from_slice(&ciphertext);

    let tmp = vault_path().with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(&blob)?;
        f.sync_all()?;
    }
    // atomic rename
    fs::rename(&tmp, vault_path())?;
    Ok(())
}

pub fn load_vault(key: &[u8; 32]) -> Result<Vault, StorageError> {
    let bytes = fs::read(vault_path())?;
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

    fn override_data_dir_to_tmp() {
        let tmp = tempfile::tempdir().unwrap();
        // SAFETY: tests are single-threaded for this module; in production this is set in main()
        unsafe {
            std::env::set_var("APPDATA", tmp.path());
            std::env::set_var("XDG_DATA_HOME", tmp.path());
        }
        // also override HOME for macOS-style fallback
        unsafe {
            std::env::set_var("HOME", tmp.path());
        }
    }

    #[test]
    fn save_then_load_roundtrips() {
        override_data_dir_to_tmp();
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
            },
            fields: crate::vault::NoteFields {
                body: "secret body".to_string(),
            },
        });
        save_vault(&v, &key).unwrap();
        assert!(vault_exists());
        let v2 = load_vault(&key).unwrap();
        assert_eq!(v2.items.len(), 1);
    }

    #[test]
    fn load_with_wrong_key_fails() {
        override_data_dir_to_tmp();
        let salt = crate::crypto::random_bytes(16);
        let key = derive_key("master", &salt);
        let v = new_vault(salt);
        save_vault(&v, &key).unwrap();
        let wrong = derive_key("wrong", &crate::crypto::random_bytes(16));
        assert!(load_vault(&wrong).is_err());
    }

    #[test]
    fn load_corrupt_file_fails() {
        override_data_dir_to_tmp();
        fs::create_dir_all(data_dir()).unwrap();
        fs::write(vault_path(), b"corrupt data here").unwrap();
        let key = derive_key("master", &crate::crypto::random_bytes(16));
        assert!(load_vault(&key).is_err());
    }

    #[test]
    fn vault_exists_false_when_no_file() {
        override_data_dir_to_tmp();
        assert!(!vault_exists());
    }

    #[test]
    fn load_rejects_wrong_magic() {
        override_data_dir_to_tmp();
        fs::create_dir_all(data_dir()).unwrap();
        // craft a file with wrong magic
        let salt = crate::crypto::random_bytes(16);
        let key = derive_key("master", &salt);
        let v = new_vault(salt);
        save_vault(&v, &key).unwrap();
        let mut bytes = fs::read(vault_path()).unwrap();
        bytes[0] = b'X';
        fs::write(vault_path(), &bytes).unwrap();
        assert!(load_vault(&key).is_err());
    }
}

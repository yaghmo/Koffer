//! Encrypted on-disk storage for the vault. Per-account: each account has
//! its own vault file under the data dir; see `accounts.rs` for the
//! registry.

use crate::accounts::Account;
use crate::crypto::{decrypt_with_aad, encrypt_with_aad};
use zeroize::Zeroize;
use crate::vault::{deserialize_vault, serialize_vault, PersonalInfo, Vault, VaultError};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use thiserror::Error;

pub const MAGIC: &[u8; 4] = b"PM01";

/// Current on-disk format.
///
/// * v1 — vault sealed directly under the password-derived key, no AAD.
/// * v2 — same, with the header authenticated as associated data.
/// * v3 — a random *data key* encrypts the vault; that data key is stored
///   wrapped under the password-derived key, and optionally a second time
///   under a recovery-code-derived key. This is what makes both password
///   changes and recovery possible without re-encrypting anything.
///
/// Older files still open and are upgraded to v3 on their next save.
pub const VERSION: u32 = 3;
pub const VERSION_LEGACY_NO_AAD: u32 = 1;
pub const VERSION_DIRECT_KEY: u32 = 2;

/// v1/v2 layout: magic (4) + version (4) + salt (16), then nonce + ciphertext.
const HEADER_LEN: usize = 24;

// v3 layout, all offsets from the start of the file:
//   0..4     magic
//   4..8     version
//   8..24    master salt
//   24..40   recovery salt
//   40..41   recovery slot in use (0/1)
//   41..53   master wrap nonce
//   53..101  master-wrapped data key (32 + 16 tag)
//   101..113 recovery wrap nonce
//   113..161 recovery-wrapped data key
//   161..173 vault nonce
//   173..    vault ciphertext
const V3_RECOVERY_SALT: usize = 24;
const V3_FLAG: usize = 40;
const V3_MASTER_NONCE: usize = 41;
const V3_MASTER_WRAP: usize = 53;
const V3_RECOVERY_NONCE: usize = 101;
const V3_RECOVERY_WRAP: usize = 113;
const V3_VAULT_NONCE: usize = 161;
const V3_VAULT_CT: usize = 173;
const WRAPPED_KEY_LEN: usize = 48; // 32-byte key + 16-byte tag
// Each wrapped key is authenticated against its *own* salt rather than the
// whole header, so changing the master password (new master salt) does not
// invalidate the recovery slot, and re-issuing a recovery code does not
// invalidate the master slot. The vault ciphertext still binds the entire
// header, so neither slot can be swapped without detection.
fn wrap_aad(salt: &[u8], slot: u8) -> Vec<u8> {
    let mut aad = Vec::with_capacity(4 + 4 + salt.len() + 1);
    aad.extend_from_slice(MAGIC);
    aad.extend_from_slice(&VERSION.to_le_bytes());
    aad.extend_from_slice(salt);
    aad.push(slot);
    aad
}

const SLOT_MASTER: u8 = b'm';
const SLOT_RECOVERY: u8 = b'r';

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
    #[error("this vault has no recovery code set up")]
    NoRecovery,
    #[error("no master password set for this vault")]
    NoMasterKey,
}

pub fn data_dir() -> PathBuf {
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

pub fn export_vault_file(account: &Account, dest: &std::path::Path) -> Result<(), StorageError> {
    let src = vault_path(account);
    // Guard against exporting onto the live vault file itself. Both paths
    // are already absolute (built from the same data_dir()), so a plain
    // path comparison is enough — canonicalize() would require dest to
    // already exist, which isn't true for the common "new file" case, so
    // it's the wrong tool here. Treated as a no-op success: the vault file
    // already *is* at dest, so nothing needs to happen.
    if src == dest {
        return Ok(());
    }
    fs::copy(src, dest)?;
    Ok(())
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

/// The recovery half of a key set.
#[derive(Clone)]
pub enum RecoverySlot {
    /// Freshly derived — the data key gets wrapped under it on the next save.
    Kek([u8; 32]),
    /// Read from disk and not being changed; copied through byte for byte so
    /// the code keeps working without ever being typed again.
    Sealed { nonce: Vec<u8>, wrap: Vec<u8> },
}

/// Everything needed to rebuild a v3 file: the data key that encrypts the
/// vault, and the wrapped copies of it.
#[derive(Clone)]
pub struct KeySet {
    pub data_key: [u8; 32],
    pub master_salt: Vec<u8>,
    pub recovery_salt: Vec<u8>,
    pub recovery: Option<RecoverySlot>,
    /// None when the vault was opened with a recovery code: the caller must
    /// set a new master key before saving, and `save_vault` refuses until it
    /// does rather than sealing the vault under a placeholder.
    pub master_kek: Option<[u8; 32]>,
}

impl KeySet {
    /// A brand-new key set: random data key, random salts, no recovery slot.
    pub fn new(master_password: &str) -> Self {
        let master_salt = crate::crypto::random_bytes(16);
        let master_kek = crate::crypto::derive_key(master_password, &master_salt);
        let mut data_key = [0u8; 32];
        data_key.copy_from_slice(&crate::crypto::random_bytes(32));
        KeySet {
            data_key,
            master_salt,
            recovery_salt: crate::crypto::random_bytes(16),
            recovery: None,
            master_kek: Some(master_kek),
        }
    }

    pub fn has_recovery(&self) -> bool {
        self.recovery.is_some()
    }

    /// Point the master slot at a new password.
    pub fn set_master_password(&mut self, password: &str) {
        self.master_salt = crate::crypto::random_bytes(16);
        self.master_kek = Some(crate::crypto::derive_key(password, &self.master_salt));
    }

    /// Point the recovery slot at a new code.
    pub fn set_recovery_secret(&mut self, secret: &[u8]) {
        self.recovery_salt = crate::crypto::random_bytes(16);
        self.recovery = Some(RecoverySlot::Kek(crate::crypto::derive_key(
            &hex(secret),
            &self.recovery_salt,
        )));
    }
}

pub fn save_vault(account: &Account, vault: &Vault, keys: &KeySet) -> Result<(), StorageError> {
    fs::create_dir_all(data_dir())?;

    let master_kek = keys.master_kek.ok_or(StorageError::NoMasterKey)?;

    let mut head = Vec::with_capacity(V3_VAULT_NONCE);
    head.extend_from_slice(MAGIC);
    head.extend_from_slice(&VERSION.to_le_bytes());
    head.extend_from_slice(&keys.master_salt);
    head.extend_from_slice(&keys.recovery_salt);
    head.push(u8::from(keys.has_recovery()));

    let (master_nonce, master_wrap) = encrypt_with_aad(
        &master_kek,
        &keys.data_key,
        &wrap_aad(&keys.master_salt, SLOT_MASTER),
    );
    let (recovery_nonce, recovery_wrap) = match &keys.recovery {
        Some(RecoverySlot::Kek(kek)) => {
            encrypt_with_aad(kek, &keys.data_key, &wrap_aad(&keys.recovery_salt, SLOT_RECOVERY))
        }
        Some(RecoverySlot::Sealed { nonce, wrap }) => (nonce.clone(), wrap.clone()),
        // Unused slot: zero-filled so the file layout stays fixed.
        None => (vec![0u8; 12], vec![0u8; WRAPPED_KEY_LEN]),
    };

    let mut full_header = head;
    full_header.extend_from_slice(&master_nonce);
    full_header.extend_from_slice(&master_wrap);
    full_header.extend_from_slice(&recovery_nonce);
    full_header.extend_from_slice(&recovery_wrap);

    let mut plaintext = serialize_vault(vault)?;
    let (nonce, ciphertext) = encrypt_with_aad(&keys.data_key, &plaintext, &full_header);
    // The serialized vault is every secret in one buffer; don't leave it in
    // freed heap memory once it has been encrypted.
    plaintext.zeroize();

    let mut blob = Vec::new();
    blob.extend_from_slice(&full_header);
    blob.extend_from_slice(&nonce);
    blob.extend_from_slice(&ciphertext);

    let path = vault_path(account);
    let tmp = path.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(&blob)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, &path)?;
    // Best-effort: a rotating local copy protects against a corrupted write
    // or an accidental delete. Never fails the save.
    let _ = write_backup(account, &blob);
    Ok(())
}

/// How many timestamped copies of each vault are kept.
const BACKUP_COPIES: usize = 10;

pub fn backups_dir() -> PathBuf {
    data_dir().join("backups")
}

fn write_backup(account: &Account, blob: &[u8]) -> Result<(), StorageError> {
    let dir = backups_dir();
    fs::create_dir_all(&dir)?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let stem = account.vault_filename.trim_end_matches(".enc");
    fs::write(dir.join(format!("{stem}-{stamp}.enc")), blob)?;

    // Keep the newest few; filenames sort chronologically by construction.
    let mut mine: Vec<PathBuf> = fs::read_dir(&dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with(stem))
                .unwrap_or(false)
        })
        .collect();
    mine.sort();
    while mine.len() > BACKUP_COPIES {
        let oldest = mine.remove(0);
        let _ = fs::remove_file(oldest);
    }
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
    if version != VERSION && version != VERSION_LEGACY_NO_AAD {
        return Err(StorageError::Invalid);
    }
    let salt = bytes[8..24].to_vec();
    Ok(Vault {
        version: 1,
        kdf_salt: salt,
        items: Vec::new(),
        personal: PersonalInfo::default(),
        pinned: Vec::new(),
        icon_checked: std::collections::HashMap::new(),
    })
}



/// Open a vault with the master password, returning the vault and the key
/// set needed to save it again.
pub fn load_vault(account: &Account, password: &str) -> Result<(Vault, KeySet), StorageError> {
    let bytes = fs::read(vault_path(account))?;
    let version = read_version(&bytes)?;

    if version != VERSION {
        // v1/v2: the password-derived key encrypts the vault directly. Read
        // it, then hand back a fresh v3 key set so the next save upgrades the
        // file in place.
        let salt = bytes[8..HEADER_LEN].to_vec();
        let key = crate::crypto::derive_key(password, &salt);
        let nonce = &bytes[HEADER_LEN..HEADER_LEN + 12];
        let ct = &bytes[HEADER_LEN + 12..];
        let aad: &[u8] = if version == VERSION_DIRECT_KEY { &bytes[..HEADER_LEN] } else { b"" };
        let plaintext = decrypt_with_aad(&key, nonce, ct, aad)?;
        let vault = deserialize_vault(&plaintext)?;
        if vault.kdf_salt != salt {
            return Err(StorageError::Invalid);
        }
        let mut keys = KeySet::new(password);
        // Keep the salt the vault carries so kdf_salt stays meaningful.
        keys.master_salt = salt.clone();
        keys.master_kek = Some(crate::crypto::derive_key(password, &salt));
        return Ok((vault, keys));
    }

    let master_salt = bytes[8..V3_RECOVERY_SALT].to_vec();
    let master_kek = crate::crypto::derive_key(password, &master_salt);
    open_v3(&bytes, master_kek, WrapSlot::Master)
}

/// Open a vault with a recovery code's derived key instead of the password.
pub fn load_vault_with_recovery(
    account: &Account,
    recovery_secret: &[u8],
) -> Result<(Vault, KeySet), StorageError> {
    let bytes = fs::read(vault_path(account))?;
    if read_version(&bytes)? != VERSION || bytes[V3_FLAG] != 1 {
        return Err(StorageError::NoRecovery);
    }
    let recovery_salt = bytes[V3_RECOVERY_SALT..V3_FLAG].to_vec();
    let kek = crate::crypto::derive_key(&hex(recovery_secret), &recovery_salt);
    open_v3(&bytes, kek, WrapSlot::Recovery)
}

enum WrapSlot {
    Master,
    Recovery,
}

/// Recovery secrets are bytes, and the KDF takes a string; hex keeps the
/// mapping lossless and unambiguous.
pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn read_version(bytes: &[u8]) -> Result<u32, StorageError> {
    if bytes.len() < 4 + 4 + 16 + 12 || &bytes[0..4] != MAGIC {
        return Err(StorageError::Invalid);
    }
    let version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    if version != VERSION && version != VERSION_DIRECT_KEY && version != VERSION_LEGACY_NO_AAD {
        return Err(StorageError::Invalid);
    }
    if version == VERSION && bytes.len() < V3_VAULT_CT {
        return Err(StorageError::Invalid);
    }
    Ok(version)
}

fn open_v3(bytes: &[u8], kek: [u8; 32], slot: WrapSlot) -> Result<(Vault, KeySet), StorageError> {
    let master_salt = bytes[8..V3_RECOVERY_SALT].to_vec();
    let recovery_salt = bytes[V3_RECOVERY_SALT..V3_FLAG].to_vec();
    let (nonce, wrap, aad) = match slot {
        WrapSlot::Master => (
            &bytes[V3_MASTER_NONCE..V3_MASTER_WRAP],
            &bytes[V3_MASTER_WRAP..V3_MASTER_WRAP + WRAPPED_KEY_LEN],
            wrap_aad(&master_salt, SLOT_MASTER),
        ),
        WrapSlot::Recovery => (
            &bytes[V3_RECOVERY_NONCE..V3_RECOVERY_WRAP],
            &bytes[V3_RECOVERY_WRAP..V3_RECOVERY_WRAP + WRAPPED_KEY_LEN],
            wrap_aad(&recovery_salt, SLOT_RECOVERY),
        ),
    };
    let unwrapped = decrypt_with_aad(&kek, nonce, wrap, &aad)?;
    let mut data_key = [0u8; 32];
    if unwrapped.len() != 32 {
        return Err(StorageError::Invalid);
    }
    data_key.copy_from_slice(&unwrapped);

    let full_header = &bytes[..V3_VAULT_NONCE];
    let vault_nonce = &bytes[V3_VAULT_NONCE..V3_VAULT_CT];
    let ct = &bytes[V3_VAULT_CT..];
    let plaintext = decrypt_with_aad(&data_key, vault_nonce, ct, full_header)?;
    let vault = deserialize_vault(&plaintext)?;

    // The slot we did not open with is carried through sealed, so saving
    // keeps it working without ever knowing its key.
    let recovery = if bytes[V3_FLAG] == 1 {
        match slot {
            WrapSlot::Master => Some(RecoverySlot::Sealed {
                nonce: bytes[V3_RECOVERY_NONCE..V3_RECOVERY_WRAP].to_vec(),
                wrap: bytes[V3_RECOVERY_WRAP..V3_RECOVERY_WRAP + WRAPPED_KEY_LEN].to_vec(),
            }),
            WrapSlot::Recovery => Some(RecoverySlot::Kek(kek)),
        }
    } else {
        None
    };

    let keys = KeySet {
        data_key,
        master_salt,
        recovery_salt,
        recovery,
        master_kek: match slot {
            WrapSlot::Master => Some(kek),
            // Unknown until the caller sets a new password.
            WrapSlot::Recovery => None,
        },
    };
    Ok((vault, keys))
}

/// Whether the file has a recovery slot in use.
pub fn has_recovery_slot(account: &Account) -> bool {
    match fs::read(vault_path(account)) {
        Ok(bytes) => {
            read_version(&bytes).map(|v| v == VERSION).unwrap_or(false) && bytes[V3_FLAG] == 1
        }
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts::{create_account, Account};
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
        let keys = KeySet::new("master");
        let salt = keys.master_salt.clone();
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
        save_vault(&acct, &v, &keys).unwrap();
        assert!(vault_exists(&acct));
        let (v2, _) = load_vault(&acct, "master").unwrap();
        assert_eq!(v2.items.len(), 1);
    }

    #[test]
    fn export_vault_file_copies_bytes_exactly() {
        let _g = lock_env();
        fresh_tmp();
        let acct = fixture_account();
        let keys = KeySet::new("master");
        let salt = keys.master_salt.clone();
        let v = new_vault(salt);
        save_vault(&acct, &v, &keys).unwrap();

        let original = std::fs::read(vault_path(&acct)).unwrap();
        let dest = std::env::temp_dir().join(format!("export-test-{}.enc", uuid::Uuid::new_v4()));
        export_vault_file(&acct, &dest).unwrap();

        let exported = std::fs::read(&dest).unwrap();
        assert_eq!(exported, original);
        std::fs::remove_file(&dest).unwrap();
    }

    #[test]
    fn export_vault_file_to_itself_is_a_noop_not_a_wipe() {
        let _g = lock_env();
        fresh_tmp();
        let acct = fixture_account();
        let keys = KeySet::new("master");
        let salt = keys.master_salt.clone();
        let v = new_vault(salt);
        save_vault(&acct, &v, &keys).unwrap();

        let original = std::fs::read(vault_path(&acct)).unwrap();
        export_vault_file(&acct, &vault_path(&acct)).unwrap();
        let after = std::fs::read(vault_path(&acct)).unwrap();
        assert_eq!(after, original);
    }

    #[test]
    fn load_with_wrong_key_fails() {
        let _g = lock_env();
        fresh_tmp();
        let acct = fixture_account();
        let keys = KeySet::new("master");
        let salt = keys.master_salt.clone();
        let v = new_vault(salt);
        save_vault(&acct, &v, &keys).unwrap();
        assert!(load_vault(&acct, "wrong").is_err());
    }

    #[test]
    fn load_corrupt_file_fails() {
        let _g = lock_env();
        fresh_tmp();
        let acct = fixture_account();
        fs::create_dir_all(data_dir()).unwrap();
        fs::write(vault_path(&acct), b"corrupt data here").unwrap();
        assert!(load_vault(&acct, "master").is_err());
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
        let keys = KeySet::new("master");
        let salt = keys.master_salt.clone();
        let v = new_vault(salt);
        save_vault(&acct, &v, &keys).unwrap();
        let mut bytes = fs::read(vault_path(&acct)).unwrap();
        bytes[0] = b'X';
        fs::write(vault_path(&acct), &bytes).unwrap();
        assert!(load_vault(&acct, "master").is_err());
    }

    #[test]
    fn delete_vault_and_config_removes_both_files() {
        let _g = lock_env();
        fresh_tmp();
        let acct = fixture_account();
        let keys = KeySet::new("master");
        let salt = keys.master_salt.clone();
        let v = new_vault(salt);
        save_vault(&acct, &v, &keys).unwrap();
        crate::config::save(&acct, &crate::config::Config::default()).unwrap();
        assert!(vault_exists(&acct));
        assert!(config_path(&acct).exists());
        delete_vault_and_config(&acct).unwrap();
        assert!(!vault_exists(&acct));
        assert!(!config_path(&acct).exists());
    }

    /// Write a vault in the pre-key-wrapping v2 format, the way the shipped
    /// app did before recovery codes existed.
    fn write_v2_file(acct: &Account, password: &str, vault: &Vault) {
        let salt = vault.kdf_salt.clone();
        let key = crate::crypto::derive_key(password, &salt);
        let mut header = Vec::new();
        header.extend_from_slice(MAGIC);
        header.extend_from_slice(&VERSION_DIRECT_KEY.to_le_bytes());
        header.extend_from_slice(&salt);
        let plaintext = serialize_vault(vault).unwrap();
        let (nonce, ct) = crate::crypto::encrypt_with_aad(&key, &plaintext, &header);
        let mut blob = header;
        blob.extend_from_slice(&nonce);
        blob.extend_from_slice(&ct);
        fs::create_dir_all(data_dir()).unwrap();
        fs::write(vault_path(acct), blob).unwrap();
    }

    fn note_vault(salt: Vec<u8>, body: &str) -> Vault {
        let mut v = new_vault(salt);
        v.items.push(crate::vault::Item::Note {
            base: crate::vault::ItemBase {
                id: uuid::Uuid::new_v4(),
                title: "t".to_string(),
                notes: String::new(),
                created_at: 0,
                updated_at: 0,
                favicon: String::new(),
            },
            fields: crate::vault::NoteFields { body: body.to_string() },
        });
        v
    }

    #[test]
    fn a_v2_vault_still_opens_and_upgrades_on_the_next_save() {
        let _g = lock_env();
        fresh_tmp();
        let acct = fixture_account();
        let salt = crate::crypto::random_bytes(16);
        write_v2_file(&acct, "master", &note_vault(salt, "legacy secret"));

        let (v, keys) = load_vault(&acct, "master").unwrap();
        assert_eq!(v.items.len(), 1);
        // Still the old format until something writes.
        let before = fs::read(vault_path(&acct)).unwrap();
        assert_eq!(u32::from_le_bytes(before[4..8].try_into().unwrap()), VERSION_DIRECT_KEY);

        save_vault(&acct, &v, &keys).unwrap();
        let after = fs::read(vault_path(&acct)).unwrap();
        assert_eq!(u32::from_le_bytes(after[4..8].try_into().unwrap()), VERSION);
        let (again, _) = load_vault(&acct, "master").unwrap();
        assert_eq!(again.items.len(), 1);
    }

    #[test]
    fn a_recovery_code_opens_the_vault_and_the_password_still_works() {
        let _g = lock_env();
        fresh_tmp();
        let acct = fixture_account();
        let mut keys = KeySet::new("master");
        let v = note_vault(keys.master_salt.clone(), "hello");
        let secret = crate::recovery::generate().0;
        keys.set_recovery_secret(&secret);
        save_vault(&acct, &v, &keys).unwrap();

        assert!(has_recovery_slot(&acct));
        let (by_code, _) = load_vault_with_recovery(&acct, &secret).unwrap();
        assert_eq!(by_code.items.len(), 1);
        let (by_password, _) = load_vault(&acct, "master").unwrap();
        assert_eq!(by_password.items.len(), 1);
    }

    #[test]
    fn a_wrong_recovery_code_does_not_open_the_vault() {
        let _g = lock_env();
        fresh_tmp();
        let acct = fixture_account();
        let mut keys = KeySet::new("master");
        let v = new_vault(keys.master_salt.clone());
        keys.set_recovery_secret(&crate::recovery::generate().0);
        save_vault(&acct, &v, &keys).unwrap();

        let other = crate::recovery::generate().0;
        assert!(load_vault_with_recovery(&acct, &other).is_err());
    }

    #[test]
    fn recovery_is_refused_when_no_code_was_ever_set() {
        let _g = lock_env();
        fresh_tmp();
        let acct = fixture_account();
        let keys = KeySet::new("master");
        save_vault(&acct, &new_vault(keys.master_salt.clone()), &keys).unwrap();
        assert!(!has_recovery_slot(&acct));
        let secret = crate::recovery::generate().0;
        assert!(matches!(
            load_vault_with_recovery(&acct, &secret),
            Err(StorageError::NoRecovery)
        ));
    }

    #[test]
    fn changing_the_password_keeps_the_recovery_code_working() {
        let _g = lock_env();
        fresh_tmp();
        let acct = fixture_account();
        let mut keys = KeySet::new("old-master");
        let v = note_vault(keys.master_salt.clone(), "keep me");
        let secret = crate::recovery::generate().0;
        keys.set_recovery_secret(&secret);
        save_vault(&acct, &v, &keys).unwrap();

        // Reopen the way the command does, then rotate the password.
        let (v, mut keys) = load_vault(&acct, "old-master").unwrap();
        keys.set_master_password("new-master");
        save_vault(&acct, &v, &keys).unwrap();

        assert!(load_vault(&acct, "old-master").is_err());
        let (by_new, _) = load_vault(&acct, "new-master").unwrap();
        assert_eq!(by_new.items.len(), 1);
        let (by_code, _) = load_vault_with_recovery(&acct, &secret).unwrap();
        assert_eq!(by_code.items.len(), 1);
    }

    #[test]
    fn recovering_then_setting_a_password_leaves_both_keys_working() {
        let _g = lock_env();
        fresh_tmp();
        let acct = fixture_account();
        let mut keys = KeySet::new("forgotten");
        let v = note_vault(keys.master_salt.clone(), "still here");
        let secret = crate::recovery::generate().0;
        keys.set_recovery_secret(&secret);
        save_vault(&acct, &v, &keys).unwrap();

        let (v, mut keys) = load_vault_with_recovery(&acct, &secret).unwrap();
        // Opened by code, the master key is unknown — saving must refuse
        // rather than seal the vault under a placeholder.
        assert!(matches!(save_vault(&acct, &v, &keys), Err(StorageError::NoMasterKey)));

        keys.set_master_password("chosen-after-recovery");
        save_vault(&acct, &v, &keys).unwrap();
        assert!(load_vault(&acct, "forgotten").is_err());
        assert!(load_vault(&acct, "chosen-after-recovery").is_ok());
        assert!(load_vault_with_recovery(&acct, &secret).is_ok());
    }

    #[test]
    fn re_issuing_a_recovery_code_invalidates_the_old_one() {
        let _g = lock_env();
        fresh_tmp();
        let acct = fixture_account();
        let mut keys = KeySet::new("master");
        let v = new_vault(keys.master_salt.clone());
        let first = crate::recovery::generate().0;
        keys.set_recovery_secret(&first);
        save_vault(&acct, &v, &keys).unwrap();

        let (v, mut keys) = load_vault(&acct, "master").unwrap();
        let second = crate::recovery::generate().0;
        keys.set_recovery_secret(&second);
        save_vault(&acct, &v, &keys).unwrap();

        assert!(load_vault_with_recovery(&acct, &first).is_err());
        assert!(load_vault_with_recovery(&acct, &second).is_ok());
    }

    #[test]
    fn tampering_with_the_recovery_slot_breaks_the_file() {
        let _g = lock_env();
        fresh_tmp();
        let acct = fixture_account();
        let mut keys = KeySet::new("master");
        let v = note_vault(keys.master_salt.clone(), "x");
        keys.set_recovery_secret(&crate::recovery::generate().0);
        save_vault(&acct, &v, &keys).unwrap();

        let mut bytes = fs::read(vault_path(&acct)).unwrap();
        bytes[V3_RECOVERY_WRAP] ^= 0x01;
        fs::write(vault_path(&acct), &bytes).unwrap();
        // The vault ciphertext authenticates the whole header, so even the
        // password path notices the edit.
        assert!(load_vault(&acct, "master").is_err());
    }

    #[test]
    fn saving_keeps_a_rotating_local_backup() {
        let _g = lock_env();
        fresh_tmp();
        let acct = fixture_account();
        let keys = KeySet::new("master");
        let v = new_vault(keys.master_salt.clone());
        for _ in 0..3 {
            save_vault(&acct, &v, &keys).unwrap();
        }
        let copies = fs::read_dir(backups_dir()).unwrap().count();
        assert!(copies >= 1, "expected at least one backup copy");
        assert!(copies <= BACKUP_COPIES);
    }

    #[test]
    fn delete_when_nothing_to_delete_succeeds() {
        let _g = lock_env();
        fresh_tmp();
        let acct = fixture_account();
        delete_vault_and_config(&acct).unwrap();
    }
}

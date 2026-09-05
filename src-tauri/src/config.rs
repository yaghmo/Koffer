//! User-facing config (just autolock timeout in v1), per-account.

use crate::accounts::Account;
use crate::storage::config_path;
use serde::{Deserialize, Serialize};
use std::fs;
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub autolock_mins: u8,
}

impl Default for Config {
    fn default() -> Self {
        Self { autolock_mins: 15 }
    }
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serde error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("autolock value out of range: {0}")]
    OutOfRange(u8),
}

pub fn load(account: &Account) -> Config {
    let path = config_path(account);
    if !path.exists() {
        return Config::default();
    }
    match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Config::default(),
    }
}

pub fn save(account: &Account, c: &Config) -> Result<(), ConfigError> {
    if c.autolock_mins < 15 || c.autolock_mins > 30 {
        return Err(ConfigError::OutOfRange(c.autolock_mins));
    }
    if let Some(parent) = config_path(account).parent() {
        fs::create_dir_all(parent)?;
    }
    let s = serde_json::to_string_pretty(c)?;
    fs::write(config_path(account), s)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts::create_account;
    use crate::test_env::{lock_recover, override_data_dir_to_tmp};

    fn lock_env() -> std::sync::MutexGuard<'static, ()> {
        lock_recover(&crate::test_env::ENV_LOCK)
    }

    fn fresh_tmp() {
        override_data_dir_to_tmp("cfg");
    }

    fn fixture() -> Account {
        create_account("cfg-test").unwrap()
    }

    #[test]
    fn load_returns_default_when_no_file() {
        let _g = lock_env();
        fresh_tmp();
        let a = fixture();
        let c = load(&a);
        assert_eq!(c.autolock_mins, 15);
    }

    #[test]
    fn save_then_load_roundtrip() {
        let _g = lock_env();
        fresh_tmp();
        let a = fixture();
        let c = Config { autolock_mins: 25 };
        save(&a, &c).unwrap();
        let c2 = load(&a);
        assert_eq!(c2.autolock_mins, 25);
    }

    #[test]
    fn save_rejects_out_of_range() {
        let _g = lock_env();
        fresh_tmp();
        let a = fixture();
        assert!(save(&a, &Config { autolock_mins: 5 }).is_err());
        assert!(save(&a, &Config { autolock_mins: 60 }).is_err());
    }

    #[test]
    fn load_returns_default_when_corrupt() {
        let _g = lock_env();
        fresh_tmp();
        let a = fixture();
        if let Some(parent) = config_path(&a).parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(config_path(&a), "not json").unwrap();
        let c = load(&a);
        assert_eq!(c.autolock_mins, 15);
    }
}

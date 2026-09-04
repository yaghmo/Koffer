//! User-facing config (just autolock timeout in v1).

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

pub fn load() -> Config {
    let path = config_path();
    if !path.exists() {
        return Config::default();
    }
    match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Config::default(),
    }
}

pub fn save(c: &Config) -> Result<(), ConfigError> {
    if c.autolock_mins < 15 || c.autolock_mins > 30 {
        return Err(ConfigError::OutOfRange(c.autolock_mins));
    }
    if let Some(parent) = config_path().parent() {
        fs::create_dir_all(parent)?;
    }
    let s = serde_json::to_string_pretty(c)?;
    fs::write(config_path(), s)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // Serialize all config tests to avoid env races
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn override_data_dir_to_tmp() {
        let tmp = tempfile::tempdir().unwrap();
        // unique subdir per call so parallel test crates don't trample each other
        let unique = tmp.path().join(format!("cfg-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&unique).unwrap();
        unsafe {
            std::env::set_var("APPDATA", &unique);
            std::env::set_var("XDG_DATA_HOME", &unique);
            std::env::set_var("HOME", &unique);
        }
    }

    #[test]
    fn load_returns_default_when_no_file() {
        let _g = ENV_LOCK.lock().unwrap();
        override_data_dir_to_tmp();
        let c = load();
        assert_eq!(c.autolock_mins, 15);
    }

    #[test]
    fn save_then_load_roundtrip() {
        let _g = ENV_LOCK.lock().unwrap();
        override_data_dir_to_tmp();
        let c = Config { autolock_mins: 25 };
        save(&c).unwrap();
        let c2 = load();
        assert_eq!(c2.autolock_mins, 25);
    }

    #[test]
    fn save_rejects_out_of_range() {
        let _g = ENV_LOCK.lock().unwrap();
        override_data_dir_to_tmp();
        assert!(save(&Config { autolock_mins: 5 }).is_err());
        assert!(save(&Config { autolock_mins: 60 }).is_err());
    }

    #[test]
    fn load_returns_default_when_corrupt() {
        let _g = ENV_LOCK.lock().unwrap();
        override_data_dir_to_tmp();
        if let Some(parent) = config_path().parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(config_path(), "not json").unwrap();
        let c = load();
        assert_eq!(c.autolock_mins, 15);
    }
}

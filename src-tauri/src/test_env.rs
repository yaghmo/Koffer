//! Shared test environment. Tests across modules write the same `APPDATA`
//! env var to redirect the data dir; coordinate via a single lock so they
//! don't trample each other when `cargo test` runs in parallel.

use std::sync::Mutex;

pub static ENV_LOCK: Mutex<()> = Mutex::new(());
pub static TEMPDIRS: Mutex<Vec<tempfile::TempDir>> = Mutex::new(Vec::new());

/// Recover from a poisoned mutex; we don't care about the prior state
/// because each test sets its own env vars and temp dir.
pub fn lock_recover<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match m.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    }
}

/// Set `APPDATA` (and Linux equivalents) to a fresh per-test directory and
/// keep the `TempDir` alive until process exit so the path stays valid.
pub fn override_data_dir_to_tmp(prefix: &str) {
    let tmp = tempfile::tempdir().unwrap();
    let unique = tmp.path().join(format!("{}-{}", prefix, uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&unique).unwrap();
    unsafe {
        std::env::set_var("APPDATA", &unique);
        std::env::set_var("XDG_DATA_HOME", &unique);
        std::env::set_var("HOME", &unique);
    }
    lock_recover(&TEMPDIRS).push(tmp);
}

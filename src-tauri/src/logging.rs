//! Append-only local event log.
//!
//! One line per event, written next to the vault in the app data dir. This is
//! a debugging aid, so it records *what happened* — never the data itself.
//! Passwords, note bodies, card numbers, CVVs, master passwords and personal
//! field values must never reach these lines; item ids, kinds, counts and
//! error strings are what belong here.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

use crate::storage::data_dir;

/// Rotate at 2 MB, keeping one previous file. A password manager writes a few
/// dozen lines per session, so this holds months of history.
const MAX_BYTES: u64 = 2 * 1024 * 1024;

pub fn log_path() -> PathBuf {
    data_dir().join("app.log")
}

fn rotate_if_needed(path: &PathBuf) {
    if let Ok(meta) = fs::metadata(path) {
        if meta.len() > MAX_BYTES {
            let _ = fs::rename(path, path.with_extension("log.1"));
        }
    }
}

/// Write one line. Never panics and never fails a command: a vault operation
/// must not break because the log file is read-only or the disk is full.
pub fn write(level: &str, scope: &str, msg: &str) {
    let path = log_path();
    if let Some(parent) = path.parent() {
        let _ = crate::storage::private_dir(parent);
    }
    rotate_if_needed(&path);
    let line = format!(
        "{} {:<5} {:<20} {}\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
        level,
        scope,
        msg
    );
    let is_new = !path.exists();
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        // The log names item ids and paired browsers; not for other accounts.
        if is_new {
            crate::storage::restrict_file(&path);
        }
        let _ = f.write_all(line.as_bytes());
    }
}

#[macro_export]
macro_rules! log_info {
    ($scope:expr, $($arg:tt)*) => {
        $crate::logging::write("INFO", $scope, &format!($($arg)*))
    };
}

#[macro_export]
macro_rules! log_warn {
    ($scope:expr, $($arg:tt)*) => {
        $crate::logging::write("WARN", $scope, &format!($($arg)*))
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_env::{lock_recover, override_data_dir_to_tmp, ENV_LOCK};

    #[test]
    fn write_appends_a_line_without_panicking() {
        let _g = lock_recover(&ENV_LOCK);
        override_data_dir_to_tmp("log");
        write("INFO", "test", "hello id=1");
        let body = fs::read_to_string(log_path()).unwrap();
        assert!(body.contains("hello id=1"));
        assert!(body.contains("INFO"));
    }

    #[test]
    fn rotates_once_past_the_size_cap() {
        let _g = lock_recover(&ENV_LOCK);
        override_data_dir_to_tmp("logrot");
        let path = log_path();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, vec![b'x'; (MAX_BYTES + 1) as usize]).unwrap();
        write("INFO", "test", "after rotate");
        assert!(path.with_extension("log.1").exists());
        let body = fs::read_to_string(&path).unwrap();
        assert!(body.contains("after rotate"));
        assert!(!body.contains("xxxx"));
    }
}

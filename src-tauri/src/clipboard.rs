//! Clipboard with auto-clear.

use std::thread;
use std::time::Duration;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ClipboardError {
    #[error("clipboard error: {0}")]
    Backend(String),
}

// ponytail: Windows clipboard history/cloud sync are separate stores from the
// live clipboard. Marking the write as excluded stops the password from
// landing in Win+V history or syncing to other devices; the TTL clear below
// only ever affected the live clipboard, not history.
#[cfg(windows)]
fn set_text_excluding_history(text: &str) -> Result<(), ClipboardError> {
    use clipboard_win::{options::DoClear, raw};

    raw::open().map_err(|e| ClipboardError::Backend(e.to_string()))?;
    let result = raw::set_string_with(text, DoClear)
        .map_err(|e| ClipboardError::Backend(e.to_string()))
        .map(|_| {
            for name in ["CanIncludeInClipboardHistory", "CanUploadToCloudClipboard"] {
                if let Some(fmt) = raw::register_format(name) {
                    let _ = raw::set_without_clear(fmt.get(), &0u32.to_ne_bytes());
                }
            }
        });
    let _ = raw::close();
    result
}

#[cfg(not(windows))]
fn set_text_excluding_history(text: &str) -> Result<(), ClipboardError> {
    let mut cb = arboard::Clipboard::new().map_err(|e| ClipboardError::Backend(e.to_string()))?;
    cb.set_text(text.to_string())
        .map_err(|e| ClipboardError::Backend(e.to_string()))
}

pub fn copy_with_ttl(text: &str, ttl: Duration) -> Result<(), ClipboardError> {
    set_text_excluding_history(text)?;
    thread::spawn(move || {
        thread::sleep(ttl);
        if let Ok(mut cb) = arboard::Clipboard::new() {
            // Best-effort clear; ignore failure (something else may have overwritten)
            let _ = cb.set_text(String::new());
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_short_text_succeeds() {
        // This test requires a clipboard backend; on Windows in CI it should pass.
        // Skip on environments without one.
        if std::env::var("CI").is_ok() && cfg!(target_os = "linux") {
            return;
        }
        let res = copy_with_ttl("test", Duration::from_millis(100));
        assert!(res.is_ok());
    }
}

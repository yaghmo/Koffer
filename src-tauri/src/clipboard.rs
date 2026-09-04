//! Clipboard with auto-clear.

use std::thread;
use std::time::Duration;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ClipboardError {
    #[error("clipboard error: {0}")]
    Backend(String),
}

pub fn copy_with_ttl(text: &str, ttl: Duration) -> Result<(), ClipboardError> {
    let mut cb = arboard::Clipboard::new()
        .map_err(|e| ClipboardError::Backend(e.to_string()))?;
    cb.set_text(text.to_string())
        .map_err(|e| ClipboardError::Backend(e.to_string()))?;
    let text_owned = text.to_string();
    thread::spawn(move || {
        thread::sleep(ttl);
        if let Ok(mut cb) = arboard::Clipboard::new() {
            // Best-effort clear; ignore failure (something else may have overwritten)
            let _ = cb.set_text(String::new());
            // We can't reliably read back on Windows without focus,
            // but empty-string write is the standard "clear" pattern.
            drop(text_owned);
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

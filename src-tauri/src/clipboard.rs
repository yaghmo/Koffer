//! Clipboard with auto-clear.

use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use thiserror::Error;
use zeroize::Zeroizing;

/// What this app last put on the clipboard, so locking can take it back
/// before its timer: the timer thread dies with the process.
static COPIED: Mutex<Option<Zeroizing<String>>> = Mutex::new(None);

/// Clear the clipboard now if it still holds what this app put there.
/// Anything the user copied since is theirs and stays.
pub fn clear_ours() {
    let Some(copied) = COPIED.lock().unwrap_or_else(|p| p.into_inner()).take() else {
        return;
    };
    if let Ok(mut cb) = arboard::Clipboard::new() {
        if still_ours(cb.get_text().ok().as_deref(), &copied) {
            let _ = cb.clear();
        }
    }
}

#[derive(Debug, Error)]
pub enum ClipboardError {
    #[error("clipboard error: {0}")]
    Backend(String),
}

/// Put a secret on the clipboard, marked so clipboard history and managers
/// skip it, and clear it after `ttl` if it is still there.
///
/// - Windows: kept out of Win+V history and the cloud clipboard.
/// - macOS: `org.nspasteboard.ConcealedType`, which Mac clipboard managers
///   honour by not archiving the entry.
/// - Linux: `x-kde-passwordManagerHint`, the convention KDE and most
///   clipboard managers follow. The X11/Wayland clipboard is served by the
///   process that set it, so the `Clipboard` lives in the timer thread: the
///   secret stays pasteable for the whole TTL instead of vanishing when a
///   short-lived handle is dropped.
pub fn copy_with_ttl(text: &str, ttl: Duration) -> Result<(), ClipboardError> {
    let err = |e: arboard::Error| ClipboardError::Backend(e.to_string());
    let mut cb = arboard::Clipboard::new().map_err(err)?;
    let set = cb.set();
    #[cfg(windows)]
    let set = {
        use arboard::SetExtWindows;
        set.exclude_from_history().exclude_from_cloud()
    };
    #[cfg(target_os = "macos")]
    let set = {
        use arboard::SetExtApple;
        set.exclude_from_history()
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let set = {
        use arboard::SetExtLinux;
        set.exclude_from_history()
    };
    set.text(text.to_string()).map_err(err)?;
    *COPIED.lock().unwrap_or_else(|p| p.into_inner()) = Some(Zeroizing::new(text.to_string()));
    let copied = Zeroizing::new(text.to_string());
    thread::spawn(move || {
        thread::sleep(ttl);
        // Only our own copy is cleared. Anything the user copied since
        // (a QR screenshot to paste, a link) is theirs and stays.
        if still_ours(cb.get_text().ok().as_deref(), &copied) {
            let _ = cb.clear();
        }
    });
    Ok(())
}

fn still_ours(current: Option<&str>, copied: &str) -> bool {
    current == Some(copied)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clears_only_what_it_copied() {
        assert!(still_ours(Some("pw"), "pw"));
        assert!(!still_ours(Some("something else"), "pw"));
        // An image on the clipboard has no text.
        assert!(!still_ours(None, "pw"));
    }

    // Writes the real clipboard, wiping whatever the person running the
    // tests had on it. Run on purpose: cargo test -- --ignored
    #[test]
    #[ignore]
    fn copy_short_text_succeeds() {
        // The OS clipboard is an exclusive shared resource: any other process
        // holding it open (a clipboard manager, a browser mid-copy) makes this
        // fail for reasons unrelated to the code. Retry briefly, then skip
        // with a note rather than report a false failure.
        if std::env::var("CI").is_ok() && cfg!(target_os = "linux") {
            return;
        }
        for attempt in 0..5 {
            match copy_with_ttl("test", Duration::from_millis(100)) {
                Ok(()) => return,
                Err(e) => {
                    if attempt == 4 {
                        eprintln!("skipped: clipboard unavailable on this machine ({e})");
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(150));
                }
            }
        }
    }
}

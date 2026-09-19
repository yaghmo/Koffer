//! System tray: keeps the app alive with the window closed.
//!
//! Closing the window hides it rather than quitting, so the vault stays
//! reachable in the background and the idle watchdog keeps running. Only the
//! tray's "Exit app" really quits.
//!
//! The icon doubles as a lock indicator, because an app that lives in the
//! tray needs to answer "is my vault open right now?" without opening a
//! window to find out.

use crate::commands::AppState;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Wry,
};

pub const TRAY_ID: &str = "main";

/// Menu items that change with the lock state, kept so `sync` can reach them.
struct TrayMenu {
    lock: MenuItem<Wry>,
}

const UNLOCKED_TIP: &str = "Password Manager — unlocked";
const LOCKED_TIP: &str = "Password Manager — locked";

/// Grey out and fade an icon to mark the locked state.
///
/// Derived at runtime from the one app icon rather than shipping a second
/// asset, so the two can never drift apart when the logo changes.
fn locked_variant(src: &Image<'_>) -> Image<'static> {
    let mut rgba = src.rgba().to_vec();
    for px in rgba.chunks_exact_mut(4) {
        // Rec. 601 luma: a flat average turns the brand colours to mud.
        let luma = (px[0] as u32 * 299 + px[1] as u32 * 587 + px[2] as u32 * 114) / 1000;
        let luma = luma.min(255) as u8;
        px[0] = luma;
        px[1] = luma;
        px[2] = luma;
        px[3] = ((px[3] as u32 * 60) / 100) as u8;
    }
    Image::new_owned(rgba, src.width(), src.height())
}

fn icons(app: &AppHandle) -> tauri::Result<(Image<'static>, Image<'static>)> {
    let src = app
        .default_window_icon()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;
    // Copied rather than cloned: the borrowed icon is tied to the app handle,
    // and the tray needs one that outlives this call.
    let unlocked = Image::new_owned(src.rgba().to_vec(), src.width(), src.height());
    let locked = locked_variant(src);
    Ok((unlocked, locked))
}

/// Show and focus the main window, restoring it if it was minimized.
pub fn reveal(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Point the tray icon and tooltip at the current lock state.
///
/// Cheap and idempotent, so callers fire it whenever the state might have
/// moved rather than tracking transitions.
pub fn sync(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let unlocked = app.state::<AppState>().is_unlocked();
    let Ok((open_icon, shut_icon)) = icons(app) else {
        return;
    };
    let _ = tray.set_icon(Some(if unlocked { open_icon } else { shut_icon }));
    let _ = tray.set_tooltip(Some(if unlocked { UNLOCKED_TIP } else { LOCKED_TIP }));
    // Nothing to lock when it is already locked, and a live menu entry that
    // does nothing reads as a broken one.
    if let Some(menu) = app.try_state::<TrayMenu>() {
        let _ = menu.lock.set_enabled(unlocked);
    }
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let start_unlocked = app.state::<AppState>().is_unlocked();

    let open = MenuItem::with_id(app, "tray_open", "Open", true, None::<&str>)?;
    let lock = MenuItem::with_id(app, "tray_lock", "Lock now", start_unlocked, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray_quit", "Exit app", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &lock, &sep, &quit])?;
    app.manage(TrayMenu { lock: lock.clone() });

    let (unlocked_icon, locked_icon) = icons(app)?;

    TrayIconBuilder::<Wry>::with_id(TRAY_ID)
        .icon(if start_unlocked { unlocked_icon } else { locked_icon })
        .tooltip(if start_unlocked { UNLOCKED_TIP } else { LOCKED_TIP })
        .menu(&menu)
        // The menu is the right-click surface only, or a left-click would open
        // the menu instead of the window.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray_open" => reveal(app),
            // Guarded as well as disabled: the item is greyed out when locked,
            // but the menu's enabled state is only as fresh as the last sync.
            "tray_lock" if app.state::<AppState>().is_unlocked() => {
                app.state::<AppState>().lock_and_backup();
                let _ = app.emit("vault://locked", ());
                crate::log_info!("tray", "locked from tray");
                sync(app);
            }
            "tray_quit" => {
                // Wipe before leaving: quitting must not be a slower way of
                // leaving keys in memory than locking.
                app.state::<AppState>().lock_and_backup();
                crate::log_info!("tray", "exit requested from tray");
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn img(px: Vec<u8>) -> Image<'static> {
        Image::new_owned(px, 1, 1)
    }

    #[test]
    fn locked_variant_greys_and_fades() {
        // Opaque red -> grey, and noticeably more transparent.
        let out = locked_variant(&img(vec![255, 0, 0, 255]));
        let px = out.rgba();
        assert_eq!(px[0], px[1], "red and green must match after greying");
        assert_eq!(px[1], px[2], "green and blue must match after greying");
        assert!(px[3] < 255, "locked icon must be faded");
        assert!(px[3] > 0, "locked icon must stay visible");
    }

    #[test]
    fn locked_variant_keeps_transparent_pixels_transparent() {
        // A fully transparent pixel must not become a visible grey block.
        let out = locked_variant(&img(vec![0, 0, 0, 0]));
        assert_eq!(out.rgba()[3], 0);
    }

    #[test]
    fn locked_variant_preserves_dimensions() {
        let src = Image::new_owned(vec![9; 4 * 4], 2, 2);
        let out = locked_variant(&src);
        assert_eq!((out.width(), out.height()), (2, 2));
        assert_eq!(out.rgba().len(), 16);
    }
}

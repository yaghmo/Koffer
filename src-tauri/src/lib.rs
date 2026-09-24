pub mod accounts;
pub mod autolock;
pub mod bridge;
pub mod clipboard;
pub mod cloud;
pub mod commands;
pub mod config;
pub mod crypto;
pub mod logging;
pub mod metadata;
pub mod password;
pub mod recovery;
pub mod storage;
pub mod totp;
pub mod tray;
pub mod vault;

#[cfg(test)]
mod test_env;

use commands::AppState;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .manage(bridge::Bridge::default())
        .setup(|app| {
            crate::log_info!("app", "started version={}", env!("CARGO_PKG_VERSION"));
            tray::build(app.handle())?;
            // Loopback only, and useless until the user pairs an extension
            // by hand: see the module docs for why that ordering matters.
            bridge::start(app.handle());
            // Idle watchdog: AutoLock only measures idle time; this enforces it.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(10));
                if handle.state::<AppState>().autolock_if_idle() {
                    let _ = handle.emit("vault://locked", ());
                    // The window may be hidden, so the tray icon is the only
                    // place an auto-lock becomes visible.
                    tray::sync(&handle);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing hides: the vault stays reachable in the background and
            // the idle watchdog keeps running. Only the tray's "Exit app"
            // actually quits.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_accounts,
            commands::setup_vault,
            commands::unlock_vault,
            commands::lock_vault,
            commands::is_unlocked,
            commands::autolock_status,
            commands::list_items,
            commands::vault_stats,
            commands::get_item,
            commands::save_item,
            commands::delete_item,
            commands::set_item_favicon,
            commands::set_item_pinned,
            commands::generate_password,
            commands::copy_to_clipboard,
            commands::totp_code,
            commands::totp_from_clipboard,
            commands::get_config,
            commands::set_autolock_mins,
            commands::set_auto_refresh_icons,
            commands::reset_activity,
            commands::log_event,
            commands::vault_storage,
            commands::reset_vault,
            commands::security_state,
            commands::create_recovery_code,
            commands::save_recovery_code,
            commands::recover_vault,
            commands::change_master_password,
            commands::export_vault,
            commands::import_vault,
            commands::get_backup_config,
            commands::set_backup_config,
            commands::clear_backup_config,
            commands::backup_now,
            commands::restore_from_cloud,
            commands::fetch_url_metadata,
            commands::open_login_url,
            commands::get_personal_info,
            commands::save_personal_info,
            commands::bridge_pair_code,
            commands::bridge_cancel_pairing,
            commands::bridge_state,
            commands::bridge_unpair,
            commands::bridge_approve,
            commands::bridge_revoke_host,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, event| {
            // Hiding the last window would otherwise end the process. An
            // explicit `app.exit(code)` carries a code and is allowed through;
            // everything else is the window merely closing, so it is refused.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}

pub use autolock::AutoLock;
pub use config::{Config, ConfigError};
pub use crypto::{derive_key, encrypt, decrypt, random_bytes, CryptoError};
pub use password::{generate, GenError, GenOpts};
pub use storage::{load_vault, load_vault_unverified, save_vault, KeySet};
pub use vault::{
    add_item, compute_stats, delete_item, deserialize_vault, get_item, is_pinned, list_items,
    new_vault, set_pinned,
    serialize_vault, update_item, FlaggedItem, Item, ItemBase, LoginFields, NoteFields, CardFields,
    PersonalInfo, Vault, VaultError, VaultStats,
};

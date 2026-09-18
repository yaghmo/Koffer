pub mod accounts;
pub mod autolock;
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
        .setup(|app| {
            crate::log_info!("app", "started version={}", env!("CARGO_PKG_VERSION"));
            // Idle watchdog: AutoLock only measures idle time; this enforces it.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(10));
                if handle.state::<AppState>().autolock_if_idle() {
                    let _ = handle.emit("vault://locked", ());
                }
            });
            Ok(())
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
            commands::get_config,
            commands::set_autolock_mins,
            commands::reset_activity,
            commands::log_event,
            commands::vault_storage,
            commands::reset_vault,
            commands::security_state,
            commands::create_recovery_code,
            commands::recover_vault,
            commands::change_master_password,
            commands::export_vault,
            commands::import_vault,
            commands::fetch_url_metadata,
            commands::open_login_url,
            commands::get_personal_info,
            commands::save_personal_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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

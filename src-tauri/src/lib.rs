pub mod autolock;
pub mod clipboard;
pub mod commands;
pub mod config;
pub mod crypto;
pub mod password;
pub mod storage;
pub mod vault;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::vault_exists,
            commands::setup_vault,
            commands::unlock_vault,
            commands::lock_vault,
            commands::is_unlocked,
            commands::list_items,
            commands::get_item,
            commands::save_item,
            commands::delete_item,
            commands::generate_password,
            commands::copy_to_clipboard,
            commands::get_config,
            commands::set_autolock_mins,
            commands::reset_activity,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub use autolock::AutoLock;
pub use config::{Config, ConfigError};
pub use crypto::{derive_key, encrypt, decrypt, random_bytes, CryptoError};
pub use password::{generate, GenError, GenOpts};
pub use storage::{
    load_vault, load_vault_unverified, load_vault_with_key, save_vault, vault_exists,
};
pub use vault::{
    add_item, delete_item, deserialize_vault, get_item, list_items, new_vault, serialize_vault,
    update_item, Item, ItemBase, LoginFields, NoteFields, CardFields, Vault, VaultError,
};

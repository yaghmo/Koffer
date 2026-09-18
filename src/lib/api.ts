import { invoke } from "@tauri-apps/api/core";
import type { Account, Config, GenOpts, Item, ItemKind, ItemMeta, PersonalInfo, SecurityState, UrlMetadata, VaultStats, VaultStorage } from "./types";

export const api = {
  listAccounts: () => invoke<Account[]>("list_accounts"),

  setupVault: (password: string, name: string) =>
    invoke<Account>("setup_vault", { password, name }),

  unlockVault: (password: string, accountId: string) =>
    invoke<void>("unlock_vault", { password, accountId }),

  lockVault: () => invoke<void>("lock_vault"),
  isUnlocked: () => invoke<boolean>("is_unlocked"),
  autolockStatus: () =>
    invoke<{ locked: boolean; remaining_secs: number; timeout_secs: number }>("autolock_status"),

  listItems: (query?: string, kind?: ItemKind) =>
    invoke<ItemMeta[]>("list_items", { query: query ?? null, kind: kind ?? null }),

  vaultStats: () => invoke<VaultStats>("vault_stats"),

  getItem: (id: string) => invoke<Item>("get_item", { id }),
  saveItem: (item: Item) => invoke<void>("save_item", { item }),
  deleteItem: (id: string) => invoke<void>("delete_item", { id }),
  /** `favicon: null` records "checked, nothing new" without a write. */
  setItemFavicon: (id: string, favicon: string | null) =>
    invoke<void>("set_item_favicon", { id, favicon }),
  setItemPinned: (id: string, pinned: boolean) =>
    invoke<void>("set_item_pinned", { id, pinned }),

  generatePassword: (opts: GenOpts) => invoke<string>("generate_password", { opts }),

  copyToClipboard: (text: string, ttlSecs?: number) =>
    invoke<void>("copy_to_clipboard", { text, ttlSecs: ttlSecs ?? null }),

  getConfig: () => invoke<Config>("get_config"),
  setAutolockMins: (mins: number) => invoke<void>("set_autolock_mins", { mins }),

  vaultStorage: () => invoke<VaultStorage>("vault_storage"),

  resetActivity: () => invoke<void>("reset_activity"),

  logEvent: (level: "info" | "warn", scope: string, message: string) =>
    invoke<void>("log_event", { level, scope, message }),
  resetVault: (password: string, accountId: string) =>
    invoke<void>("reset_vault", { password, accountId }),

  securityState: () => invoke<SecurityState>("security_state"),
  /** Returns the code, formatted in groups. Shown once and never stored. */
  createRecoveryCode: (password: string) =>
    invoke<string>("create_recovery_code", { password }),
  recoverVault: (code: string, newPassword: string, accountId: string) =>
    invoke<void>("recover_vault", { code, newPassword, accountId }),
  changeMasterPassword: (current: string, newPassword: string) =>
    invoke<void>("change_master_password", { current, newPassword }),

  exportVault: (dest: string) => invoke<void>("export_vault", { dest }),
  importVault: (src: string, name: string) =>
    invoke<Account>("import_vault", { src, name }),

  fetchUrlMetadata: (url: string) =>
    invoke<UrlMetadata>("fetch_url_metadata", { url }),

  openLoginItem: (id: string) => invoke<void>("open_login_url", { id }),

  getPersonalInfo: () => invoke<PersonalInfo>("get_personal_info"),
  savePersonalInfo: (info: PersonalInfo) =>
    invoke<void>("save_personal_info", { info }),
};

import { invoke } from "@tauri-apps/api/core";
import type { Account, BackupState, BrowserPref, LeakedLogin, BridgeState, Config, GenOpts, Item, ItemKind, ItemMeta, PersonalInfo, SecurityState, TotpCode, UrlMetadata, VaultStats, VaultStorage } from "./types";

export const api = {
  listAccounts: () => invoke<Account[]>("list_accounts"),

  setupVault: (password: string, name: string) =>
    invoke<Account>("setup_vault", { password, name }),

  unlockVault: (password: string, accountId: string) =>
    invoke<void>("unlock_vault", { password, accountId }),

  lockVault: () => invoke<void>("lock_vault"),
  unlockedAccount: () => invoke<Account | null>("unlocked_account"),
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

  totpCode: (id: string) => invoke<TotpCode>("totp_code", { id }),
  /** The 2FA link inside a QR code screenshotted to the clipboard. */
  totpFromClipboard: () => invoke<string>("totp_from_clipboard"),
  /** Check a 2FA key or link; the answer is it drawn as a QR code (SVG). */
  totpCheck: (key: string) => invoke<string>("totp_check", { key }),

  useLastSeen: (id: string) => invoke<void>("use_last_seen", { id }),
  dismissLastSeen: (id: string) => invoke<void>("dismiss_last_seen", { id }),
  restorePreviousPassword: (id: string, index: number) =>
    invoke<void>("restore_previous_password", { id, index }),
  listNeverSave: () => invoke<string[]>("list_never_save"),
  removeNeverSave: (host: string) => invoke<void>("remove_never_save", { host }),

  getConfig: () => invoke<Config>("get_config"),
  setAutolockMins: (mins: number) => invoke<void>("set_autolock_mins", { mins }),
  setAutoRefreshIcons: (on: boolean) => invoke<void>("set_auto_refresh_icons", { on }),
  setBrowserPref: (name: BrowserPref, on: boolean) => invoke<void>("set_browser_pref", { name, on }),
  // `what` comes back as the request named it: an Allow covers that one
  // action, so allowing a fill cannot be spent on a write.
  bridgeConfirmFill: (origin: string, id: string, host: string, what: string) =>
    invoke<void>("bridge_confirm_fill", { origin, id, host, what }),
  checkLeakedPasswords: () => invoke<LeakedLogin[]>("check_leaked_passwords"),

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
    // A new recovery code when the vault had one: the old one stops working.
    invoke<string | null>("change_master_password", { current, newPassword }),

  exportVault: (dest: string) => invoke<void>("export_vault", { dest }),
  saveRecoveryCode: (dest: string, code: string) => invoke<void>("save_recovery_code", { dest, code }),
  importVault: (src: string, name: string) =>
    invoke<Account>("import_vault", { src, name }),

  getBackupConfig: () => invoke<BackupState>("get_backup_config"),
  /** The PUT token is write-only from the UI's side: it goes down, never back
   * up. Omit it (or pass an empty string) to change only the URL and keep
   * the token already stored — that only works when a config already exists. */
  setBackupConfig: (url: string, putToken?: string) =>
    invoke<void>("set_backup_config", { url, putToken: putToken || null }),
  clearBackupConfig: () => invoke<void>("clear_backup_config"),
  backupNow: () => invoke<void>("backup_now"),
  restoreFromCloud: (url: string, getToken: string, name: string) =>
    invoke<Account>("restore_from_cloud", { url, getToken, name }),

  fetchUrlMetadata: (url: string) =>
    invoke<UrlMetadata>("fetch_url_metadata", { url }),

  /** The newer version's number, or null. A dev build never asks. */
  checkUpdate: () => invoke<string | null>("check_update"),
  /** Settles only when it fails: on success the app is replaced and restarts. */
  installUpdate: () => invoke<void>("install_update"),

  openLoginItem: (id: string) => invoke<void>("open_login_url", { id }),

  bridgeState: () => invoke<BridgeState>("bridge_state"),
  /** Returns the code to type into the extension. Shown once, good for
   * three minutes, and burnt after three wrong guesses. */
  bridgePairCode: () => invoke<string>("bridge_pair_code"),
  bridgeCancelPairing: () => invoke<void>("bridge_cancel_pairing"),
  bridgeUnpair: (origin: string) => invoke<void>("bridge_unpair", { origin }),
  /** Let one paired browser be handed passwords for one site. */
  bridgeApprove: (origin: string, host: string) =>
    invoke<void>("bridge_approve", { origin, host }),
  bridgeRevokeHost: (origin: string, host: string) =>
    invoke<void>("bridge_revoke_host", { origin, host }),

  getPersonalInfo: () => invoke<PersonalInfo>("get_personal_info"),
  savePersonalInfo: (info: PersonalInfo) =>
    invoke<void>("save_personal_info", { info }),
};

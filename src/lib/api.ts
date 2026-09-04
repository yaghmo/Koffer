import { invoke } from "@tauri-apps/api/core";
import type { Config, GenOpts, Item, ItemKind, ItemMeta } from "./types";

export const api = {
  vaultExists: () => invoke<boolean>("vault_exists"),
  setupVault: (password: string) => invoke<void>("setup_vault", { password }),
  unlockVault: (password: string) => invoke<void>("unlock_vault", { password }),
  lockVault: () => invoke<void>("lock_vault"),
  isUnlocked: () => invoke<boolean>("is_unlocked"),

  listItems: (query?: string, kind?: ItemKind) =>
    invoke<ItemMeta[]>("list_items", { query: query ?? null, kind: kind ?? null }),

  getItem: (id: string) => invoke<Item>("get_item", { id }),
  saveItem: (item: Item) => invoke<void>("save_item", { item }),
  deleteItem: (id: string) => invoke<void>("delete_item", { id }),

  generatePassword: (opts: GenOpts) => invoke<string>("generate_password", { opts }),

  copyToClipboard: (text: string, ttlSecs?: number) =>
    invoke<void>("copy_to_clipboard", { text, ttlSecs: ttlSecs ?? null }),

  getConfig: () => invoke<Config>("get_config"),
  setAutolockMins: (mins: number) => invoke<void>("set_autolock_mins", { mins }),

  resetActivity: () => invoke<void>("reset_activity"),
};

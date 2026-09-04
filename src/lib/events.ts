import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function onVaultLocked(handler: () => void): Promise<UnlistenFn> {
  return listen<void>("vault://locked", () => handler());
}

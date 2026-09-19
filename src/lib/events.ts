import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function onVaultLocked(handler: () => void): Promise<UnlistenFn> {
  return listen<void>("vault://locked", () => handler());
}

/**
 * The bridge filled a login with the idle timer nearly up. Only a person at
 * the app may extend the session — a fill on its own does not, or anything
 * holding a pairing token could keep the vault open forever.
 */
export function onExtendRequest(handler: (remainingSecs: number) => void): Promise<UnlistenFn> {
  return listen<number>("vault://extend-request", (e) => handler(e.payload));
}

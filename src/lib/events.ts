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

/** A paired browser asking about a host it has never been approved for. */
export interface ApproveRequest {
  /** What the browser calls itself, e.g. "Chrome". */
  label: string;
  /** `chrome-extension://<id>` — which paired client is asking. */
  origin: string;
  /** The site it wants a password for, e.g. "github.com". */
  host: string;
}

/**
 * The bridge refused a handout and wants a human to say yes.
 *
 * Refused already, in Rust, before this fires. Answering only decides
 * whether the *next* call succeeds, which is what keeps a pairing token from
 * being able to approve itself.
 */
export function onApproveRequest(
  handler: (req: ApproveRequest) => void
): Promise<UnlistenFn> {
  return listen<ApproveRequest>("vault://approve-request", (e) => handler(e.payload));
}

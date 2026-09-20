/**
 * vault.js — the only place that talks to the desktop app.
 *
 * The app listens on 127.0.0.1 and answers nothing useful until this
 * extension has been paired by hand: the app shows an 8-character code, the
 * user types it in here once, and the app hands back a token that it keeps
 * inside the encrypted vault. Nothing else on the machine can read a code
 * off the user's screen, which is what keeps the port from being an open
 * door to every local process.
 *
 * The token is stored per-browser-profile in chrome.storage.local. Losing it
 * (or the user unpairing from the app) just means pairing again.
 *
 * It does not stay the same token. Any reply may carry a replacement, and
 * `post` swaps it in before the caller sees the body: the app rotates on its
 * own schedule and this side just keeps whatever it is handed. That is what
 * makes a token copied out of storage.local go stale -- so the token must be
 * written before anything else can fail, and every call has to go through
 * `post` for it to happen at all.
 *
 * This file never decides what may be filled. It passes the origin it is
 * acting for and the app does the filtering, so a bug up here cannot turn
 * into one site's password being handed to another.
 */

/** Firefox exposes the promise-based API as `browser`; Chrome as `chrome`. */
const ext = globalThis.browser ?? globalThis.chrome;

const PORT = 38471;
const BASE = `http://127.0.0.1:${PORT}`;
const HOST_PERMISSION = "http://127.0.0.1/*";
const TOKEN_KEY = "vaultToken";

/**
 * The app would not answer: the vault is locked, or this browser is no
 * longer paired. Deliberately one error for both.
 *
 * The bridge returns the same 401 either way, because a locked vault cannot
 * read its own token list and so genuinely cannot tell the two apart. An
 * answer that distinguished them would let any program on the machine poll
 * the port and watch for the moment the vault opened.
 */
export const NOT_PAIRED = "not-paired";
export const NO_APP = "no-app";
/** This site has not been approved for this browser yet. */
export const NEEDS_APPROVAL = "needs-approval";

async function storedToken() {
  const got = await ext.storage.local.get(TOKEN_KEY);
  return got[TOKEN_KEY] || null;
}

async function forgetToken() {
  await ext.storage.local.remove(TOKEN_KEY);
}

/** Has this browser ever been paired? Not whether the token still works. */
export async function isPaired() {
  return (await storedToken()) !== null;
}

/**
 * Make sure we may actually reach the loopback port.
 *
 * Chrome grants a declared `host_permissions` entry at install time. Firefox
 * treats the same entry as optional and blocks the fetch until the user says
 * yes, so pairing has to ask — from a click, which is the only place the
 * prompt is allowed.
 */
export async function ensureHostPermission() {
  try {
    if (await ext.permissions.contains({ origins: [HOST_PERMISSION] })) return;
    await ext.permissions.request({ origins: [HOST_PERMISSION] });
  } catch {
    // No permissions API, or the browser refused to be asked. Let the fetch
    // itself be the thing that reports a real failure.
  }
}

async function post(path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(BASE + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body || {}),
    });
  } catch {
    // Nothing listening: the app is closed, or it could not take the port.
    throw new Error(NO_APP);
  }

  const data = await res.json().catch(() => ({}));
  // A rotated token rides back on whatever call was being made anyway.
  // Stored before the status is even looked at: dropping one would unpair
  // this browser for real, since the app has already forgotten the old one.
  if (data && typeof data.token === "string") {
    await ext.storage.local.set({ [TOKEN_KEY]: data.token });
  }
  if (res.ok) return data;
  if (res.status === 401) {
    // Locked or unpaired, and the app does not say which. The token stays:
    // throwing it away here would turn "you locked your vault" into "pair
    // this browser again", every time. The popup offers re-pairing instead.
    throw new Error(NOT_PAIRED);
  }
  if (res.status === 403 && data.needsApproval) {
    const e = new Error(NEEDS_APPROVAL);
    e.host = data.host || "";
    throw e;
  }
  throw new Error(data.error || `request failed (${res.status})`);
}

/** Exchange the code shown in the app for a token. `post` stores it. */
export async function pair(code, label) {
  await post("/pair", { code, label });
}

export async function unpair() {
  await forgetToken();
}

/**
 * Does this browser still have a working token on an open vault?
 *
 * A reply means yes. There is no second answer to read: NOT_PAIRED covers
 * both a locked vault and a token the app no longer knows, because the app
 * cannot tell those apart while locked and must not appear to.
 */
export async function status() {
  const token = await storedToken();
  if (!token) throw new Error(NOT_PAIRED);
  return post("/status", {}, token);
}

/**
 * Logins saved for this origin: `[{ id, title, username }]`.
 * Never includes passwords — those come one at a time, on an explicit fill.
 */
export async function matches(origin) {
  const token = await storedToken();
  if (!token) throw new Error(NOT_PAIRED);
  const { items } = await post("/matches", { origin }, token);
  return items || [];
}

/**
 * The values for one item, for one origin: `{ username, password }`.
 * The caller writes them into the page and keeps no copy.
 */
export async function credentials(id, origin) {
  const token = await storedToken();
  if (!token) throw new Error(NOT_PAIRED);
  return post("/credentials", { id, origin }, token);
}

/**
 * Put one field on the clipboard, cleared by the app after a minute.
 *
 * The value never comes back here. A field the filler cannot name -- a PIN,
 * a CVV, a second form -- is a paste, not a fill, and routing it through the
 * app means the plaintext never enters the browser at all.
 */
export async function copy(id, origin, which) {
  const token = await storedToken();
  if (!token) throw new Error(NOT_PAIRED);
  return post("/copy", { id, origin, field: which }, token);
}

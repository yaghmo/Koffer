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

export const NOT_PAIRED = "not-paired";
export const NO_APP = "no-app";

async function storedToken() {
  const got = await ext.storage.local.get(TOKEN_KEY);
  return got[TOKEN_KEY] || null;
}

async function forgetToken() {
  await ext.storage.local.remove(TOKEN_KEY);
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
  if (res.ok) return data;
  if (res.status === 401) {
    // The app no longer knows this token — unpaired there, or a different
    // vault. Drop it so the popup offers pairing instead of failing forever.
    await forgetToken();
    throw new Error(NOT_PAIRED);
  }
  throw new Error(data.error || `request failed (${res.status})`);
}

/** Exchange the code shown in the app for a token, and remember it. */
export async function pair(code, label) {
  const { token } = await post("/pair", { code, label });
  await ext.storage.local.set({ [TOKEN_KEY]: token });
}

export async function unpair() {
  await forgetToken();
}

/** `{ unlocked }`. Throws NOT_PAIRED when this browser has no token. */
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

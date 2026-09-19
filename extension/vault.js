/**
 * vault.js — the only place that talks to the desktop app.
 *
 * ponytail: the transport is deliberately still unchosen — localhost socket
 * with a pairing key, or a native-messaging host. Everything above this file
 * is written against the three calls below, so choosing one means replacing
 * this file and nothing else.
 *
 * Until then every call rejects with NOT_PAIRED and the popup says so.
 */

export const NOT_PAIRED = "not-paired";

function unpaired() {
  return Promise.reject(new Error(NOT_PAIRED));
}

/** `{ unlocked: boolean }` — whether the app is running and its vault is open. */
export function status() {
  return unpaired();
}

/**
 * Logins saved for this origin: `[{ id, title, username }]`.
 * Never includes passwords — those come one at a time, on an explicit fill.
 */
export function matches(_origin) {
  return unpaired();
}

/**
 * The values for one item, for one fill: `{ username, password }`.
 * The caller writes them into the page and keeps no copy.
 */
export function credentials(_id, _origin) {
  return unpaired();
}

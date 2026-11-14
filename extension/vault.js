/**
 * vault.js — the only place that talks to the desktop app.
 *
 * The app listens on one loopback port and answers nothing useful until this
 * extension has been paired by hand: the app shows an 8-character code, the
 * user types it in here once, and from then on this browser proves who it is
 * by **signing** what it sends. Nothing else on the machine can read a code off
 * the user's screen, which is what keeps the port from being an open door to
 * every local process.
 *
 * # There is no token
 *
 * Pairing used to hand back a bearer string, which this file kept in
 * `chrome.storage.local` — a file in the browser profile that anything
 * running as the user can read. Whoever had it *was* the extension.
 *
 * Instead, pairing generates a P-256 key pair with `extractable: false` and
 * sends the app the public half. The private half lives in IndexedDB as a
 * `CryptoKey`, and WebCrypto will not turn it back into bytes for anyone,
 * this file included. Every request carries a signature over its path, a
 * timestamp and a hash of its body, so a signature proves one specific call
 * and cannot be lifted onto another or replayed once the clock has moved.
 *
 * This is not the same as unstealable. Chrome writes non-extractable key
 * material into the profile directory like everything else, and a program
 * that parses that format can still recover it. What it removes is the easy
 * path — no string to copy — and everything a captured request used to be
 * worth. Keys are also replaced hourly and expire after a week unused, so
 * material recovered the hard way goes stale on its own.
 *
 * # Nothing is sent in the clear
 *
 * Signing tells the app who is asking. It told this file nothing about who
 * was listening: with the app closed, any program can take its port, and it
 * would have been posted every login page's address and every password
 * typed. So pairing also agrees an AES-GCM key over ECDH (`channelKey`),
 * every request after it is sealed under that key, and an answer counts only
 * if it opens under it, for the request it answers: its tag covers that
 * request's nonce. `channel.rs` is the other half.
 *
 * This file never decides what may be filled. It passes the origin it is
 * acting for and the app does the filtering, so a bug up here cannot turn
 * into one site's password being handed to another.
 */

/** Firefox exposes the promise-based API as `browser`; Chrome as `chrome`. */
const ext = globalThis.browser ?? globalThis.chrome;

/**
 * The app's usual port, matching `PORT` in `bridge.rs`.
 *
 * Nothing here probes for the app. If 38471 was taken, the app moved to
 * another port and says so in the pairing code (`K7F2Q9MR-3` is 38474); the
 * code goes only to that port, and the port is kept with the key. Probing
 * would offer the code to whatever answered first, a squatter included.
 */
const PORT = 38471;
const HOST_PERMISSION = "http://127.0.0.1/*";

/** `{ code, port }` from what the user typed, or null when it is malformed. */
export function parseCode(typed) {
  const m = /^([A-Z0-9]{8})(?:-(\d{1,2}))?$/.exec(String(typed || "").trim().toUpperCase());
  if (!m) return null;
  const offset = m[2] ? Number(m[2]) : 0;
  return offset < 32 ? { code: m[1], port: PORT + offset } : null;
}

const DB_NAME = "pm-bridge";
const STORE = "keys";
const KEY_ID = "pairing";

/**
 * The app would not answer: the vault is locked, or this browser is no
 * longer paired. Deliberately one error for both.
 *
 * The bridge returns the same 401 either way, because a locked vault cannot
 * read its own key list and so genuinely cannot tell the two apart. An answer
 * that distinguished them would let any program on the machine poll the port
 * and watch for the moment the vault opened.
 */
export const NOT_PAIRED = "not-paired";
export const NO_APP = "no-app";
/** This site has not been approved for this browser yet. */
export const NEEDS_APPROVAL = "needs-approval";
/** "Confirm every fill" is on and the app is asking the user right now. */
export const NEEDS_CONFIRM = "needs-confirm";

/**
 * Run a handout, waiting through the app's "Allow?" when it asks. `onWait`
 * runs once, so the caller can say to look at the app. Gives up after the
 * app's own window for an answer.
 */
export async function whenAllowed(run, onWait) {
  for (let i = 0; ; i++) {
    try {
      return await run();
    } catch (e) {
      if (e.message !== NEEDS_CONFIRM || i >= 30) throw e;
      if (i === 0 && onWait) onWait();
      await new Promise((done) => setTimeout(done, 1000));
    }
  }
}

// ---------------------------------------------------------------------------
// The key
// ---------------------------------------------------------------------------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, run) {
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** `{ privateKey, publicKeyHex }`, or null when this browser is not paired. */
async function storedKey() {
  try {
    const db = await openDb();
    const key = (await tx(db, "readonly", (s) => s.get(KEY_ID))) || null;
    // Paired before there was a channel: the app answers nothing sent in
    // the clear any more, so this browser pairs again.
    return key && key.channel ? key : null;
  } catch {
    // A profile with IndexedDB blocked cannot hold a key at all, which reads
    // the same as never having paired.
    return null;
  }
}

async function storeKey(key) {
  const db = await openDb();
  await tx(db, "readwrite", (s) => s.put(key, KEY_ID));
}

async function forgetKey() {
  try {
    const db = await openDb();
    await tx(db, "readwrite", (s) => s.delete(KEY_ID));
  } catch {
    // Nothing to forget.
  }
}

/** Has this browser ever been paired? Not whether the key still works. */
export async function isPaired() {
  return (await storedKey()) !== null;
}

/**
 * A fresh signing key.
 *
 * `extractable: false` is the whole point: WebCrypto will hand back the
 * public point and refuse, forever, to hand back the private one. Per spec
 * the public half of a generated pair is always extractable, which is why
 * exporting it below is allowed even though the pair is not.
 */
async function newKey() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"]
  );
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
  return { privateKey: pair.privateKey, publicKeyHex: hex(raw) };
}

function hex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function unhex(text) {
  const pairs = String(text).match(/../g) || [];
  return Uint8Array.from(pairs.map((b) => parseInt(b, 16)));
}

const utf8 = new TextEncoder();

// ---------------------------------------------------------------------------
// The sealed channel
// ---------------------------------------------------------------------------

/** Names the protocol in the key derivation; `INFO` in channel.rs. */
const CHANNEL_INFO = "koffer-bridge-v1";

/** This browser's half of the key agreement, for one pairing. */
async function newChannelPair() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  return { privateKey: pair.privateKey, publicKeyHex: hex(await crypto.subtle.exportKey("raw", pair.publicKey)) };
}

/**
 * The key both sides reach from each other's public points: ECDH, then
 * HKDF-SHA-256, as `derive` in channel.rs. Not extractable, like the signing
 * key, and for the same reason.
 */
export async function channelKey(privateKey, appPublicHex) {
  const theirs = await crypto.subtle.importKey("raw", unhex(appPublicHex), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: theirs }, privateKey, 256);
  const material = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8.encode(CHANNEL_INFO) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Seal one request body: `body` is `{"n": nonce hex, "c": ciphertext base64}`.
 * `nonce` is that same hex, which the answer must be opened against.
 */
export async function seal(key, path, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: utf8.encode(`${path}\nrequest`) },
    key,
    utf8.encode(text)
  );
  let binary = "";
  for (const b of new Uint8Array(sealed)) binary += String.fromCharCode(b);
  return { body: JSON.stringify({ n: hex(iv), c: btoa(binary) }), nonce: hex(iv) };
}

/**
 * Open the app's answer to one call. Throws for anything the app did not
 * seal as the answer to this request: sent in the clear, sealed for another
 * route, this browser's own request handed back, or a real answer recorded
 * earlier, whose tag covers the nonce of the request it was made for.
 */
export async function open(key, path, body, nonce) {
  if (!body || typeof body.n !== "string" || typeof body.c !== "string") throw new Error("not sealed");
  const sealed = Uint8Array.from(atob(body.c), (ch) => ch.charCodeAt(0));
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unhex(body.n), additionalData: utf8.encode(`${path}\nreply\n${nonce}`) },
    key,
    sealed
  );
  return new TextDecoder().decode(plain);
}

/**
 * Sign one request. Must match `signed_payload` in `bridge.rs` exactly.
 *
 * The body is hashed rather than signed directly so the signature is a fixed
 * size, and the path and timestamp are in there so the result is worth
 * nothing on any other call.
 */
async function signature(privateKey, path, bodyText, timestamp) {
  const digest = await crypto.subtle.digest("SHA-256", utf8.encode(bodyText));
  const payload = `${path}\n${timestamp}\n${hex(digest)}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    utf8.encode(payload)
  );
  return hex(sig);
}

// ---------------------------------------------------------------------------
// Talking to the app
// ---------------------------------------------------------------------------

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

async function send(port, path, headers, bodyText, channel, nonce) {
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers, body: bodyText });
  } catch {
    // Nothing listening: the app is closed, or it could not take the port.
    throw new Error(NO_APP);
  }

  let data = await res.json().catch(() => ({}));
  if (channel) {
    try {
      data = JSON.parse(await open(channel, path, data, nonce));
    } catch {
      // A locked app cannot read its own keys, so its 401 comes unsealed.
      // Anything else unsealed is not the app: whatever holds the port did
      // not pair with this browser, and nothing it says is acted on. An app
      // on another version than this extension lands here too.
      throw new Error(res.status === 401 ? NOT_PAIRED : NO_APP);
    }
  }
  if (res.ok) return data;
  if (res.status === 401) {
    // Locked or unpaired, and the app does not say which. The key stays:
    // throwing it away here would turn "you locked your vault" into "pair
    // this browser again", every time. The popup offers re-pairing instead.
    throw new Error(NOT_PAIRED);
  }
  if (res.status === 403 && data.needsConfirm) throw new Error(NEEDS_CONFIRM);
  if (res.status === 403 && data.needsApproval) {
    const e = new Error(NEEDS_APPROVAL);
    e.host = data.host || "";
    throw e;
  }
  throw new Error(data.error || `request failed (${res.status})`);
}

/** One call to the app, sealed and signed when we have a key. */
async function post(path, body, key, port = (key && key.port) || PORT) {
  let bodyText = JSON.stringify(body || {});
  const headers = { "Content-Type": "application/json" };
  let nonce;
  if (key) {
    // Sealed first: the signature then covers what actually goes out.
    ({ body: bodyText, nonce } = await seal(key.channel, path, bodyText));
    const timestamp = Math.floor(Date.now() / 1000);
    headers["X-PM-Timestamp"] = String(timestamp);
    headers["X-PM-Signature"] = await signature(key.privateKey, path, bodyText, timestamp);
  }
  const data = await send(port, path, headers, bodyText, key && key.channel, nonce);
  // The app keeps the clock on key age, so a browser whose storage was
  // cleared cannot quietly stop rotating. Never from inside a rekey: that
  // call already holds the lock the next one would wait on.
  if (data.rekey && path !== "/rekey") await rekey();
  return data;
}

/** Signed call: throws NOT_PAIRED when this browser has no key at all. */
async function signedPost(path, body) {
  const key = await storedKey();
  if (!key) throw new Error(NOT_PAIRED);
  return post(path, body, key);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Exchange the code shown in the app for a pairing, keyed to this browser. */
export async function pair(typed, label) {
  const parsed = parseCode(typed);
  if (!parsed) throw new Error("That is not a pairing code.");
  const key = await newKey();
  const half = await newChannelPair();
  const answer = await post(
    "/pair",
    { code: parsed.code, label, publicKey: key.publicKeyHex, channelKey: half.publicKeyHex },
    null,
    parsed.port
  );
  // An app from before the channel sends no point back, and would answer
  // nothing this file now sends.
  if (!answer.channelKey) throw new Error("Update the Koffer app, then pair again.");
  const channel = await channelKey(half.privateKey, answer.channelKey);
  // The app ties this browser to the port it paired on; so does the key.
  await storeKey({ ...key, port: parsed.port, channel });
}

export async function unpair() {
  await forgetKey();
}

/**
 * Replace this browser's key with a new one, signed by the old.
 *
 * This is what the key being asymmetric buys. A shared secret could only be
 * rotated by sending the new secret over the wire, which means generating one
 * the browser can export — and an exportable key is exactly what this design
 * avoids. A public point can be shouted.
 *
 * Taken under a lock because the popup and the service worker both make
 * calls, and two rekeys racing would leave the app holding one key and this
 * browser storing the other. Inside the lock the stored key is read again, so
 * a rekey that has already happened elsewhere is not repeated.
 */
async function rekey() {
  const run = async () => {
    const current = await storedKey();
    if (!current) return;
    const fresh = await newKey();
    await post("/rekey", { publicKey: fresh.publicKeyHex }, current);
    await storeKey({ ...fresh, port: current.port, channel: current.channel });
  };
  try {
    if (globalThis.navigator && navigator.locks) {
      await navigator.locks.request("pm-rekey", run);
    } else {
      await run();
    }
  } catch {
    // The old key is good until it expires; the next call asks again.
  }
}

/**
 * Does this browser still have a working key on an open vault?
 *
 * A reply means yes. There is no second answer to read: NOT_PAIRED covers
 * both a locked vault and a key the app no longer knows, because the app
 * cannot tell those apart while locked and must not appear to.
 */
export async function status() {
  return signedPost("/status", {});
}

/**
 * What the vault has for this origin: `{ items }` for an approved site, and
 * for any other `{ items: [], needsApproval, host, never }` -- the
 * same reply whether the vault holds anything there or not.
 */
export async function matches(origin) {
  const data = await signedPost("/matches", { origin });
  return {
    items: data.items || [],
    needsApproval: !!data.needsApproval,
    host: data.host || "",
    // The user chose "Never" for this unapproved site: no prompt on the page.
    never: !!data.never,
    // The user turned the on-page approval prompt off in the app.
    prompt: data.prompt !== false,
    // The popup's personal-info card, unless turned off in the app.
    personal: data.personal !== false,
  };
}

/** Ask the app to put its approval dialog on screen. Returns nothing else. */
export async function ask(origin) {
  return signedPost("/ask", { origin });
}

/**
 * The values for one item, for one origin: `{ username, password }`.
 * The caller writes them into the page and keeps no copy.
 */
export async function credentials(id, origin) {
  return signedPost("/credentials", { id, origin });
}

/**
 * Put one field on the clipboard, cleared by the app after a minute.
 *
 * The value never comes back here. A field the filler cannot name — a PIN, a
 * CVV, a second form — is a paste, not a fill, and routing it through the app
 * means the plaintext never enters the browser at all.
 */
export async function copy(id, origin, which) {
  return signedPost("/copy", { id, origin, field: which });
}

/** The login's current 2FA code, for this origin. Same approval as a password. */
export async function totpCode(id, origin) {
  return signedPost("/totp", { id, origin });
}

/**
 * The profile's filled-in fields, for a form on this origin. Same approval,
 * and same confirmation when that is on, as a password.
 */
export async function personal(origin) {
  return signedPost("/personal", { origin });
}

/** What to offer after a login that looks like it worked. */
export async function offer(origin, username, password, current, last) {
  return signedPost("/offer", { origin, username, password, current, last: last || "" });
}

export async function saveLogin(origin, username, password) {
  return signedPost("/save", { origin, username, password });
}

export async function updateLogin(id, origin, password) {
  return signedPost("/update", { id, origin, password });
}

/**
 * "Not now" on any offer. The app counts it toward offering "Never for this
 * site", and on an update remembers the password that worked.
 */
export async function seen(origin, username, password) {
  return signedPost("/seen", { origin, username, password });
}

export async function never(origin) {
  return signedPost("/never", { origin });
}

/**
 * What to offer after a 2FA setup page took a code. `keys` and `qr` are what
 * the page showed, `last` the login last used on this site; the app answers
 * `add` with the key that made `code` and the login it would go on, or
 * `hasKey` when that login already has one.
 */
export async function keyOffer(origin, code, keys, qr, last) {
  return signedPost("/key-offer", { origin, code, keys, qr, last: last || "" });
}

/** Put a 2FA key on a login that has none. */
export async function saveKey(id, origin, key) {
  return signedPost("/key-save", { id, origin, key });
}

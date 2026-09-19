/**
 * popup.js — the only surface where a fill can be started.
 *
 * Detection badges a tab; it never fills. A password is written into a page
 * because someone clicked the item they wanted, on the origin shown right
 * above it, and for no other reason.
 */
import {
  NOT_PAIRED,
  NO_APP,
  ensureHostPermission,
  pair,
  status,
  matches,
  credentials,
} from "./vault.js";

/** Firefox exposes the promise-based API as `browser`; Chrome as `chrome`. */
const ext = globalThis.browser ?? globalThis.chrome;

const pageEl = document.getElementById("page");
const vaultEl = document.getElementById("vault");

function text(el, str, cls = "dim") {
  el.replaceChildren(Object.assign(document.createElement("span"), {
    className: cls,
    textContent: str,
  }));
}

async function activeTab() {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** The content script is absent on chrome:// pages and on tabs that were
 *  already open when the extension was installed. */
async function pageState(tabId) {
  try {
    return await ext.tabs.sendMessage(tabId, { type: "state" });
  } catch {
    return null;
  }
}

function renderPage(state) {
  if (!state) {
    text(pageEl, "This page cannot be filled. Reload it, or try a normal web page.");
    return;
  }
  const head = document.createElement("div");
  head.className = state.login ? "muted" : "dim";
  head.textContent = state.login ? "Login form detected on" : "No login form on";
  const origin = document.createElement("div");
  origin.className = "origin";
  origin.textContent = state.origin;
  pageEl.replaceChildren(head, origin);
}

function renderPairing() {
  const note = document.createElement("div");
  note.className = "dim";
  note.textContent =
    "Open the vault app, go to Settings → Browser extension, and type the code it shows.";

  const row = document.createElement("div");
  row.className = "row";
  const input = document.createElement("input");
  input.className = "code";
  input.placeholder = "PAIRING CODE";
  input.maxLength = 8;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.autofocus = true;
  const go = document.createElement("button");
  go.className = "primary";
  go.type = "button";
  go.textContent = "Pair";
  row.append(input, go);

  const error = document.createElement("div");
  error.className = "dim";

  async function submit() {
    const code = input.value.trim().toUpperCase();
    if (code.length === 0) return;
    go.disabled = true;
    error.textContent = "";
    try {
      // First await in the click handler on purpose: Firefox only allows the
      // permission prompt while the user gesture is still live.
      await ensureHostPermission();
      await pair(code, browserLabel());
      main();
    } catch (e) {
      error.textContent = describe(e);
      go.disabled = false;
      input.select();
    }
  }
  go.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });

  vaultEl.replaceChildren(note, row, error);
  input.focus();
}

/** Something the user will recognise in the app's paired-extensions list. */
function browserLabel() {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  return "Browser";
}

function describe(e) {
  if (e.message === NO_APP) return "The vault app is not running.";
  if (e.message === NOT_PAIRED) return "This browser is not paired yet.";
  return e.message;
}

/** Matches the app's own naming in src/lib/methods.tsx. */
const PROVIDER_LABELS = {
  google: "Google",
  github: "GitHub",
  microsoft: "Microsoft",
  apple: "Apple",
  facebook: "Facebook",
  other: "another app",
};

function providerLabel(method) {
  return PROVIDER_LABELS[method] || method;
}

/**
 * A provider login has no password that belongs on this site — "Sign in
 * with Google" hands the site a token, never a password. So it is shown as
 * a reminder of which account to pick, not as something to fill.
 */
function renderProviderHint(item) {
  const row = document.createElement("div");
  row.className = "hint";
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = item.title;
  const sub = document.createElement("span");
  sub.className = "sub";
  sub.textContent = `Signs in with ${providerLabel(item.method)}`;
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = item.username || "account not recorded";
  row.append(title, sub, who);
  return row;
}

function renderItems(items, tabId, origin) {
  if (items.length === 0) {
    text(vaultEl, `No saved login for ${origin}.`);
    return;
  }
  const list = document.createElement("ul");
  for (const item of items) {
    const li = document.createElement("li");
    if (item.method && item.method !== "credentials") {
      li.append(renderProviderHint(item));
      list.append(li);
      continue;
    }
    const button = document.createElement("button");
    button.className = "item";
    button.type = "button";
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = item.title;
    const sub = document.createElement("span");
    sub.className = "sub";
    sub.textContent = item.username || "no username saved";
    button.append(title, sub);
    button.addEventListener("click", () => fill(button, item, tabId, origin));
    li.append(button);
    list.append(li);
  }
  vaultEl.replaceChildren(list);
}

async function fill(button, item, tabId, origin) {
  button.disabled = true;
  try {
    // Fetched at the moment of the click and handed straight to the page:
    // the popup keeps no copy, and closing it takes the values with it.
    const data = await credentials(item.id, origin);
    const out = await ext.tabs.sendMessage(tabId, { type: "fill", data });
    if (!out || out.filled.length === 0) {
      text(vaultEl, "Nothing on this page matched those fields.");
      return;
    }
    window.close();
  } catch (e) {
    text(vaultEl, `Could not fill: ${describe(e)}`);
  }
}

async function main() {
  const tab = await activeTab();
  if (!tab || tab.id === undefined) {
    text(pageEl, "No active tab.");
    text(vaultEl, "");
    return;
  }
  const state = await pageState(tab.id);
  renderPage(state);

  try {
    const { unlocked } = await status();
    if (!unlocked) {
      text(vaultEl, "The vault is locked. Unlock it in the app, then reopen this.");
      return;
    }
    if (!state) {
      text(vaultEl, "");
      return;
    }
    renderItems(await matches(state.origin), tab.id, state.origin);
  } catch (e) {
    if (e.message === NOT_PAIRED) renderPairing();
    else text(vaultEl, describe(e));
  }
}

main();

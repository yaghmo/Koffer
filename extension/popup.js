/**
 * popup.js — the only surface where a fill can be started.
 *
 * Detection badges a tab; it never fills. A password is written into a page
 * because someone clicked the item they wanted, on the origin shown right
 * above it, and for no other reason.
 */
import { NOT_PAIRED, status, matches, credentials } from "./vault.js";

const pageEl = document.getElementById("page");
const vaultEl = document.getElementById("vault");

function text(el, str, cls = "dim") {
  el.replaceChildren(Object.assign(document.createElement("span"), {
    className: cls,
    textContent: str,
  }));
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** The content script is absent on chrome:// pages and on tabs that were
 *  already open when the extension was installed. */
async function pageState(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "state" });
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

function renderItems(items, tabId, origin) {
  if (items.length === 0) {
    text(vaultEl, `No saved login for ${origin}.`);
    return;
  }
  const list = document.createElement("ul");
  for (const item of items) {
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
    const li = document.createElement("li");
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
    const out = await chrome.tabs.sendMessage(tabId, { type: "fill", data });
    if (!out || out.filled.length === 0) {
      text(vaultEl, "Nothing on this page matched those fields.");
      return;
    }
    window.close();
  } catch (e) {
    text(vaultEl, `Could not fill: ${e.message}`);
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
      text(vaultEl, "The vault app is running but locked. Unlock it, then reopen this.");
      return;
    }
    if (!state) {
      text(vaultEl, "");
      return;
    }
    renderItems(await matches(state.origin), tab.id, state.origin);
  } catch (e) {
    text(
      vaultEl,
      e.message === NOT_PAIRED
        ? "Not paired with the vault app yet — that is the next step."
        : `Cannot reach the vault app: ${e.message}`,
    );
  }
}

main();

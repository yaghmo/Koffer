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
  NEEDS_APPROVAL,
  ensureHostPermission,
  isPaired,
  pair,
  status,
  matches,
  ask,
  credentials,
  copy,
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
      paired();
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

/**
 * Say it worked, then get out of the way.
 *
 * Re-rendering the normal view here looked fine in theory and read as a
 * failure in practice: the code field just sat there greyed out with no
 * word about whether anything had happened.
 */
function paired() {
  const done = document.createElement("div");
  done.className = "muted";
  done.textContent = `Paired with ${browserLabel()}.`;
  const note = document.createElement("div");
  note.className = "dim";
  note.textContent = "Open this again on a login page to fill from your vault.";
  vaultEl.replaceChildren(stack(done, note));
  setTimeout(() => window.close(), 1200);
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
  if (e.message === NEEDS_APPROVAL) {
    return `${e.host || "This site"} is not approved for this browser yet. The app is asking — say yes there, then try again.`;
  }
  return e.message;
}

/**
 * The app answers a locked vault and an unpaired browser identically, on
 * purpose: it cannot read its own token list while locked, and a reply that
 * told the two apart would let anything on this machine watch for the moment
 * the vault opened. So this says both, in the order they are likely.
 */
function renderUnavailable() {
  const note = document.createElement("div");
  note.className = "muted";
  note.textContent = "The vault is locked, or this browser is no longer paired.";
  const hint = document.createElement("div");
  hint.className = "dim";
  hint.textContent = "Unlock the app and reopen this. If that does not help, pair again.";
  const again = document.createElement("button");
  again.className = "primary";
  again.type = "button";
  again.textContent = "Pair again";
  again.addEventListener("click", () => renderPairing());
  vaultEl.replaceChildren(stack(note, hint, again));
}

/** One message and one action, centred. */
function stack(...children) {
  const box = document.createElement("div");
  box.className = "stack";
  box.append(...children);
  return box;
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
 * A provider login has no password that belongs on *this* site — "Sign in
 * with Google" hands the site a token, never a password. So it is shown as
 * a reminder of which account to pick, not as something to fill.
 *
 * On the provider's own sign-in page the same item becomes fillable, and
 * the app says so with `fillable`; this is only the other case.
 */
function renderProviderHint(item) {
  const row = document.createElement("div");
  row.className = "hint";
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = item.title;
  const sub = document.createElement("span");
  sub.className = "sub";
  sub.textContent =
    item.method && item.method !== "credentials"
      ? `Signs in with ${providerLabel(item.method)}`
      : "No password saved";
  row.append(title, sub);
  if (item.username) {
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = item.username;
    row.append(who);
  }
  return row;
}

/**
 * A site this browser has not been approved for.
 *
 * The app sent a count and no accounts, which is the point: "there is
 * something here" is worth knowing, "which account" is not worth handing over
 * before the user has said yes. The button only asks the app to put its
 * dialog up — the answer happens there.
 */
function renderApproval(result, origin) {
  const head = document.createElement("div");
  head.className = "muted";
  head.textContent =
    result.count === 0
      ? `No saved login for ${origin}.`
      : `${result.count} saved login${result.count === 1 ? "" : "s"} for ${result.host}.`;

  const note = document.createElement("div");
  note.className = "dim";
  note.textContent =
    result.count === 0
      ? `This browser has not been approved for ${result.host} either.`
      : "This browser has not been approved for this site yet.";

  const go = document.createElement("button");
  go.className = "primary";
  go.type = "button";
  go.textContent = "Approve in the app";
  go.addEventListener("click", async () => {
    go.disabled = true;
    try {
      await ask(origin);
      note.textContent = "The app is asking. Say yes there, then reopen this.";
    } catch (e) {
      note.textContent = describe(e);
      go.disabled = false;
    }
  });

  vaultEl.replaceChildren(stack(head, note, go));
}

function renderItems(result, tabId, origin) {
  if (result.needsApproval) {
    renderApproval(result, origin);
    return;
  }
  const items = result.items;
  if (items.length === 0) {
    text(vaultEl, `No saved login for ${origin}.`);
    return;
  }
  const list = document.createElement("ul");
  for (const item of items) {
    const li = document.createElement("li");
    // The app decides what is fillable, not this file: a button the next
    // call would refuse is worse than no button.
    if (!item.fillable) {
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
    sub.textContent = item.username || item.phone || "no username saved";
    button.append(title, sub);
    button.addEventListener("click", () => fill(button, item, tabId, origin));

    // The password goes to the clipboard through the app, never through
    // here: the popup asks, the app copies and clears it a minute later, and
    // the reply says only that it happened. For the boxes the filler cannot
    // name — a PIN, a CVV, a second form on the same page.
    const copyBtn = document.createElement("button");
    copyBtn.className = "copy";
    copyBtn.type = "button";
    copyBtn.textContent = "Copy password";
    copyBtn.title = "Put the password on the clipboard — the app clears it after a minute";
    copyBtn.addEventListener("click", () => copyPassword(copyBtn, item, origin));

    const row = document.createElement("div");
    row.className = "pair";
    row.append(button, copyBtn);
    li.append(row);
    list.append(li);
  }
  const caption = document.createElement("div");
  caption.className = "caption";
  caption.textContent =
    "Click an account to fill it. Copy password puts it on the clipboard for a minute instead — for boxes the filler cannot reach.";
  vaultEl.replaceChildren(list, caption);
}

async function copyPassword(button, item, origin) {
  button.disabled = true;
  const was = button.textContent;
  try {
    const { seconds } = await copy(item.id, origin, "password");
    button.textContent = `Copied · ${seconds}s`;
  } catch (e) {
    text(vaultEl, `Could not copy: ${describe(e)}`);
    return;
  }
  button.disabled = false;
  setTimeout(() => {
    button.textContent = was;
  }, 1500);
}

async function fill(button, item, tabId, origin) {
  button.disabled = true;
  try {
    // Fetched at the moment of the click and handed straight to the page:
    // the popup keeps no copy, and closing it takes the values with it.
    const data = await credentials(item.id, origin);
    // The origin travels with the fill so the content script can refuse if
    // the tab moved between the popup opening and this click.
    const out = await ext.tabs.sendMessage(tabId, { type: "fill", data, origin });
    if (out && out.wrongOrigin) {
      text(vaultEl, `This tab moved to ${out.wrongOrigin}. Nothing was filled — reopen this.`);
      return;
    }
    // Checked before "nothing matched", because a deferred fill usually
    // *is* a page where nothing matched yet — that was the whole confusion:
    // it said nothing could be filled and then filled the modal a moment
    // later.
    if (out && out.deferred) {
      text(
        vaultEl,
        out.filled.length > 0
          ? "Filled what is on the page. The rest goes in when the next step appears."
          : "No login form here yet. It fills as soon as one opens — click the site's login button.",
        "muted"
      );
      return;
    }
    if (!out || out.filled.length === 0) {
      text(vaultEl, "Nothing on this page matched those fields.");
      return;
    }
    // No report on the way out. What landed cannot be checked honestly from
    // here anyway: a controlled input re-renders from its old value before
    // its handler runs, so an immediate read says "empty" on a field that
    // is about to settle correctly.
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
    // A reply at all means the vault is open and this token still works;
    // anything else throws, and there is no third answer to read.
    await status();
    if (!state) {
      // The vault is fine; this page just has no content script. Say only
      // that. Suggesting a reload was wrong more often than right — most
      // pages without a content script are chrome:// or the extensions
      // page, where there is nothing to fill however often you reload.
      text(vaultEl, "Vault connected.", "muted");
      return;
    }
    renderItems(await matches(state.origin), tab.id, state.origin);
  } catch (e) {
    if (e.message !== NOT_PAIRED) {
      text(vaultEl, describe(e));
      return;
    }
    // Never paired is a different thing from paired-and-refused, and only
    // this side knows which: the app answers both the same way.
    if (await isPaired()) renderUnavailable();
    else renderPairing();
  }
}

main();

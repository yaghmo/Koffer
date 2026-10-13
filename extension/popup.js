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
  totpCode,
  personal,
  whenAllowed,
} from "./vault.js";
import { lastLoginKey } from "./capture.js";
import { mark } from "./marks.js";

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
  const found = state.login || state.codeBox;
  head.className = found ? "muted" : "dim";
  head.textContent = state.login ? "Login form detected on" : state.codeBox ? "2FA code box on" : "No login form on";
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
  // Eight characters, plus "-N" when the app is on another port.
  input.maxLength = 11;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.autofocus = true;
  const go = document.createElement("button");
  go.className = "primary";
  go.type = "button";
  go.textContent = "Pair";
  row.append(input, go);

  const error = document.createElement("div");
  error.className = "error";

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
  stopWatching();
  const done = document.createElement("div");
  done.className = "muted";
  done.textContent = `Paired with ${browserLabel()}.`;
  const note = document.createElement("div");
  note.className = "dim";
  note.textContent = "Open this again on a login page to fill from your vault.";
  // Both would ask after every login, and the browser's copy is not in the vault.
  const tip = document.createElement("div");
  tip.className = "dim";
  tip.textContent = "Turn off your browser's own “offer to save passwords” so only one of them asks.";
  vaultEl.replaceChildren(stack(done, note, tip));
  setTimeout(() => window.close(), 5000);
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
    return `${e.host || "This site"} is not approved for this browser yet. The app is asking. Say yes there, then try again.`;
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
  hint.textContent = "Unlock the app. This updates on its own. If it stays here, pair again.";
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
/**
 * The login's logo: the one the app stored, else its initial. A login that
 * signs in through Google, GitHub... wears that provider's mark as a small
 * badge on the corner, so "which way did I sign in here" is visible before
 * reading anything.
 */
function logo(item) {
  const box = document.createElement("span");
  box.className = "logo";
  if (item.favicon && item.favicon.startsWith("data:image/")) {
    const img = document.createElement("img");
    img.src = item.favicon;
    img.alt = "";
    box.append(img);
  } else {
    box.classList.add("letter");
    box.textContent = (item.title || "?").charAt(0).toUpperCase();
  }
  const provider = item.method && item.method !== "credentials" ? mark(item.method) : null;
  if (provider) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.title = `Signs in with ${providerLabel(item.method)}`;
    badge.append(provider);
    box.append(badge);
  }
  return box;
}

/** Logo on the left, title and a line under it on the right. */
function accountFace(el, item, subText) {
  const text = document.createElement("span");
  text.className = "text";
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = item.title;
  const sub = document.createElement("span");
  sub.className = "sub";
  sub.textContent = subText;
  text.append(title, sub);
  el.append(logo(item), text);
  return text;
}

function renderProviderHint(item, tabId) {
  const provider = item.method && item.method !== "credentials" && item.method !== "other";
  // Clickable when there is a provider button to point at; the click that
  // signs in stays the user's, on the page.
  const row = document.createElement(provider ? "button" : "div");
  row.className = "hint";
  const text = accountFace(
    row,
    item,
    item.method && item.method !== "credentials" ? `Signs in with ${providerLabel(item.method)}` : "No password saved"
  );
  if (item.username) {
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = item.username;
    text.append(who);
  }
  if (provider) {
    row.type = "button";
    row.title = `Show the ${providerLabel(item.method)} button on this page`;
    row.addEventListener("click", () => highlightProvider(item, tabId));
  }
  return row;
}

/** A login that signs in through Google, GitHub... rather than here. */
function signsInElsewhere(item) {
  return !item.fillable && item.method !== "credentials" && item.method !== "other";
}

/** Point at the page's "Sign in with ..." button for this login. */
async function highlightProvider(item, tabId) {
  stopWatching();
  const name = providerLabel(item.method);
  const note = `You sign in here with ${name}` + (item.username ? ` as ${item.username}` : "") + ".";
  const out = await ext.tabs.sendMessage(tabId, { type: "highlight-provider", method: item.method, note }).catch(() => null);
  if (out && out.found) {
    window.close();
    return;
  }
  text(vaultEl, `No "${name}" button on this page. Look for "Sign in with ${name}", or open the site's login page first.`, "muted");
}

/**
 * A site this browser has not been approved for.
 *
 * The app says nothing about what it holds for the site — not the accounts,
 * not even whether there are any — because anything it tells this browser it
 * also tells whoever copied the key out of the profile. The app's own dialog
 * shows how many logins match. The button only asks the app to put that
 * dialog up — the answer happens there.
 */
function renderApproval(result, origin) {
  const head = document.createElement("div");
  head.className = "muted";
  head.textContent = `This browser has not been approved for ${result.host} yet.`;

  const note = document.createElement("div");
  note.className = "dim";
  note.textContent = "The app will show whether you have a login saved for it.";

  const go = document.createElement("button");
  go.className = "primary";
  go.type = "button";
  go.textContent = "Approve in the app";
  go.addEventListener("click", async () => {
    go.disabled = true;
    try {
      await ask(origin);
      note.textContent = "The app is asking. Say yes there. This updates on its own.";
    } catch (e) {
      note.textContent = describe(e);
      go.disabled = false;
    }
  });

  vaultEl.replaceChildren(stack(head, note, go));
}

function renderItems(result, tabId, origin, withCard) {
  if (result.needsApproval) {
    renderApproval(result, origin);
    return;
  }
  const items = result.items;
  if (items.length === 0 && !withCard) {
    text(vaultEl, `No saved login for ${origin}.`);
    return;
  }
  const list = document.createElement("ul");
  if (withCard) list.append(personalCard(tabId, origin));
  for (const item of items) {
    const li = document.createElement("li");
    // The app decides what is fillable, not this file: a button the next
    // call would refuse is worse than no button.
    if (!item.fillable) {
      li.append(renderProviderHint(item, tabId));
      list.append(li);
      continue;
    }
    const button = document.createElement("button");
    button.className = "item";
    button.type = "button";
    accountFace(button, item, item.username || item.phone || "no username saved");
    button.addEventListener("click", () => fill(button, item, tabId, origin));
    // One button per account: the fill already puts each value in its own
    // box, and a login's 2FA code is offered on the page that asks for it.
    li.append(button);
    list.append(li);
  }
  const caption = document.createElement("div");
  caption.className = "caption";
  caption.textContent =
    items.length === 0
      ? "Fills each box the page has from your profile."
      : items.every(signsInElsewhere)
        ? "Click one to find its sign-in button on the page."
        : "Click an account to fill it.";
  vaultEl.replaceChildren(list, caption);
}

/** Pages with this many kinds of personal field get the profile card. */
const PERSONAL_MIN = 2;

/**
 * One button that fills the page from the profile in the app: name, email,
 * phone, address and the rest, each into its own box. Values the page has no
 * box for go nowhere.
 */
function personalCard(tabId, origin) {
  // Drawn as an ID card, not an account row: it fills who you are, not a
  // login, and should never be mistaken for one. It shows no profile values
  // until clicked -- those come from the app only then.
  const button = document.createElement("button");
  button.className = "idcard";
  button.type = "button";
  const head = document.createElement("span");
  head.className = "id-head";
  head.append(Object.assign(document.createElement("span"), { textContent: "Identity" }));
  head.append(Object.assign(document.createElement("span"), { className: "id-chip", textContent: "ID" }));
  const body = document.createElement("span");
  body.className = "id-body";
  const photo = document.createElement("span");
  photo.className = "id-photo";
  photo.append(mark("person"));
  const text = document.createElement("span");
  text.className = "text";
  text.append(Object.assign(document.createElement("span"), { className: "title", textContent: "Personal info" }));
  text.append(Object.assign(document.createElement("span"), { className: "sub", textContent: "Name, email, phone, address" }));
  body.append(photo, text);
  const strip = Object.assign(document.createElement("span"), { className: "id-strip", textContent: "FILL‹‹FORM‹‹FROM‹‹PROFILE‹‹‹‹" });
  button.append(head, body, strip);
  button.addEventListener("click", () => fillPersonal(button, tabId, origin));
  const li = document.createElement("li");
  li.append(button);
  return li;
}

async function fillPersonal(button, tabId, origin) {
  stopWatching();
  button.disabled = true;
  try {
    const data = await whenAllowed(() => personal(origin), waitForApp);
    delete data.rekey;
    if (Object.keys(data).length === 0) {
      text(vaultEl, "Your profile is empty. Fill it in under Personal info in the app.");
      return;
    }
    // `strict`: only boxes on show. Hidden ones are how a page would collect
    // every profile field from one click.
    const out = await ext.tabs.sendMessage(tabId, { type: "fill", data, origin, strict: true });
    if (out && out.wrongOrigin) {
      text(vaultEl, `This tab moved to ${out.wrongOrigin}. Nothing was filled. Reopen this.`);
      return;
    }
    if (!out || out.filled.length === 0) {
      text(vaultEl, "Nothing on this page matched your profile.");
      return;
    }
    window.close();
  } catch (e) {
    text(vaultEl, `Could not fill: ${describe(e)}`);
  }
}

/** The login last used on this site, if the extension saw it happen. */
async function lastLogin(origin) {
  try {
    const key = lastLoginKey(origin);
    const r = (await ext.storage.session.get(key))[key];
    return r ? r.id : "";
  } catch {
    return "";
  }
}

async function rememberLogin(origin, id) {
  try {
    await ext.storage.session.set({ [lastLoginKey(origin)]: { id, at: Date.now() } });
  } catch {
    // Only the ordering of a later 2FA step is lost.
  }
}

/**
 * A page asking for a 2FA code and nothing else: the logins that have a key,
 * the one just used on this site first. Their passwords have nowhere to go.
 */
function renderCodes(result, tabId, origin, lastId, showAll = false) {
  const all = result.items.filter((i) => i.totp);
  if (all.length === 0) {
    text(vaultEl, `No login for ${origin} has a 2FA key saved.`);
    return;
  }
  // The account just signed in with is the one this code step is for; the
  // rest wait behind a link, so two codes are never side by side to mix up.
  const last = all.find((i) => i.id === lastId);
  const items = last && !showAll ? [last] : all.sort((a, b) => (b.id === lastId) - (a.id === lastId));
  const list = document.createElement("ul");
  for (const item of items) {
    const button = document.createElement("button");
    button.className = "item";
    button.type = "button";
    accountFace(button, item, (item.username || item.phone || "no username saved") + (item.id === lastId ? ", just signed in" : ""));
    button.addEventListener("click", () => fillCode(button, item, tabId, origin));
    const li = document.createElement("li");
    li.append(button);
    list.append(li);
  }
  const caption = document.createElement("div");
  caption.className = "caption";
  caption.textContent = "Click an account to type its current 2FA code into the page.";
  const others = all.length - items.length;
  if (others > 0) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "more";
    more.textContent = others === 1 ? "Another account…" : `${others} other accounts…`;
    more.addEventListener("click", () => {
      stopWatching();
      renderCodes(result, tabId, origin, lastId, true);
    });
    vaultEl.replaceChildren(list, more, caption);
    return;
  }
  vaultEl.replaceChildren(list, caption);
}

/** "Confirm every fill" is on: the answer is in the app, not here. */
function waitForApp() {
  text(vaultEl, "Allow it in Koffer. This fills as soon as you do.", "muted");
}

/**
 * The 2FA code goes into the page's code box when there is one. Otherwise
 * the app copies it, cleared after a minute like any other copy: most code
 * pages are a paste away.
 */
async function fillCode(button, item, tabId, origin) {
  stopWatching();
  button.disabled = true;
  try {
    const { code } = await whenAllowed(() => totpCode(item.id, origin), waitForApp);
    const out = await ext.tabs.sendMessage(tabId, { type: "fill-code", code, origin }).catch(() => null);
    if (out && out.wrongOrigin) {
      text(vaultEl, `This tab moved to ${out.wrongOrigin}. Nothing was filled. Reopen this.`);
      return;
    }
    if (out && out.filled) {
      await rememberLogin(origin, item.id);
      window.close();
      return;
    }
    await whenAllowed(() => copy(item.id, origin, "totp"), waitForApp);
    button.textContent = "Code copied";
  } catch (e) {
    text(vaultEl, `Could not get the code: ${describe(e)}`);
    return;
  }
  button.disabled = false;
}

async function fill(button, item, tabId, origin) {
  stopWatching();
  button.disabled = true;
  try {
    // Fetched at the moment of the click and handed straight to the page:
    // the popup keeps no copy, and closing it takes the values with it.
    const data = await whenAllowed(() => credentials(item.id, origin), waitForApp);
    // The origin travels with the fill so the content script can refuse if
    // the tab moved between the popup opening and this click.
    const out = await ext.tabs.sendMessage(tabId, { type: "fill", data, origin });
    if (out && out.wrongOrigin) {
      text(vaultEl, `This tab moved to ${out.wrongOrigin}. Nothing was filled. Reopen this.`);
      return;
    }
    // The page's own country picker is on another country and there is no
    // way to change it from here, so nothing was written. Saying which two
    // countries turns a dead end into one click.
    if (out && out.mismatch) {
      text(
        vaultEl,
        `This page's country is set to ${out.mismatch.shown} and your number is ${out.mismatch.wanted}. Change it on the page, then fill again.`,
        "muted"
      );
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
          : "No login form here yet. It fills as soon as one opens. Click the site's login button.",
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
    await rememberLogin(origin, item.id);
    window.close();
  } catch (e) {
    text(vaultEl, `Could not fill: ${describe(e)}`);
  }
}

/**
 * How often the open popup asks again. Unlocking the app, approving a site
 * or a login form appearing all happen elsewhere, and nothing tells the
 * popup, so it looks: a popup still saying "locked" a second after you
 * unlocked reads as broken.
 */
const WATCH_MS = 1000;
let watching = true;
let watchTimer = null;

/** A click in the popup is the user acting on what is shown; keep it still. */
function stopWatching() {
  watching = false;
  clearTimeout(watchTimer);
}

/** What each part currently shows, so a tick redraws only on a change. */
let shownPage = null;
let shownVault = null;

/**
 * Work out what the popup should say, and draw it only when that differs
 * from what is already there -- redrawing every tick would wipe the pairing
 * box mid-typing and the "the app is asking" note.
 */
async function tick(tab) {
  const state = await pageState(tab.id);
  const pageKey = JSON.stringify(state);
  if (pageKey !== shownPage) {
    shownPage = pageKey;
    renderPage(state);
  }

  let key;
  let draw;
  try {
    // A reply at all means the vault is open and this token still works;
    // anything else throws, and there is no third answer to read.
    await status();
    if (!state) {
      // The vault is fine; this page just has no content script. Say only
      // that. Suggesting a reload was wrong more often than right — most
      // pages without a content script are chrome:// or the extensions
      // page, where there is nothing to fill however often you reload.
      key = "connected";
      draw = () => text(vaultEl, "Vault connected.", "muted");
    } else {
      const result = await matches(state.origin);
      if (result.needsApproval) {
        key = "approve:" + state.origin;
        draw = () => renderApproval(result, state.origin);
      } else if (!state.login && state.codeBox) {
        const lastId = await lastLogin(state.origin);
        key = "codes:" + state.origin + ":" + lastId + ":" + result.items.filter((i) => i.totp).map((i) => i.id).join(",");
        draw = () => renderCodes(result, tab.id, state.origin, lastId);
      } else if (!state.login && state.personal >= PERSONAL_MIN && result.personal) {
        // A sign-up or any other form asking who you are: the profile card.
        key = "personal:" + state.origin;
        draw = () => renderItems({ items: [] }, tab.id, state.origin, true);
      } else if (!state.login && result.items.some(signsInElsewhere)) {
        // A page of "Sign in with ..." buttons and no form: the logins that
        // sign in through one, so the popup can point at its button.
        const providers = result.items.filter(signsInElsewhere);
        key = "providers:" + state.origin + ":" + providers.map((i) => i.id).join(",");
        draw = () => renderItems({ ...result, items: providers }, tab.id, state.origin, false);
      } else if (!state.login) {
        // No form, or already logged in: a list of accounts has nowhere to go.
        key = "noform:" + state.origin;
        draw = () => text(vaultEl, "Vault connected. Accounts show here when the page has a login form.", "muted");
      } else {
        const withCard = state.personal >= PERSONAL_MIN && result.personal;
        key = "items:" + state.origin + ":" + withCard + ":" + result.items.map((i) => i.id + (i.fillable ? "+" : "")).join(",");
        draw = () => renderItems(result, tab.id, state.origin, withCard);
      }
    }
  } catch (e) {
    if (e.message !== NOT_PAIRED) {
      key = "error:" + e.message;
      draw = () => text(vaultEl, describe(e));
    } else if (await isPaired()) {
      // Never paired is a different thing from paired-and-refused, and only
      // this side knows which: the app answers both the same way.
      key = "unavailable";
      draw = renderUnavailable;
    } else {
      key = "pairing";
      draw = renderPairing;
    }
  }
  if (watching && key !== shownVault) {
    shownVault = key;
    draw();
  }
}

async function main() {
  const tab = await activeTab();
  if (!tab || tab.id === undefined) {
    text(pageEl, "No active tab.");
    text(vaultEl, "");
    return;
  }
  const loop = async () => {
    await tick(tab);
    if (watching) watchTimer = setTimeout(loop, WATCH_MS);
  };
  loop();
}

main();

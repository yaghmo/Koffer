/**
 * background.js — service worker. Turns "this tab is showing a login" into
 * a badge on the toolbar icon and a right-click menu on its fields.
 *
 * The badge is the whole notification: one quiet dot per tab, not an OS
 * popup on every sign-in page. Clicking it opens the popup, which is where
 * anything normally happens.
 *
 * The right-click menu exists because the popup is unreachable in exactly
 * the window that needs it most. "Sign in with Google" opens a `window.open`
 * popup with no toolbar, so there is no icon to click — but a context menu
 * still works there.
 *
 * # Two MV3 facts this file is built around
 *
 * **The worker is killed whenever it is idle**, taking every variable with
 * it, so what a tab detected is kept in `chrome.storage.session` rather
 * than in memory. Session storage is in-memory and extension-only, which
 * suits an origin that should not be written to disk.
 *
 * **Detection flaps.** The content script re-runs on DOM mutation, and a
 * single-page app rebuilding its login modal briefly reports no password
 * box at all. Clearing on every `login:false` made the badge and the menu
 * blink out mid-use, so nothing is cleared until the tab actually
 * navigates.
 *
 * A third fact, learned the hard way: **context menus do not survive the
 * worker being killed**, and nothing re-creates them on its own. On a page
 * that does not mutate — an OAuth popup sitting there waiting — the menu
 * would simply vanish and only come back if you reloaded the page. So the
 * menu is rebuilt when this file is evaluated, which happens on every
 * revival, and whenever the focused window changes: `tabs.onActivated` does
 * not fire for a window switch, so without that the menu could also be left
 * showing the other window's accounts.
 */
import {
  matches,
  credentials,
  totpCode,
  whenAllowed,
  ask,
  offer,
  saveLogin,
  updateLogin,
  seen,
  never,
  keyOffer,
  saveKey,
  NOT_PAIRED,
} from "./vault.js";
import { createTracker, isFresh, sameSite, lastLoginKey, CONFIRM_MS } from "./capture.js";

/** Firefox exposes the promise-based API as `browser`; Chrome as `chrome`. */
const ext = globalThis.browser ?? globalThis.chrome;

const BADGE = "●";
const BADGE_COLOUR = "#7C9CFF";
const ROOT_ID = "pm-root";
const ASK_ID = "pm-ask";
const KEY = "tabState";

/**
 * How long a "this site is not approved" answer may be reused.
 *
 * Approval happens in the app, which has no way to tell this worker about
 * it, so a cached refusal that never expired left the menu offering to ask
 * for a site that had already been approved — forever, and raising the
 * dialog again on every click.
 */
const RECHECK_MS = 5000;
/** While waiting for someone to answer the dialog, and for how long. */
const APPROVAL_POLL_MS = 2000;
const APPROVAL_POLL_TRIES = 30;

/** Matches the app's own naming in src/lib/methods.tsx. */
const PROVIDER_LABELS = {
  google: "Google",
  github: "GitHub",
  microsoft: "Microsoft",
  apple: "Apple",
  facebook: "Facebook",
  other: "another app",
};

async function allTabState() {
  try {
    return (await ext.storage.session.get(KEY))[KEY] || {};
  } catch {
    return {};
  }
}

async function setTabState(tabId, value) {
  const all = await allTabState();
  if (value === null) delete all[tabId];
  else all[tabId] = value;
  try {
    await ext.storage.session.set({ [KEY]: all });
  } catch {
    // Session storage is unavailable; the menu simply will not survive a
    // worker restart, which is a degraded menu rather than a broken one.
  }
}

async function renderMenu(state) {
  // Read before the menu is cleared, so the clear and the rebuild stay close.
  const last = state && state.codeOnly ? await lastLogin(state.origin) : "";
  try {
    await ext.contextMenus.removeAll();
  } catch {
    return;
  }
  if (!state) return;

  // A site the user has not approved yet. The window that needs the menu most
  // is the toolbar-less OAuth popup, where there is no other way to ask, so
  // the menu offers the question rather than a list of accounts it is not
  // allowed to show.
  if (state.needsApproval) {
    ext.contextMenus.create({
      id: ASK_ID,
      title: `Approve ${state.host} in Password Manager…`,
      contexts: ["editable"],
    });
    return;
  }
  if (!state.items || state.items.length === 0) return;

  // A page asking for a 2FA code: the codes, the login just used first.
  // Its accounts have nowhere to go here.
  if (state.codeOnly) {
    // Only the account just signed in with, when that is known: two codes
    // side by side are one wrong click from the other account's.
    const all = state.items.filter((i) => i.totp);
    const lastItem = all.find((i) => i.id === last);
    const withCode = lastItem ? [lastItem] : all;
    if (withCode.length === 0) return;
    ext.contextMenus.create({ id: ROOT_ID, title: "Password Manager", contexts: ["editable"] });
    for (const item of withCode) {
      ext.contextMenus.create({
        id: `pmcode:${item.id}`,
        parentId: ROOT_ID,
        title:
          `2FA code for ${item.title}` +
          (item.username ? ` (${item.username})` : "") +
          (item.id === last ? " — just signed in" : ""),
        contexts: ["editable"],
      });
    }
    return;
  }

  ext.contextMenus.create({ id: ROOT_ID, title: "Password Manager", contexts: ["editable"] });
  for (const item of state.items) {
    ext.contextMenus.create({
      id: `pm:${item.id}`,
      parentId: ROOT_ID,
      // A provider login has nothing to type here. Clicking it points at the
      // page's "Sign in with ..." button instead.
      title: item.fillable
        ? `${item.title} — ${item.username || "no username"}`
        : `${item.title} — signs in with ${PROVIDER_LABELS[item.method] || item.method}` +
          (item.username ? ` (${item.username})` : ""),
      enabled: item.fillable || (item.method !== "credentials" && item.method !== "other"),
      contexts: ["editable"],
    });
  }
  // The code step comes after the password, often on the same site, so the
  // codes sit below the accounts rather than mixed in with them.
  for (const item of state.items.filter((i) => i.totp)) {
    ext.contextMenus.create({
      id: `pmcode:${item.id}`,
      parentId: ROOT_ID,
      title: `2FA code for ${item.title}` + (item.username ? ` (${item.username})` : ""),
      contexts: ["editable"],
    });
  }
}

/** A cached refusal goes stale; a cached list of accounts does not. */
function stale(state) {
  return state.needsApproval && Date.now() - (state.checkedAt || 0) > RECHECK_MS;
}

/** Ask the app what it has for this origin, store it, and redraw the menu. */
async function refresh(tabId, origin, codeOnly = false) {
  let found = { items: [], needsApproval: false, host: "", never: false, prompt: true };
  try {
    found = await matches(origin);
  } catch {
    // Not paired, app closed, or vault locked. The popup explains all three;
    // a menu that cannot fill anything is just noise.
  }
  const state = { origin, checkedAt: Date.now(), codeOnly, ...found };
  await setTabState(tabId, state);
  await renderMenu(state);
  return state;
}

/** `codeOnly`: the page asks for a 2FA code and has no login form. */
async function onDetectedLogin(tabId, origin, codeOnly) {
  const known = (await allTabState())[tabId];
  // Rebuilding on every mutation would hammer the bridge and race with
  // itself; the accounts for an origin do not change while you sit on it.
  // A refusal is the exception — that one changes in the app, behind our
  // back.
  //
  // The same origin can move from its sign-in to its code step, though, so
  // that much is kept up to date.
  if (known && known.origin === origin && !stale(known)) {
    if (known.codeOnly !== codeOnly) await setTabState(tabId, { ...known, codeOnly });
    await renderMenu({ ...known, codeOnly });
    return;
  }
  const state = await refresh(tabId, origin, codeOnly);
  await promptApproval(tabId, state);
}

async function lastLogin(origin) {
  const r = await sessionGet(lastLoginKey(origin));
  return r ? r.id : "";
}

function rememberLogin(origin, id) {
  if (id) return sessionSet(lastLoginKey(origin), { id, at: Date.now() });
}

/**
 * Put "Approve this site?" on the page itself, so the user does not have to
 * notice the badge and open the popup before logging in -- by the time they
 * do, the login has usually happened and nothing could be offered for it.
 *
 * It says nothing the page could not already learn: every unapproved site
 * gets the same bar, whether the vault holds anything there or not. Shown
 * once per page; "Not now" silences it until that tab loads a page again,
 * "Never" for good -- the popup still offers to approve it.
 */
async function promptApproval(tabId, state) {
  if (!state.needsApproval || !state.host || state.never || state.prompt === false) return;
  if (await sessionGet(DISMISSED_KEY + tabId)) return;
  // Already up on this page, or a save offer is using the bar.
  if (await sessionGet(OFFER_KEY + tabId)) return;
  await sessionSet(OFFER_KEY + tabId, { kind: "site", origin: state.origin, at: Date.now() });
  const view = { kind: "site", host: state.host, username: "" };
  await ext.tabs.sendMessage(tabId, { type: "offer", view }).catch(() => {});
}

/**
 * Watch for the dialog being answered.
 *
 * Nothing pushes an approval back to the extension, and the page that needs
 * the menu most — an OAuth popup — may never mutate again, so waiting for
 * the next `detect` means waiting forever. Polling ends as soon as the
 * answer changes, or gives up after a minute; the handler staying pending is
 * also what keeps the worker alive while it waits.
 */
async function waitForApproval(tabId, origin) {
  for (let i = 0; i < APPROVAL_POLL_TRIES; i++) {
    await new Promise((done) => setTimeout(done, APPROVAL_POLL_MS));
    const current = (await allTabState())[tabId];
    // The tab went away, or moved on: stop.
    if (!current || current.origin !== origin) return;
    const state = await refresh(tabId, origin, current.codeOnly);
    if (!state.needsApproval) return;
  }
}

/**
 * Offer to save a login the user just typed.
 *
 * Captures and the open offer live in `storage.session` under their own
 * keys, not in the tab state a navigation wipes: a login's success shows up
 * on the *next* page. Session storage is memory only, and a capture is
 * dropped after two minutes (`capture.js`).
 */
const CAPTURE_KEY = "capture:";
const OFFER_KEY = "offer:";
/** Tabs whose approval prompt got "Not now", until that tab loads a page again. */
const DISMISSED_KEY = "dismissed:";

async function sessionGet(key) {
  try {
    return (await ext.storage.session.get(key))[key] || null;
  } catch {
    return null;
  }
}

async function sessionSet(key, value) {
  try {
    if (value === null) await ext.storage.session.remove(key);
    else await ext.storage.session.set({ [key]: value });
  } catch {
    // No session storage: this login is simply not offered.
  }
}

const tracker = createTracker({
  store: {
    get: (tabId) => sessionGet(CAPTURE_KEY + tabId),
    set: (tabId, v) => sessionSet(CAPTURE_KEY + tabId, v),
  },
  askState: (tabId) => ext.tabs.sendMessage(tabId, { type: "state" }).catch(() => null),
  onSuccess: (tabId, capture) => offerFor(tabId, capture),
});

function hostOf(origin) {
  try {
    return new URL(origin).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Ask the app what to offer and put the bar up. */
async function offerFor(tabId, capture) {
  let res;
  try {
    res = await offer(capture.origin, capture.username, capture.password, capture.current);
  } catch (e) {
    if (e.message !== NOT_PAIRED) return; // app closed: say nothing
    // Locked, or not paired: keep the capture and let the user retry.
    await sessionSet(OFFER_KEY + tabId, { capture, kind: "locked", at: capture.at });
    return showBar(tabId, "locked", capture);
  }
  // "off": the user turned this kind of offer off in the app's Settings.
  if (res.offer === "same") return rememberLogin(capture.origin, res.id);
  if (res.offer === "never" || res.offer === "off") return;
  // A change of password matched no saved login and names no account:
  // saving it would make a login with no username.
  if (res.offer === "new" && capture.current && !capture.username) return;
  const kind = res.offer === "needsApproval" ? "approve" : res.offer;
  // `at` from the capture: an unanswered offer holds the password no longer
  // than the capture would have.
  await sessionSet(OFFER_KEY + tabId, { capture, kind, id: res.id || "", at: capture.at });
  return showBar(tabId, kind, capture);
}

function showBar(tabId, kind, capture) {
  const view = { kind, host: hostOf(capture.origin), username: capture.username };
  return ext.tabs.sendMessage(tabId, { type: "offer", view }).catch(() => {});
}

function say(tabId, text, done) {
  return ext.tabs.sendMessage(tabId, { type: "offer-say", text, done }).catch(() => {});
}

/** An offer nobody answered goes when its capture would have. */
async function dropStaleOffer(tabId) {
  const open = await sessionGet(OFFER_KEY + tabId);
  // The approval prompt holds no password; it goes with its page instead.
  if (open && open.kind !== "site" && !isFresh(open, Date.now())) await sessionSet(OFFER_KEY + tabId, null);
}

/** A button on the bar. The capture is forgotten once it is answered. */
async function onChoice(tabId, choice) {
  const open = await sessionGet(OFFER_KEY + tabId);
  if (!open) return;
  if (open.kind === "site") return onSiteChoice(tabId, open.origin, choice);
  if (open.key) return onKeyChoice(tabId, open, choice);
  if (!isFresh(open, Date.now())) {
    await sessionSet(OFFER_KEY + tabId, null);
    return say(tabId, "That was a while ago. Log in again to be offered it.", true);
  }
  const { capture, kind, id } = open;
  try {
    if (choice === "never") {
      await never(capture.origin);
    } else if (choice === "later") {
      // On an update the app remembers the password that worked.
      await seen(capture.origin, capture.username, capture.password);
    } else if (kind === "new") {
      const saved = await saveLogin(capture.origin, capture.username, capture.password);
      await rememberLogin(capture.origin, saved && saved.id);
      await say(tabId, "Saved to Password Manager.", true);
    } else if (kind === "update") {
      await updateLogin(id, capture.origin, capture.password);
      await rememberLogin(capture.origin, id);
      await say(tabId, "Password updated.", true);
    } else if (kind === "approve") {
      // The first click raises the app's dialog; the next asks again.
      await ask(capture.origin);
      await sessionSet(OFFER_KEY + tabId, { ...open, kind: "recheck" });
      return say(tabId, "Approve this site in the app, then click Save again.");
    } else {
      // "recheck" or "locked": ask the app again from the top.
      await sessionSet(OFFER_KEY + tabId, null);
      return offerFor(tabId, capture);
    }
  } catch (e) {
    return say(
      tabId,
      e.message === NOT_PAIRED
        ? "Unlock Password Manager, then click Save again."
        : "That did not work. Try again from the app."
    );
  }
  await sessionSet(OFFER_KEY + tabId, null);
}

/**
 * Offer to save a 2FA key the user has just set up.
 *
 * The app is asked straight away, while the code typed is current, and its
 * answer -- the key with it -- is held as the tab's open offer, in session
 * storage like a captured password and for as long. The bar waits until the
 * code box no longer holds that code: the site took it, or the page moved
 * on. A code typed and left sitting there is a setup not finished, and
 * gets nothing.
 */
async function onKeyCaptured(tabId, msg) {
  let res;
  try {
    res = await keyOffer(msg.origin, msg.code, msg.keys || [], msg.qr || [], await lastLogin(msg.origin));
  } catch {
    return; // ponytail: locked or app closed gets no offer; the editor's QR paste still works
  }
  const open = { key: true, origin: msg.origin, code: msg.code, at: Date.now(), shown: false };
  if (res.offer === "add") {
    await sessionSet(OFFER_KEY + tabId, { ...open, kind: "key", id: res.id, secret: res.key, username: res.username || res.title || "" });
  } else if (res.offer === "needsApproval") {
    // The page is asked again once the site is approved.
    await sessionSet(OFFER_KEY + tabId, { ...open, kind: "keyApprove", capture: msg, username: "" });
  } else if (res.offer === "hasKey") {
    // Nothing to save; said so, or a missing offer looks like a bug.
    await sessionSet(OFFER_KEY + tabId, { ...open, kind: "keyHas", username: "" });
  } else {
    return;
  }
  setTimeout(() => showKeyOffer(tabId, null), CONFIRM_MS);
}

/** Put a held 2FA offer up, once its code box has been answered. */
async function showKeyOffer(tabId, state) {
  const open = await sessionGet(OFFER_KEY + tabId);
  if (!open || !open.key || open.shown || !isFresh(open, Date.now())) return;
  if (!state) state = await ext.tabs.sendMessage(tabId, { type: "state" }).catch(() => null);
  // Between pages, or the code still sitting in its box: not yet.
  if (!state || state.code === open.code || !sameSite(open.origin, state.origin)) return;
  await sessionSet(OFFER_KEY + tabId, { ...open, shown: true });
  const view =
    open.kind === "keyHas"
      ? { kind: "keyHas", host: hostOf(open.origin), detail: "It was left as it is. If the site gave you a new key, change it in the app.", never: false }
      : { kind: "key", host: hostOf(open.origin), username: open.username };
  return ext.tabs.sendMessage(tabId, { type: "offer", view }).catch(() => {});
}

async function onKeyChoice(tabId, open, choice) {
  if (open.kind === "keyHas") {
    await sessionSet(OFFER_KEY + tabId, null);
    return choice === "save" ? say(tabId, "Nothing was changed.", true) : undefined;
  }
  if (!isFresh(open, Date.now())) {
    await sessionSet(OFFER_KEY + tabId, null);
    return say(tabId, "That was a while ago. Add the key from the app instead.", true);
  }
  try {
    if (choice === "never") {
      await never(open.origin);
    } else if (choice === "save" && open.kind === "keyApprove") {
      await ask(open.origin);
      await sessionSet(OFFER_KEY + tabId, { ...open, kind: "keyRecheck" });
      return say(tabId, "Approve this site in the app, then click Save again.");
    } else if (choice === "save") {
      let { id, secret } = open;
      if (open.kind === "keyRecheck") {
        const c = open.capture;
        const res = await keyOffer(c.origin, c.code, c.keys || [], c.qr || [], await lastLogin(c.origin));
        if (res.offer === "needsApproval") return say(tabId, "Approve this site in the app, then click Save again.");
        if (res.offer !== "add") {
          await sessionSet(OFFER_KEY + tabId, null);
          return say(tabId, "No saved login here can take this key. Add it from the app.", true);
        }
        ({ id, key: secret } = res);
      }
      await saveKey(id, open.origin, secret);
      await say(tabId, "2FA key saved. Password Manager has this site's codes now.", true);
    }
  } catch (e) {
    return say(
      tabId,
      e.message === NOT_PAIRED ? "Unlock Password Manager, then click Save again." : "That did not work. Add the key from the app."
    );
  }
  await sessionSet(OFFER_KEY + tabId, null);
}

/** A button on the approval prompt. It holds no secret, so it never goes stale. */
async function onSiteChoice(tabId, origin, choice) {
  await sessionSet(OFFER_KEY + tabId, null);
  if (choice === "never") {
    // The vault's never list: no prompt here and no offer to save, until
    // the site is approved from the popup or taken off the list in the app.
    await never(origin).catch(() => {});
    return refresh(tabId, origin);
  }
  // "Not now" is for this page: a reload asks again.
  if (choice !== "save") return sessionSet(DISMISSED_KEY + tabId, true);
  let answer;
  try {
    answer = await ask(origin);
  } catch {
    return say(tabId, "Unlock Password Manager, then try again from the toolbar icon.", true);
  }
  if (answer && answer.approved) {
    await refresh(tabId, origin);
    return say(tabId, "Already approved.", true);
  }
  await say(tabId, "Say yes in the Password Manager window.", true);
  await waitForApproval(tabId, origin);
}

ext.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab && sender.tab.id;
  if (!msg || tabId === undefined) return false;
  if (msg.type === "captured") {
    tracker.captured(tabId, {
      origin: msg.origin,
      username: msg.username || "",
      password: msg.password || "",
      current: msg.current || "",
    });
    return false;
  }
  if (msg.type === "captured-key") {
    onKeyCaptured(tabId, msg);
    return false;
  }
  if (msg.type === "offer-choice") {
    onChoice(tabId, msg.choice);
    return false;
  }
  if (msg.type !== "detect") return false;
  tracker.detected(tabId, msg);
  dropStaleOffer(tabId);
  showKeyOffer(tabId, msg);
  if (msg.login || msg.codeBox) {
    ext.action.setBadgeText({ tabId, text: BADGE });
    ext.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOUR });
    onDetectedLogin(tabId, msg.origin, !msg.login);
    return false;
  }
  // A `login:false` on the *same* origin is usually the page rebuilding its
  // own form rather than the form going away, and acting on it made the
  // badge flicker out while the user was looking at a login box. A
  // `login:false` from a different origin is a navigation, which is the one
  // moment the old verdict is certainly stale.
  //
  // `tabs.onUpdated` covers that too, but its payload is trimmed without the
  // "tabs" permission, so this does not lean on it: a menu left showing the
  // last site's usernames is a leak even when it cannot fill anything.
  forgetIfMoved(tabId, msg.origin);
  return false;
});

async function forgetIfMoved(tabId, origin) {
  const known = (await allTabState())[tabId];
  if (!known || known.origin === origin) return;
  ext.action.setBadgeText({ tabId, text: "" });
  await setTabState(tabId, null);
  ext.contextMenus.removeAll().catch(() => {});
}

/** A real navigation is the one moment the old verdict is certainly stale. */
ext.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading") return;
  ext.action.setBadgeText({ tabId, text: "" });
  setTabState(tabId, null);
  dropSitePrompt(tabId);
  sessionSet(DISMISSED_KEY + tabId, null);
  ext.contextMenus.removeAll().catch(() => {});
});

/** The approval prompt belongs to one page; a save offer outlives it. */
async function dropSitePrompt(tabId) {
  const open = await sessionGet(OFFER_KEY + tabId);
  if (open && open.kind === "site") await sessionSet(OFFER_KEY + tabId, null);
}

ext.tabs.onRemoved.addListener((tabId) => {
  setTabState(tabId, null);
  sessionSet(CAPTURE_KEY + tabId, null);
  sessionSet(OFFER_KEY + tabId, null);
  sessionSet(DISMISSED_KEY + tabId, null);
});

/**
 * Context menus are global, not per-tab, so switching tabs has to swap the
 * menu over rather than leave the previous page's accounts on it.
 */
ext.tabs.onActivated.addListener(async ({ tabId }) => {
  renderMenu((await allTabState())[tabId]);
});

/** Redraw for whichever tab is in front, wherever that is. */
async function renderForActiveTab(windowId) {
  try {
    const query = windowId === undefined ? { active: true, lastFocusedWindow: true } : { active: true, windowId };
    const [tab] = await ext.tabs.query(query);
    if (!tab || tab.id === undefined) return;
    await renderMenu((await allTabState())[tab.id]);
  } catch {
    // No window to draw for yet.
  }
}

/**
 * Switching windows does not switch tabs, so `onActivated` never fires for
 * it — and the menu is global. Without this, moving from an OAuth popup back
 * to the page that opened it leaves the popup's accounts on the menu.
 */
if (ext.windows && ext.windows.onFocusChanged) {
  ext.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === ext.windows.WINDOW_ID_NONE) return;
    renderForActiveTab(windowId);
  });
}

// Runs on every revival of the worker, which is the only moment the menus it
// created are known to be gone.
renderForActiveTab();

ext.contextMenus.onClicked.addListener(async (info, tab) => {
  const id = String(info.menuItemId || "");
  if (!tab || tab.id === undefined) return;
  if (id === ASK_ID) {
    const state = (await allTabState())[tab.id];
    if (!state || !state.origin) return;
    let answer;
    try {
      answer = await ask(state.origin);
    } catch {
      // Locked, unpaired, or the app is gone. The popup says which.
      return;
    }
    // Already approved: the menu was showing a refusal the app had since
    // taken back. Redraw rather than leaving it there.
    if (answer && answer.approved) {
      await refresh(tab.id, state.origin);
      return;
    }
    await waitForApproval(tab.id, state.origin);
    return;
  }
  if (id.startsWith("pmcode:")) {
    const state = (await allTabState())[tab.id];
    if (!state || !state.origin) return;
    try {
      const { code } = await whenAllowed(() => totpCode(id.slice(7), state.origin));
      await ext.tabs.sendMessage(tab.id, { type: "fill-code", code, origin: state.origin });
    } catch {
      // Same as a password from the menu: nowhere to say why.
    }
    return;
  }
  if (!id.startsWith("pm:")) return;
  // Read back rather than trusting a variable: the worker may have been
  // killed and restarted between building this menu and clicking it.
  const state = (await allTabState())[tab.id];
  if (!state || !state.origin) return;
  const picked = (state.items || []).find((i) => i.id === id.slice(3));
  if (picked && !picked.fillable) {
    const name = PROVIDER_LABELS[picked.method] || picked.method;
    const note = `You sign in here with ${name}` + (picked.username ? ` as ${picked.username}` : "") + ".";
    await ext.tabs.sendMessage(tab.id, { type: "highlight-provider", method: picked.method, note }).catch(() => {});
    return;
  }
  try {
    const data = await whenAllowed(() => credentials(id.slice(3), state.origin));
    // Reaching the tab works here on `activeTab` alone: executing a context
    // menu item grants it, exactly as clicking the toolbar icon does. That
    // is why building the menu never touches the tab and only the click
    // does.
    //
    // The origin goes with it: if this tab is no longer the one the menu was
    // built for, the content script drops the fill rather than typing a
    // password into whatever is there now.
    const out = await ext.tabs.sendMessage(tab.id, { type: "fill", data, origin: state.origin });
    if (out && out.filled && out.filled.length > 0) await rememberLogin(state.origin, id.slice(3));
  } catch {
    // Locked, unpaired, or refused. There is no surface to report it on in a
    // toolbar-less window, and the popup says why when it can be opened.
  }
});

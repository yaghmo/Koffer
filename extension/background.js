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
import { matches, credentials, ask } from "./vault.js";

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

  ext.contextMenus.create({ id: ROOT_ID, title: "Password Manager", contexts: ["editable"] });
  for (const item of state.items) {
    ext.contextMenus.create({
      id: `pm:${item.id}`,
      parentId: ROOT_ID,
      // A provider login has nothing to type here; it is listed anyway, and
      // greyed out, for the same reason the popup lists it — to remind you
      // which account you used.
      title: item.fillable
        ? `${item.title} — ${item.username || "no username"}`
        : `${item.title} — signs in with ${PROVIDER_LABELS[item.method] || item.method}` +
          (item.username ? ` (${item.username})` : ""),
      enabled: !!item.fillable,
      contexts: ["editable"],
    });
  }
}

/** A cached refusal goes stale; a cached list of accounts does not. */
function stale(state) {
  return state.needsApproval && Date.now() - (state.checkedAt || 0) > RECHECK_MS;
}

/** Ask the app what it has for this origin, store it, and redraw the menu. */
async function refresh(tabId, origin) {
  let found = { items: [], needsApproval: false, host: "" };
  try {
    found = await matches(origin);
  } catch {
    // Not paired, app closed, or vault locked. The popup explains all three;
    // a menu that cannot fill anything is just noise.
  }
  const state = { origin, checkedAt: Date.now(), ...found };
  await setTabState(tabId, state);
  await renderMenu(state);
  return state;
}

async function onDetectedLogin(tabId, origin) {
  const known = (await allTabState())[tabId];
  // Rebuilding on every mutation would hammer the bridge and race with
  // itself; the accounts for an origin do not change while you sit on it.
  // A refusal is the exception — that one changes in the app, behind our
  // back.
  if (known && known.origin === origin && !stale(known)) {
    await renderMenu(known);
    return;
  }
  await refresh(tabId, origin);
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
    const state = await refresh(tabId, origin);
    if (!state.needsApproval) return;
  }
}

ext.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "detect") return false;
  const tabId = sender.tab && sender.tab.id;
  if (tabId === undefined) return false;
  if (msg.login) {
    ext.action.setBadgeText({ tabId, text: BADGE });
    ext.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOUR });
    onDetectedLogin(tabId, msg.origin);
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
  ext.contextMenus.removeAll().catch(() => {});
});

ext.tabs.onRemoved.addListener((tabId) => setTabState(tabId, null));

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
  if (!id.startsWith("pm:")) return;
  // Read back rather than trusting a variable: the worker may have been
  // killed and restarted between building this menu and clicking it.
  const state = (await allTabState())[tab.id];
  if (!state || !state.origin) return;
  try {
    const data = await credentials(id.slice(3), state.origin);
    // Reaching the tab works here on `activeTab` alone: executing a context
    // menu item grants it, exactly as clicking the toolbar icon does. That
    // is why building the menu never touches the tab and only the click
    // does.
    //
    // The origin goes with it: if this tab is no longer the one the menu was
    // built for, the content script drops the fill rather than typing a
    // password into whatever is there now.
    await ext.tabs.sendMessage(tab.id, { type: "fill", data, origin: state.origin });
  } catch {
    // Locked, unpaired, or refused. There is no surface to report it on in a
    // toolbar-less window, and the popup says why when it can be opened.
  }
});

/**
 * background.js — service worker. Turns "this tab is showing a login" into
 * a badge on the toolbar icon and a right-click menu on its fields.
 *
 * The badge is the whole notification: one quiet dot per tab, not an OS
 * popup on every sign-in page. Clicking it opens the popup, which is where
 * anything actually happens.
 *
 * The right-click menu exists because the popup is unreachable in exactly
 * the window that needs it most. "Sign in with Google" opens a `window.open`
 * popup with no toolbar, so there is no icon to click — but a context menu
 * still works there.
 *
 * Context menus are global, not per-tab, so this one can go stale when you
 * switch tabs without navigating. That is safe rather than merely unlikely:
 * the origin the menu was built for travels with the fill, and the content
 * script refuses when it no longer matches the page it is running in.
 */
import { matches, credentials } from "./vault.js";

/** Firefox exposes the promise-based API as `browser`; Chrome as `chrome`. */
const ext = globalThis.browser ?? globalThis.chrome;

const BADGE = "●";
const BADGE_COLOUR = "#7C9CFF";
const ROOT_ID = "pm-root";

/** Matches the app's own naming in src/lib/methods.tsx. */
const PROVIDER_LABELS = {
  google: "Google",
  github: "GitHub",
  microsoft: "Microsoft",
  apple: "Apple",
  facebook: "Facebook",
  other: "another app",
};

/** What the menu currently describes, so a click can be checked against it. */
let built = { origin: null, items: [] };

async function clearMenu() {
  built = { origin: null, items: [] };
  try {
    await ext.contextMenus.removeAll();
  } catch {
    // Nothing to remove, or the worker is shutting down.
  }
}

async function buildMenu(origin) {
  let found;
  try {
    found = await matches(origin);
  } catch {
    // Not paired, app closed, or vault locked. The popup explains all three;
    // a menu that cannot fill anything is just noise.
    await clearMenu();
    return;
  }
  await clearMenu();
  if (found.length === 0) return;

  built = { origin, items: found };
  ext.contextMenus.create({
    id: ROOT_ID,
    title: "Password Manager",
    contexts: ["editable"],
  });
  for (const item of found) {
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

ext.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "detect") return false;
  const tabId = sender.tab && sender.tab.id;
  if (tabId === undefined) return false;
  ext.action.setBadgeText({ tabId, text: msg.login ? BADGE : "" });
  if (msg.login) {
    ext.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOUR });
    // Only login pages reach the vault. Querying on every page would put
    // every site visited through the bridge for nothing.
    buildMenu(msg.origin);
  } else {
    clearMenu();
  }
  return false;
});

ext.contextMenus.onClicked.addListener(async (info, tab) => {
  const id = String(info.menuItemId || "");
  if (!id.startsWith("pm:") || !tab || tab.id === undefined) return;
  const itemId = id.slice(3);
  const origin = built.origin;
  if (!origin) return;
  try {
    const data = await credentials(itemId, origin);
    // Reaching the tab works here on `activeTab` alone: executing a context
    // menu item grants it, exactly as clicking the toolbar icon does. That
    // is why building the menu never touches the tab and only the click
    // does.
    //
    // The origin goes with it: if this tab is no longer the one the menu was
    // built for, the content script drops the fill rather than typing a
    // password into whatever is there now.
    await ext.tabs.sendMessage(tab.id, { type: "fill", data, origin });
  } catch {
    // Locked, unpaired, or refused. There is no surface to report it on in a
    // toolbar-less window, and the popup says why when it can be opened.
  }
});

// A tab that goes away should not leave its menu behind for the next one.
ext.tabs.onActivated.addListener(clearMenu);

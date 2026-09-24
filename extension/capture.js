/**
 * capture.js — did the login the user just submitted work?
 *
 * The extension cannot see the site's answer, so it watches the page: a
 * login that worked makes the form go away. "Gone" has to hold for
 * `CONFIRM_MS`, because single-page apps briefly drop their form while
 * rebuilding it. A wrong password leaves the form up, so nothing is ever
 * offered for it; the capture expires, or the next attempt replaces it.
 *
 * Kept free of `chrome.*` so it can be tested: the caller supplies storage,
 * a way to ask a tab for its state, and timers.
 */

/** How long a captured login is held. Never longer: it is a password. */
export const HOLD_MS = 120000;

/** How long the form must stay gone before the login counts as working. */
export const CONFIRM_MS = 1500;

/**
 * The registrable part of a host, near enough without the Public Suffix
 * List: the last two labels, or three when the second-to-last is a short
 * second level like `co` in `co.uk`.
 *
 * ponytail: heuristic, wrong for suffixes like `github.io` (two users' pages
 * count as one site); the app still checks every write against the real
 * PSL, so the cost is at worst a pointless offer. Swap in a PSL if that
 * shows up.
 */
function siteOf(origin) {
  let host;
  try {
    host = new URL(origin).hostname;
  } catch {
    return "";
  }
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const shortSecond = labels[labels.length - 1].length === 2 && labels[labels.length - 2].length <= 3;
  return labels.slice(shortSecond ? -3 : -2).join(".");
}

export function sameSite(a, b) {
  const s = siteOf(a);
  return s !== "" && s === siteOf(b);
}

export function createTracker({ store, askState, onSuccess, now = Date.now, setTimer = (fn, ms) => setTimeout(fn, ms) }) {
  async function live(tabId) {
    const c = await store.get(tabId);
    if (!c) return null;
    if (now() - c.at > HOLD_MS) {
      await store.set(tabId, null);
      return null;
    }
    return c;
  }

  return {
    /** A form was submitted. The newest attempt replaces any earlier one. */
    async captured(tabId, capture) {
      await store.set(tabId, { ...capture, at: now() });
    },

    /** The tab reported whether it shows a login form. */
    async detected(tabId, msg) {
      const c = await live(tabId);
      if (!c || msg.login || !sameSite(c.origin, msg.origin)) return;
      const at = c.at;
      setTimer(async () => {
        const again = await live(tabId);
        // Replaced by a newer attempt, or already handled.
        if (!again || again.at !== at) return;
        const state = await askState(tabId);
        if (!state || state.login || !sameSite(again.origin, state.origin)) return;
        await store.set(tabId, null);
        onSuccess(tabId, again);
      }, CONFIRM_MS);
    },

    /** Take a capture out, e.g. after the bar was answered. */
    async take(tabId) {
      const c = await live(tabId);
      await store.set(tabId, null);
      return c;
    },
  };
}

/**
 * capture.js — did the login the user just submitted work?
 *
 * The extension cannot see the site's answer, so it watches the page: a
 * login that worked makes every password box go away. "Gone" has to hold
 * for `CONFIRM_MS`, because single-page apps briefly drop their form while
 * rebuilding it. A wrong password leaves the form up, so nothing is offered
 * for it; and when a freshly loaded page serves the password box again --
 * the server answered with the form -- the attempt is dropped, so wandering
 * off afterwards cannot make it look like a success.
 *
 * Step one of a two-step sign-in (username, then password on the next
 * page) is held as a username alone, and lent to the password step.
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

/** Is an open offer, or a capture, still young enough to act on? */
export function isFresh(record, now) {
  return !!record && now - record.at <= HOLD_MS;
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
      if (!capture.password && !capture.username) return;
      const next = { ...capture };
      const prev = await live(tabId);
      // The password step of a two-step sign-in: borrow step one's username.
      if (next.password && !next.username && prev && !prev.password && sameSite(prev.origin, next.origin)) {
        next.username = prev.username;
      }
      await store.set(tabId, { ...next, at: now() });
    },

    /** The tab reported whether it shows a login form, and its password boxes. */
    async detected(tabId, msg) {
      const c = await live(tabId);
      if (!c || !c.password || !sameSite(c.origin, msg.origin)) return;
      if (msg.passwords !== 0) {
        // A new page came back with a password box: the site served the
        // form again, which is what a rejected password looks like.
        if (msg.fresh) await store.set(tabId, null);
        return;
      }
      const at = c.at;
      setTimer(async () => {
        const again = await live(tabId);
        // Replaced by a newer attempt, or already handled.
        if (!again || again.at !== at) return;
        const state = await askState(tabId);
        if (!state || state.passwords !== 0 || !sameSite(again.origin, state.origin)) return;
        await store.set(tabId, null);
        onSuccess(tabId, again);
      }, CONFIRM_MS);
    },

  };
}

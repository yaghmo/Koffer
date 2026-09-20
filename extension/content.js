/**
 * content.js — decides whether the page is showing a login, tells the
 * service worker, and fills on request.
 *
 * `autofill.js` runs first and owns both the DOM reading and the verdict;
 * this file only supplies the URL and the plumbing.
 *
 * Nothing here holds a credential except in one case, spelled out at
 * `pending` below: a fill that arrived before the form that takes it
 * existed.
 */
(function () {
  "use strict";

  /** Firefox exposes the promise-based API as `browser`; Chrome as `chrome`. */
  var ext = globalThis.browser || globalThis.chrome;

  /** SPAs mount the form after load, so detection has to re-run on change. */
  var SETTLE_MS = 400;

  /**
   * How long a fill may wait for the form it is meant for.
   *
   * Long enough to type an email address and click Next, or to click a
   * site's own "Log in" button; short enough that a page left open does not
   * keep it.
   */
  var PENDING_MS = 60000;

  /** Floor between two attempts, so a page that mutates hard is not hot. */
  var PENDING_THROTTLE_MS = 50;

  /**
   * A fill with nowhere to go yet.
   *
   * Two shapes of the same problem. Step one of a two-step login (Google,
   * Microsoft) shows the identifier box and nothing else. A site like Twitch
   * shows no login form at all until you click its own button and a modal
   * mounts. Either way the popup has closed by the time the field exists,
   * and this is what writes into it when it turns up.
   *
   * It holds *everything* that did not land, not just the password. Holding
   * only the password is what filled Twitch's modal with a password and left
   * the username box empty.
   *
   * Only within the same document: a next step that arrives as a real page
   * load tears this script down and takes the values with it, and that page
   * is filled from the popup like any other.
   *
   * It lives in the isolated world, which the page's own scripts cannot
   * read, and it is dropped on the first successful write, after PENDING_MS,
   * when the origin changes, and when the page goes away. Holding a password
   * in memory at all is a real cost; it buys the only version of this flow
   * that finishes.
   */
  var pending = null;
  var pendingTimer = null;
  var lastAttempt = 0;

  function clearPending() {
    pending = null;
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  function armPending(data) {
    clearPending();
    pending = { data: data, origin: location.origin };
    pendingTimer = setTimeout(clearPending, PENDING_MS);
  }

  function fillPending() {
    if (!pending) return;
    var at = Date.now();
    if (at - lastAttempt < PENDING_THROTTLE_MS) return;
    lastAttempt = at;
    // A redirect while waiting is exactly the case where writing blind would
    // type the password into somebody else's form.
    if (pending.origin !== location.origin) {
      clearPending();
      return;
    }
    // Exactly one password box is a sign-in, which is the same rule
    // `isLogin` uses. None means the form still is not here. Two or more is
    // a sign-up, and a saved login must not be typed into one.
    if (window.Autofill.detect(document).passwords !== 1) return;
    var out = window.Autofill.fill(document, pending.data);
    if (out.filled.length > 0) clearPending();
  }

  function isLoginPage() {
    return window.Autofill.isLogin(window.Autofill.detect(document), location.href);
  }

  function report() {
    try {
      var sent = ext.runtime.sendMessage({
        type: "detect",
        login: isLoginPage(),
        origin: location.origin,
      });
      // MV3 hands back a promise in both browsers, and it rejects whenever
      // the worker is asleep or gone. Unhandled, that fills the page's own
      // console with our noise.
      if (sent && typeof sent.catch === "function") sent.catch(function () {});
    } catch (e) {
      // The worker restarts on its own schedule; the next report catches up.
    }
  }

  var timer = null;
  function reportSoon() {
    clearTimeout(timer);
    timer = setTimeout(report, SETTLE_MS);
  }

  ext.runtime.onMessage.addListener(function (msg, _sender, respond) {
    if (msg && msg.type === "state") {
      respond({ login: isLoginPage(), origin: location.origin });
      return false;
    }
    if (msg && msg.type === "fill") {
      // The popup read this tab's origin when it opened and the app checked
      // the item against *that* origin. If the tab has navigated since --
      // a slow redirect, a meta refresh -- filling now would type the
      // password into a different site. Only this script knows where the
      // page actually is at the moment of the fill, so the check belongs
      // here and nowhere else.
      if (msg.origin !== location.origin) {
        clearPending();
        respond({ formFound: false, filled: [], missing: [], wrongOrigin: location.origin });
        return false;
      }
      var out = window.Autofill.fill(document, msg.data);
      // Whatever was asked for and is not in the page now. `missing` uses
      // the same names as the data keys, so this is the leftover fill.
      var leftover = {};
      out.missing.forEach(function (name) {
        var value = msg.data[name];
        if (value !== undefined && value !== null && String(value) !== "") {
          leftover[name] = value;
        }
      });
      // A password with no password box to put it in means the form is not
      // here yet -- the second step of a two-step login, or a modal the site
      // has not opened. Anything else is a form that refused the value, and
      // retrying harder does not beat a page that is actively clearing it.
      var deferred =
        leftover.password !== undefined &&
        window.Autofill.detect(document).passwords === 0;
      if (deferred) armPending(leftover);
      else clearPending();
      // Only field names and counts go back — never the values that were
      // written, which would put the password back on the message channel
      // for no reason.
      respond({
        formFound: out.formFound,
        filled: out.filled.map(function (f) {
          return f.field;
        }),
        missing: out.missing,
        deferred: deferred,
      });
      return false;
    }
    return false;
  });

  // Leaving the page is the end of any pending fill, whether or not this
  // script is torn down with it -- a cached page restored by the back button
  // would otherwise still be holding it.
  window.addEventListener("pagehide", clearPending);

  report();
  // `fillPending` is not debounced: the whole point is that the field is
  // written the moment it appears, and waiting out a settle timer that every
  // further mutation resets is exactly how it ended up feeling slow. It
  // costs one null check when nothing is waiting, which is almost always.
  //
  // Attributes are watched as well as nodes because a login modal is as
  // likely to be revealed by a class change as mounted, and because the
  // site's own "show password" eye flips `type` without touching the tree.
  new MutationObserver(function () {
    fillPending();
    reportSoon();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "type"],
  });
})();

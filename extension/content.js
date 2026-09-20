/**
 * content.js — decides whether the page is showing a login, tells the
 * service worker, and fills on request.
 *
 * `autofill.js` runs first and owns both the DOM reading and the verdict;
 * this file only supplies the URL and the plumbing.
 *
 * Nothing here holds a credential except in one case, spelled out at
 * `pending` below: the second step of a two-step login, where the password
 * arrives before the box that takes it exists.
 */
(function () {
  "use strict";

  /** Firefox exposes the promise-based API as `browser`; Chrome as `chrome`. */
  var ext = globalThis.browser || globalThis.chrome;

  /** SPAs mount the form after load, so detection has to re-run on change. */
  var SETTLE_MS = 400;

  /**
   * How long a password may wait for the second step of a two-step login.
   *
   * Long enough to type an email address and click Next; short enough that
   * a page left open does not keep it.
   */
  var PENDING_MS = 60000;

  /**
   * A password with nowhere to go yet.
   *
   * Step one of a two-step login (Google, Microsoft) shows the identifier
   * box and nothing else, so the password that came with the fill lands in
   * no field at all -- the popup has closed by the time the password box
   * exists. This is what writes it when the second step mounts.
   *
   * Only the SPA case: a step two that arrives as a real page load tears
   * this script down and takes the value with it, and the user fills that
   * page from the popup like any other.
   *
   * It lives in the isolated world, which the page's own scripts cannot
   * read, and it is dropped on the first successful write, after PENDING_MS,
   * or the moment the origin changes. Holding a password in memory at all is
   * a real cost; it buys the only version of this flow that finishes.
   */
  var pending = null;
  var pendingTimer = null;

  function clearPending() {
    pending = null;
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  function armPending(password) {
    clearPending();
    pending = { password: password, origin: location.origin };
    pendingTimer = setTimeout(clearPending, PENDING_MS);
  }

  function fillPending() {
    if (!pending) return;
    // A redirect between the two steps is exactly the case where writing
    // blind would type the password into somebody else's form.
    if (pending.origin !== location.origin) {
      clearPending();
      return;
    }
    if (window.Autofill.detect(document).passwords === 0) return;
    var out = window.Autofill.fill(document, { password: pending.password });
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
    timer = setTimeout(function () {
      fillPending();
      report();
    }, SETTLE_MS);
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
      // Nothing took the password and there is no password box on the page:
      // this is step one of a two-step login, not a form that refused the
      // value. Hold it for the step that asks.
      var twoStep =
        !!msg.data.password &&
        out.missing.indexOf("password") !== -1 &&
        window.Autofill.detect(document).passwords === 0;
      if (twoStep) armPending(msg.data.password);
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
        twoStep: twoStep,
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
  new MutationObserver(reportSoon).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();

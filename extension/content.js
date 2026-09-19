/**
 * content.js — decides whether the page is showing a login, tells the
 * service worker, and fills on request.
 *
 * `autofill.js` runs first and owns both the DOM reading and the verdict;
 * this file only supplies the URL and the plumbing.
 *
 * Nothing here ever holds a credential: `fill` receives values, writes them
 * into the page and keeps no copy.
 */
(function () {
  "use strict";

  /** Firefox exposes the promise-based API as `browser`; Chrome as `chrome`. */
  var ext = globalThis.browser || globalThis.chrome;

  /** SPAs mount the form after load, so detection has to re-run on change. */
  var SETTLE_MS = 400;

  function isLoginPage() {
    return window.Autofill.isLogin(window.Autofill.detect(document), location.href);
  }

  function report() {
    try {
      var sent = ext.runtime.sendMessage({ type: "detect", login: isLoginPage() });
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
        respond({ formFound: false, filled: [], missing: [], wrongOrigin: location.origin });
        return false;
      }
      var out = window.Autofill.fill(document, msg.data);
      // Only field names and counts go back — never the values that were
      // written, which would put the password back on the message channel
      // for no reason.
      respond({
        formFound: out.formFound,
        filled: out.filled.map(function (f) {
          return f.field;
        }),
        missing: out.missing,
      });
      return false;
    }
    return false;
  });

  report();
  new MutationObserver(reportSoon).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();

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

  /** SPAs mount the form after load, so detection has to re-run on change. */
  var SETTLE_MS = 400;

  function isLoginPage() {
    return window.Autofill.isLogin(window.Autofill.detect(document), location.href);
  }

  function report() {
    try {
      chrome.runtime.sendMessage({ type: "detect", login: isLoginPage() });
    } catch (e) {
      // The worker restarts on its own schedule; the next report catches up.
    }
  }

  var timer = null;
  function reportSoon() {
    clearTimeout(timer);
    timer = setTimeout(report, SETTLE_MS);
  }

  chrome.runtime.onMessage.addListener(function (msg, _sender, respond) {
    if (msg && msg.type === "state") {
      respond({ login: isLoginPage(), origin: location.origin });
      return false;
    }
    if (msg && msg.type === "fill") {
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

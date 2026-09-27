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

  /**
   * The first report of this document is `fresh`: the page just loaded.
   * A fresh page that still has a password box after a login attempt is
   * the site serving the form again, which is how a rejected password
   * looks after a full reload.
   */
  var reported = false;

  function boxes() {
    return window.Autofill.detect(document);
  }

  function report() {
    try {
      var fresh = !reported;
      reported = true;
      var found = boxes();
      var sent = ext.runtime.sendMessage({
        type: "detect",
        login: isLoginPage(),
        origin: location.origin,
        passwords: found.passwords,
        filled: found.filled,
        fresh: fresh,
        code: window.Autofill.typedCode(document),
        codeBox: window.Autofill.hasCodeBox(document),
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

  /**
   * Buttons that look like they send a login. Many sites use a plain
   * `type="button"` with a click handler rather than a form submit.
   */
  // English first, then French, German, Spanish, Italian, Portuguese and
  // Arabic. A form's own submit and Enter need no words; only a formless
  // button does, and a word missing here costs a missed offer, nothing more.
  var SUBMITTISH = new RegExp(
    [
      "log\\s?in|sign\\s?(in|up)|register|continue|next|submit|create|join|save|change|update|confirm",
      "connexion|connecter|inscri|valider|continuer|suivant|enregistrer|modifier|mettre à jour|confirmer",
      "anmelden|einloggen|registrieren|weiter|speichern|ändern|bestätigen",
      "iniciar|acceder|entrar|registr|siguiente|guardar|cambiar|actualizar|confirmar",
      "accedi|registrati|avanti|salva|cambia|aggiorna|conferma",
      "salvar|alterar|atualizar|próximo",
      "دخول|تسجيل|متابعة|التالي|حفظ|تغيير|تحديث|تأكيد",
    ].join("|"),
    "i"
  );

  /**
   * Hand a submitted login to the background script and keep nothing.
   * Every attempt is sent; the background keeps only the newest, so a click
   * on the page's own eye toggle is harmless -- its form never goes away,
   * so it is never offered.
   */
  function capture(from) {
    var scope = (from && from.closest && from.closest("form")) || document;
    var got = window.Autofill.captured(scope);
    if (!got) return;
    try {
      var sent = ext.runtime.sendMessage({
        type: "captured",
        origin: location.origin,
        username: got.username,
        password: got.password,
        current: got.current,
      });
      if (sent && typeof sent.catch === "function") sent.catch(function () {});
    } catch (e) {
      // Worker asleep: this login is simply not offered.
    }
  }

  // Capture phase and `isTrusted`: the page's own handlers cannot hide a
  // submit from us, and a page script cannot forge one.
  document.addEventListener(
    "submit",
    function (e) {
      if (e.isTrusted) capture(e.target);
    },
    true
  );
  document.addEventListener(
    "click",
    function (e) {
      if (!e.isTrusted || !e.target || !e.target.closest) return;
      var b = e.target.closest('button, input[type="submit"], [role="button"]');
      // A submit button in a form also fires `submit`, which already
      // captured. One with no form does not, though `type` still says
      // "submit" -- the usual single-page login button.
      if (!b || (b.form && b.type === "submit")) return;
      var words = (b.textContent || "") + " " + (b.value || "") + " " + (b.getAttribute("aria-label") || "");
      if (SUBMITTISH.test(words)) capture(b);
    },
    true
  );
  document.addEventListener(
    "keydown",
    function (e) {
      if (e.isTrusted && e.key === "Enter" && e.target && e.target.tagName === "INPUT") capture(e.target);
    },
    true
  );

  /**
   * A 2FA setup page: once its code box holds a whole code, hand the code
   * and whatever the page shows that could be the key -- its QR codes, as
   * pixels, and any printed key -- to the background. The app decides
   * whether one of them made that code; nothing here reads a QR code.
   *
   * On typing rather than on submit, because plenty of setup pages check
   * the code the moment the last digit goes in. The offer itself waits for
   * the code box to be answered (background.js). A sign-in page asking for
   * a code shows no key, so nothing is sent from one.
   */
  var lastCode = "";

  function captureKey() {
    var code = window.Autofill.typedCode(document);
    if (!code || code === lastCode) return;
    lastCode = code;
    var keys = window.Autofill.printedKeys(document);
    window.Autofill.qrImages(document).then(function (qr) {
      if (qr.length === 0 && keys.length === 0) return;
      try {
        var sent = ext.runtime.sendMessage({ type: "captured-key", origin: location.origin, code: code, keys: keys, qr: qr });
        if (sent && typeof sent.catch === "function") sent.catch(function () {});
      } catch (e) {
        // Worker asleep: this key is simply not offered.
      }
    });
  }

  document.addEventListener(
    "input",
    function (e) {
      if (e.isTrusted && e.target && e.target.tagName === "INPUT") captureKey();
    },
    true
  );

  /**
   * A sign-up or change-password form: the first time a new-password box
   * gets focus, the bar offers to fill a strong password into it and its
   * confirmation. Made here, in the isolated world, and written straight
   * into the page -- which is where it is going anyway; the usual offer to
   * save follows once the site accepts it. Once per page, and never over a
   * bar that is already up.
   */
  var offeredPassword = false;

  document.addEventListener(
    "focusin",
    function (e) {
      if (offeredPassword || !e.isTrusted || window.PMBar.isOpen()) return;
      if (window.Autofill.newPasswordBoxes(document).indexOf(e.target) === -1) return;
      offeredPassword = true;
      var view = {
        kind: "generate",
        host: location.hostname,
        detail: "Password Manager makes one and fills it in, confirmation too.",
        never: false,
      };
      window.PMBar.show(view, function (choice) {
        if (choice !== "save") return window.PMBar.hide();
        var n = window.Autofill.fillNewPassword(document, window.Autofill.generatePassword());
        window.PMBar.say(
          n > 0 ? "Filled. Save it when the site takes it." : "The password boxes went away. Try again from the page.",
          true
        );
      });
    },
    true
  );

  ext.runtime.onMessage.addListener(function (msg, _sender, respond) {
    if (msg && msg.type === "state") {
      var found = boxes();
      respond({
        login: isLoginPage(),
        origin: location.origin,
        passwords: found.passwords,
        filled: found.filled,
        code: window.Autofill.typedCode(document),
        codeBox: window.Autofill.hasCodeBox(document),
        personal: window.Autofill.personalFields(document),
      });
      return false;
    }
    if (msg && msg.type === "offer") {
      // "Save" stays open: the background answers with a message, and may
      // need a second click after the app's approval dialog.
      window.PMBar.show(msg.view, function (choice) {
        if (choice !== "save") window.PMBar.hide();
        try {
          var sent = ext.runtime.sendMessage({ type: "offer-choice", choice: choice });
          if (sent && typeof sent.catch === "function") sent.catch(function () {});
        } catch (e) {
          // Worker gone: the capture went with it, so there is nothing to do.
        }
      });
      return false;
    }
    if (msg && msg.type === "offer-say") {
      window.PMBar.say(msg.text, !!msg.done);
      return false;
    }
    if (msg && msg.type === "highlight-provider") {
      // Show the user the button; the click that leaves the site is theirs.
      var button = window.Autofill.providerButton(document, String(msg.method || ""));
      if (button) window.PMBar.spotlight(button, String(msg.note || ""));
      respond({ found: !!button });
      return false;
    }
    if (msg && msg.type === "fill-code") {
      // The same moved-tab check as a password fill, for the same reason.
      if (msg.origin !== location.origin) {
        respond({ filled: false, wrongOrigin: location.origin });
        return false;
      }
      respond({ filled: window.Autofill.fillCode(document, String(msg.code || "")) });
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
      // A profile fill writes only boxes a person can see (autofill.js).
      var out = window.Autofill.fill(document, msg.data, { strict: !!msg.strict });
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
        // Names a country, never a number.
        mismatch: out.mismatch || null,
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

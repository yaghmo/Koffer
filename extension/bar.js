/**
 * bar.js — "Save this login?" in the page, top-right.
 *
 * A closed shadow root with its own styles: the page can neither read what
 * the bar says nor restyle it into something else. The buttons are submit
 * buttons of a form inside that root, and a choice counts only from a
 * `submit` event the browser marks trusted -- which a page script cannot
 * forge, and cannot trigger either, since it cannot reach the buttons. The
 * bar shows the site and the username, never the password.
 */
(function () {
  "use strict";

  var TITLES = {
    new: "Save this login to Koffer?",
    update: "Update the saved password?",
    approve: "Save this login to Koffer?",
    locked: "Unlock Koffer to save this login.",
    site: "Use Koffer on this site?",
    key: "Save this 2FA key to Koffer?",
    generate: "Use a strong password?",
    keyHas: "This login already has a 2FA key",
  };
  var PRIMARY = { new: "Save", update: "Update", approve: "Save", locked: "Try again", site: "Approve this website", key: "Save", generate: "Fill a strong password", keyHas: "OK" };

  // The app's own tokens (src/styles.css), so the bar reads as the app
  // speaking rather than the page.
  var STYLE =
    ":host{all:initial}" +
    ".bar{position:fixed;top:16px;right:16px;z-index:2147483647;max-width:340px;margin:0;" +
    "font:13px/1.4 system-ui,sans-serif;color:#e1e2ec;background:#1d1f27;" +
    "border:1px solid #464554;border-radius:12px;padding:14px 16px;box-shadow:0 12px 32px rgba(5,7,12,.55)}" +
    ".title{font-weight:600;margin:0 0 4px}.who{color:#c7c4d7;margin:0 0 12px;word-break:break-all}" +
    ".row{display:flex;gap:8px;flex-wrap:wrap}" +
    "button{font:inherit;border-radius:8px;padding:6px 12px;cursor:pointer;" +
    "border:1px solid #464554;background:transparent;color:inherit;transition:background-color .15s,color .15s}" +
    "button:hover{background:#272a32}button:disabled{opacity:.5;cursor:default}" +
    "button:focus-visible{outline:2px solid #c0c1ff;outline-offset:2px}" +
    "button.primary{background:#c0c1ff;border-color:#c0c1ff;color:#10131a;font-weight:600}" +
    "button.primary:hover{background:#d6d6ff}" +
    ".split{display:inline-flex}.split .later{border-radius:8px 0 0 8px}" +
    ".split .caret{border-left:0;border-radius:0 8px 8px 0;padding:6px 8px;display:inline-flex;align-items:center}" +
    ".caret svg{transition:transform .2s cubic-bezier(.16,1,.3,1)}" +
    ".caret[aria-expanded=true] svg{transform:rotate(180deg)}" +
    // Never sits on its own line under a hairline, centred: apart from Save,
    // so it cannot be hit on the way to it.
    ".menu{margin-top:12px;padding-top:8px;border-top:1px solid #32353d;text-align:center;" +
    "transition:opacity .2s cubic-bezier(.16,1,.3,1),transform .2s cubic-bezier(.16,1,.3,1)}" +
    "@starting-style{.menu{opacity:0;transform:translateY(-4px)}}" +
    ".menu[hidden]{display:none}" +
    ".menu button{border-color:transparent;color:#c7c4d7}" +
    ".menu button:hover{color:#ffb4ab;background:rgba(255,180,171,.08)}" +
    "@media (prefers-reduced-motion:reduce){.menu,.caret svg{transition:none}}";

  var CHEVRON =
    '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5 6 7.5 9 4.5"/></svg>';

  var host = null;
  var root = null;

  function hide() {
    if (host) host.remove();
    host = null;
    root = null;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function button(label, primary, choice) {
    var b = el("button", primary ? "primary" : "", label);
    b.type = "submit";
    b.value = choice;
    return b;
  }

  function show(view, onChoice) {
    hide();
    host = document.createElement("div");
    host.setAttribute("data-pm-bar", "");
    root = host.attachShadow({ mode: "closed" });
    var style = document.createElement("style");
    style.textContent = STYLE;
    var bar = el("form", "bar");
    bar.setAttribute("aria-label", "Koffer");
    bar.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!e.isTrusted || !e.submitter) return;
      // One choice at a time: a double-click must not save twice. `say`
      // hands the buttons back when the answer wants another click.
      setBusy(true);
      onChoice(e.submitter.value);
    });
    bar.appendChild(el("p", "title", TITLES[view.kind] || TITLES.new));
    bar.appendChild(el("p", "who", view.detail || (view.username ? view.username + " on " + view.host : view.host)));
    var row = el("div", "row");
    row.appendChild(button(PRIMARY[view.kind] || "Save", true, "save"));
    // "Never" waits behind the arrow: next to Save it is too easy to hit by
    // mistake, and nothing on the page undoes it.
    var split = el("span", "split");
    var later = button("Not now", false, "later");
    later.className = "later";
    var caret = el("button", "caret");
    // Our own constant markup, inside our own closed root.
    caret.innerHTML = CHEVRON;
    caret.type = "button";
    caret.setAttribute("aria-label", "More choices");
    caret.setAttribute("aria-expanded", "false");
    split.appendChild(later);
    split.appendChild(caret);
    row.appendChild(split);
    bar.appendChild(row);
    // A view with nothing to silence for good has no "Never".
    if (view.never === false) {
      caret.remove();
      later.className = "";
    } else {
      var menu = el("div", "menu");
      menu.hidden = true;
      menu.appendChild(button("Never for this site", false, "never"));
      caret.addEventListener("click", function () {
        menu.hidden = !menu.hidden;
        caret.setAttribute("aria-expanded", String(!menu.hidden));
      });
      bar.appendChild(menu);
    }
    root.appendChild(style);
    root.appendChild(bar);
    (document.body || document.documentElement).appendChild(host);
    return root;
  }

  function setBusy(busy) {
    if (!root) return;
    root.querySelectorAll("button").forEach(function (b) {
      b.disabled = busy;
    });
  }

  /** Replace the message. `done` drops the buttons and closes shortly. */
  function say(text, done) {
    if (!root) return;
    var who = root.querySelector(".who");
    if (who) who.textContent = text;
    setBusy(false);
    if (done) {
      root.querySelectorAll(".row, .menu").forEach(function (n) {
        n.remove();
      });
      // Only this bar: a newer one may have been shown in the meantime.
      var mine = host;
      setTimeout(function () {
        if (host === mine) hide();
      }, 3000);
    }
  }

  /**
   * Point at one element on the page: an outline over it and a note beside
   * it, in a closed shadow root that lets every click through to the page.
   * It stays until the next click anywhere, Escape, or the element leaving
   * the page -- a single-page app swapping its view keeps this document, so
   * a navigation alone would leave the ring floating over something else.
   */
  var spot = null;

  function unspot() {
    if (!spot) return;
    spot.stop();
    spot = null;
  }

  function spotlight(target, note) {
    unspot();
    var holder = document.createElement("div");
    holder.setAttribute("data-pm-spot", "");
    var sroot = holder.attachShadow({ mode: "closed" });
    var style = document.createElement("style");
    style.textContent =
      ":host{all:initial}" +
      ".ring{position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #c0c1ff;border-radius:10px;" +
      "box-shadow:0 0 0 4px rgba(192,193,255,.25),0 0 24px rgba(192,193,255,.45);animation:pulse 1.4s ease-in-out infinite}" +
      ".note{position:fixed;z-index:2147483647;pointer-events:none;max-width:280px;padding:7px 10px;border-radius:8px;" +
      "font:12px/1.4 system-ui,sans-serif;color:#e1e2ec;background:#1d1f27;border:1px solid #464554;box-shadow:0 8px 24px rgba(5,7,12,.5)}" +
      "@keyframes pulse{50%{box-shadow:0 0 0 7px rgba(192,193,255,.12),0 0 32px rgba(192,193,255,.3)}}" +
      "@media (prefers-reduced-motion:reduce){.ring{animation:none}}";
    var ring = el("div", "ring");
    var label = el("div", "note", note);
    sroot.appendChild(style);
    sroot.appendChild(ring);
    sroot.appendChild(label);
    (document.body || document.documentElement).appendChild(holder);

    function place() {
      var r = target.getBoundingClientRect();
      ring.style.left = r.left - 5 + "px";
      ring.style.top = r.top - 5 + "px";
      ring.style.width = r.width + 10 + "px";
      ring.style.height = r.height + 10 + "px";
      label.style.left = Math.max(8, r.left) + "px";
      // Under the button, or over it when it sits at the bottom.
      var below = r.bottom + 10;
      label.style.top = (below + 40 < window.innerHeight ? below : Math.max(8, r.top - 44)) + "px";
    }
    function onKey(e) {
      if (e.key === "Escape") unspot();
    }
    // Gone from the page, or hidden: nothing left to point at.
    var watch = new MutationObserver(function () {
      if (!target.isConnected || target.getClientRects().length === 0) unspot();
      else place();
    });
    watch.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    window.addEventListener("hashchange", unspot);
    window.addEventListener("popstate", unspot);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", unspot, true);
    spot = {
      stop: function () {
        watch.disconnect();
        window.removeEventListener("scroll", place, true);
        window.removeEventListener("resize", place);
        window.removeEventListener("hashchange", unspot);
        window.removeEventListener("popstate", unspot);
        document.removeEventListener("keydown", onKey, true);
        document.removeEventListener("pointerdown", unspot, true);
        holder.remove();
      },
    };
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    place();
  }

  window.PMBar = {
    spotlight: spotlight,
    show: show,
    say: say,
    hide: hide,
    isOpen: function () {
      return !!host;
    },
  };
})();

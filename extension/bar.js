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
  var PRIMARY = { new: "Save", update: "Update", approve: "Save", locked: "Try again", site: "Approve this website", key: "Save", generate: "Fill a strong password", keyHas: "Got it" };

  // The app's own look (DESIGN.md), so the bar reads as the app speaking
  // rather than the page: a white dialog, one red button, ink for the rest.
  // System fonts only: a page's CSP decides what fonts load inside it.
  var STYLE =
    ":host{all:initial}" +
    ".bar{position:fixed;top:16px;right:16px;z-index:2147483647;max-width:340px;margin:0;" +
    "font:13px/1.45 'Segoe UI',system-ui,sans-serif;color:#141414;background:#ffffff;" +
    "border:1px solid #e4e4e2;border-radius:10px;padding:16px;box-shadow:0 16px 40px -8px rgb(18 18 18 / .3)}" +
    ".head{display:flex;align-items:center;gap:8px;margin:0 0 4px}.head svg{flex:none}" +
    ".title{font-weight:600;margin:0}.who{color:#6b6b6b;margin:0 0 16px;word-break:break-all}" +
    ".row{display:flex;gap:8px;flex-wrap:wrap}" +
    "button{font:inherit;font-weight:500;height:32px;border-radius:6px;padding:0 12px;cursor:pointer;" +
    "border:1px solid #e4e4e2;background:#ffffff;color:inherit;transition:background-color .15s ease-out,color .15s ease-out}" +
    "button:hover{background:#f4f4f3}button:disabled{opacity:.5;cursor:default}" +
    "button:focus-visible{outline:2px solid #141414;outline-offset:2px}" +
    "button.primary{background:#c8102e;border-color:#c8102e;color:#ffffff}" +
    "button.primary:hover{background:#a90d27;border-color:#a90d27}" +
    ".split{display:inline-flex}.split .later{border-radius:6px 0 0 6px}" +
    ".split .caret{border-left:0;border-radius:0 6px 6px 0;padding:0 8px;display:inline-flex;align-items:center}" +
    ".caret svg{transition:transform .15s ease-out}" +
    ".caret[aria-expanded=true] svg{transform:rotate(180deg)}" +
    // Never sits on its own line under a hairline: apart from Save, so it
    // cannot be hit on the way to it.
    ".menu{margin-top:12px;padding-top:8px;border-top:1px solid #e4e4e2}" +
    ".menu[hidden]{display:none}" +
    ".menu button{border-color:transparent;color:#6b6b6b}" +
    ".menu button:hover{color:#c8102e;background:#f4f4f3}" +
    "@media (prefers-reduced-motion:reduce){button,.caret svg{transition:none}}";

  // The mark on a jacket-black tile, so the bar is recognisably Koffer's
  // before a word of it is read (src/components/Emblem.tsx).
  var MARK =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256" aria-hidden="true">' +
    '<rect width="256" height="256" rx="56" fill="#121212"/><g transform="translate(128 128) scale(.78) translate(-128 -128)">' +
    '<path fill="#ffd60a" fill-rule="evenodd" d="M88 96V64a24 24 0 0 1 24-24h32a24 24 0 0 1 24 24V96ZM108 96V66a6 6 0 0 1 6-6h28a6 6 0 0 1 6 6V96Z"/>' +
    '<path fill="#ffffff" fill-rule="evenodd" d="M54 92H202a26 26 0 0 1 26 26V190a26 26 0 0 1-26 26H54a26 26 0 0 1-26-26V118a26 26 0 0 1 26-26ZM60 92h10v124h-10ZM186 92h10v124h-10Z"/>' +
    '<path fill="#c8102e" d="M128 118a20 20 0 0 1 11.8 36.2L146 192H110l6.2-37.8A20 20 0 0 1 128 118Z"/></g></svg>';

  var CHEVRON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5 6 7.5 9 4.5"/></svg>';

  var host = null;
  var root = null;

  function hide() {
    if (host) host.remove();
    host = null;
    root = null;
  }

  /**
   * Is the bar really on show where its button is? The page cannot reach
   * inside the closed root, but the element holding it is the page's to
   * style: faded to nothing, or laid under something else, the bar still
   * takes a real click meant for whatever the page drew there.
   *
   * ponytail: opacity, visibility and what is on top at the button's
   * centre. A page can still dress the bar up with a filter or a clip;
   * what a click here can do is bounded by the app (approval is a click
   * there, and a browser write keeps the old password in history).
   */
  function plainlyShown(button) {
    for (var n = host; n && n.nodeType === 1; n = n.parentElement) {
      var style = getComputedStyle(n);
      if (style.visibility === "hidden" || style.display === "none") return false;
      if (style.opacity !== "" && parseFloat(style.opacity) < 0.9) return false;
    }
    var r = button.getBoundingClientRect();
    // No layout (a test DOM): nothing to ask about what is on top.
    if (r.width === 0 || typeof document.elementFromPoint !== "function") return true;
    var top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top === host;
  }

  /** One of the constant drawings above as an element: parsed, never
   *  assigned as HTML. */
  function svg(src) {
    return document.importNode(new DOMParser().parseFromString(src, "image/svg+xml").documentElement, true);
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
      // A click on a bar the user could not see is the page's, not theirs.
      if (!plainlyShown(e.submitter)) return;
      // One choice at a time: a double-click must not save twice. `say`
      // hands the buttons back when the answer wants another click.
      setBusy(true);
      onChoice(e.submitter.value);
    });
    var head = el("div", "head");
    head.appendChild(svg(MARK));
    head.appendChild(el("p", "title", TITLES[view.kind] || TITLES.new));
    bar.appendChild(head);
    bar.appendChild(el("p", "who", view.detail || (view.username ? view.username + " on " + view.host : view.host)));
    var row = el("div", "row");
    row.appendChild(button(PRIMARY[view.kind] || "Save", true, "save"));
    // "Never" waits behind the arrow: next to Save it is too easy to hit by
    // mistake, and nothing on the page undoes it.
    var split = el("span", "split");
    var later = button("Not now", false, "later");
    later.className = "later";
    var caret = el("button", "caret");
    caret.appendChild(svg(CHEVRON));
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
      // An ink ring inside a white one: it shows on a light page and on a
      // dark one, and it holds still.
      ".ring{position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #141414;border-radius:8px;" +
      "box-shadow:0 0 0 2px #ffffff}" +
      ".note{position:fixed;z-index:2147483647;pointer-events:none;max-width:280px;padding:8px 12px;border-radius:6px;" +
      "font:12px/1.4 'Segoe UI',system-ui,sans-serif;color:#f5f5f5;background:#121212;box-shadow:0 16px 40px -8px rgb(18 18 18 / .3)}";
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

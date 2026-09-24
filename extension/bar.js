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
    new: "Save this login to Password Manager?",
    update: "Update the saved password?",
    approve: "Save this login to Password Manager?",
    locked: "Unlock Password Manager to save this login.",
  };
  var PRIMARY = { new: "Save", update: "Update", approve: "Save", locked: "Try again" };

  var STYLE =
    ":host{all:initial}" +
    ".bar{position:fixed;top:16px;right:16px;z-index:2147483647;max-width:340px;margin:0;" +
    "font:13px/1.4 system-ui,sans-serif;color:#e6e1e5;background:#1d1b20;" +
    "border:1px solid #3a3740;border-radius:10px;padding:12px 14px;box-shadow:0 8px 24px rgba(0,0,0,.4)}" +
    ".title{font-weight:600;margin:0 0 4px}.who{opacity:.75;margin:0 0 10px;word-break:break-all}" +
    ".row{display:flex;gap:6px;flex-wrap:wrap}" +
    "button{font:inherit;border-radius:6px;padding:5px 10px;cursor:pointer;" +
    "border:1px solid #4a4650;background:transparent;color:inherit}" +
    "button.primary{background:#b8a4ff;border-color:#b8a4ff;color:#1d1b20;font-weight:600}";

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
    bar.setAttribute("aria-label", "Password Manager");
    bar.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!e.isTrusted || !e.submitter) return;
      // One choice at a time: a double-click must not save twice. `say`
      // hands the buttons back when the answer wants another click.
      setBusy(true);
      onChoice(e.submitter.value);
    });
    bar.appendChild(el("p", "title", TITLES[view.kind] || TITLES.new));
    bar.appendChild(el("p", "who", view.username ? view.username + " on " + view.host : view.host));
    var row = el("div", "row");
    row.appendChild(button(PRIMARY[view.kind] || "Save", true, "save"));
    row.appendChild(button("Not now", false, "later"));
    row.appendChild(button("Never for this site", false, "never"));
    bar.appendChild(row);
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
      var row = root.querySelector(".row");
      if (row) row.remove();
      // Only this bar: a newer one may have been shown in the meantime.
      var mine = host;
      setTimeout(function () {
        if (host === mine) hide();
      }, 3000);
    }
  }

  window.PMBar = { show: show, say: say, hide: hide };
})();

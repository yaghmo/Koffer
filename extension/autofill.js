/**
 * autofill.js — dependency-free login/personal-form detector + filler.
 *
 * Content-script foundation for the future browser extension. Exposes a
 * single global `Autofill` object:
 *
 *   Autofill.fill(scope, data) => {
 *     formFound: boolean,
 *     filled:   [{ field, value, matchedBy }],
 *     missing:  [field],
 *   }
 *
 *   Autofill.detect(scope)        => { passwords: number, identifier: boolean }
 *   Autofill.isLogin(result, href) => boolean
 *
 * `data` uses the vault's personal-info keys plus `password`:
 *   { name, username, email, phone, website, github, linkedin, password }
 *
 * Only visible, enabled inputs are touched. Values are set through the
 * native value setter and followed by bubbling `input` + `change` events so
 * React/Vue/Angular-controlled inputs observe the change. Never auto-submits.
 */
(function (global) {
  "use strict";

  var ROLES = {
    // Not `type="password"` alone: a site's own "show password" toggle
    // flips the field to type="text", and a filler that only knows the
    // masked form silently stops working the moment the user reveals it.
    password: {
      typeRe: /^password$/,
      autocomplete: "current-password",
      nameRe: /^password$|current[-_]?password|passwd|\bpwd\b|user[-_]?pass/i,
      report: "password",
    },
    email: {
      typeRe: /^email$/,
      autocomplete: "email",
      nameRe: /email/,
      report: "email",
    },
    phone: {
      typeRe: /^tel$/,
      autocomplete: "tel",
      nameRe: /phone|tel\b|mobile|cell/,
      report: "phone",
    },
    username: {
      autocomplete: "username",
      nameRe: /loginid|user(name|id)?|login\b/i,
      report: "username",
    },
    name: {
      autocomplete: "name",
      nameRe: /full\s?name|contactname|^\s*name\s*/i,
      report: "name",
    },
    website: { nameRe: /website|web[-_\s]?site|homepage|portfolio/i, report: "website" },
    github: { nameRe: /github/i, report: "github" },
    linkedin: { nameRe: /linkedin/i, report: "linkedin" },
    address: { nameRe: /street|\baddress\b|addressline|addr1/i, report: "address" },
    city: { nameRe: /\bcity\b/i, report: "city" },
    state: { nameRe: /state|province|region/i, report: "state" },
    zip: { nameRe: /zip|postal|postcode/i, report: "zip" },
    country: { nameRe: /country|nation/i, report: "country" },
    date_of_birth: { nameRe: /date\s?of\s?birth|birthdate|\bdob\b/i, report: "date_of_birth" },
    current_title: { nameRe: /job\s?title|jobtitle|\bposition\b|current\s?title/i, report: "current_title" },
    current_company: { nameRe: /company|employer|organisation|organization/i, report: "current_company" },
    years_experience: { nameRe: /years?\s?(of\s?)?experience|experience\b/i, report: "years_experience" },
    school: { nameRe: /school|university|college|institution/i, report: "school" },
    degree: { nameRe: /degree|major/i, report: "degree" },
    desired_salary: { nameRe: /salary|compensation|pay\b/i, report: "desired_salary" },
  };

  function isVisible(el) {
    if (!el || el.type === "hidden") return false;
    if (el.disabled || el.readOnly) return false;
    var rects = el.getClientRects();
    if (!rects || rects.length === 0) return false;
    var style = global.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  function collectInputs(scope) {
    var root = (scope && scope.nodeType === 1) ? scope : global.document;
    var nodes = root.querySelectorAll("input, select, textarea");
    return Array.prototype.filter.call(nodes, isVisible);
  }

  function fieldMeta(el) {
    var parts = [
      el.name,
      el.id,
      el.placeholder,
      el.getAttribute("autocomplete") || "",
      el.getAttribute("data-autofill") || "",
    ];
    return parts.join(" ").toLowerCase();
  }

  function roleMatches(role, el) {
    if (role.typeRe && role.typeRe.test(el.type || "")) return "type";
    var auto = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (role.autocomplete && auto === role.autocomplete) return "autocomplete";
    if (role.nameRe && role.nameRe.test(fieldMeta(el))) return "name";
    return null;
  }

  function setValue(el, value) {
    if (el instanceof HTMLSelectElement) {
      el.value = value;
    } else {
      var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement : HTMLInputElement;
      var setter = Object.getOwnPropertyDescriptor(proto.prototype, "value").set;
      if (setter) setter.call(el, value);
      else el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /**
   * What kind of credential form, if any, is on this page right now.
   *
   *   { passwords: <visible password boxes>, identifier: <bool> }
   *
   * Counts only. `isLogin` turns them into a verdict, because that needs
   * the page URL and this function deliberately only looks at the DOM.
   */
  function detect(scope) {
    var inputs = collectInputs(scope);
    var passwords = inputs.filter(function (el) {
      return String(el.type || "").toLowerCase() === "password";
    });
    var identifier = inputs.some(function (el) {
      if (String(el.type || "").toLowerCase() === "password") return false;
      return !!(roleMatches(ROLES.username, el) || roleMatches(ROLES.email, el));
    });
    return { passwords: passwords.length, identifier: identifier };
  }

  var LOGIN_URL = /(^|[^a-z])(sign[-_]?in|signin|log[-_]?in|login|auth|session|account)([^a-z]|$)/i;

  /**
   * Is a `detect` result, seen at this URL, a login worth offering to fill?
   *
   * Exactly one visible password box is a sign-in. Two or more is a sign-up
   * or a change-password form, where filling a saved login is wrong, so
   * those say no rather than nagging on every registration page.
   *
   * No password box at all is step one of a two-step login (Google,
   * Microsoft) — but an identifier box on its own is also every newsletter
   * signup on the web, so that case only counts when the URL admits what
   * the page is.
   */
  function isLogin(result, href) {
    if (result.passwords === 1) return true;
    return result.passwords === 0 && result.identifier && LOGIN_URL.test(String(href || ""));
  }

  function fillOnce(scope, data) {
    var inputs = collectInputs(scope);
    var claimed = [];
    var filled = [];
    var missing = [];

    Object.keys(ROLES).forEach(function (role) {
      var value = data[role];
      if (value === undefined || value === null || String(value).trim() === "") return;

      var match = null;
      for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i];
        if (claimed.indexOf(el) !== -1) continue;
        if (roleMatches(ROLES[role], el)) {
          match = el;
          break;
        }
      }
      if (!match) {
        missing.push(ROLES[role].report);
        return;
      }
      setValue(match, String(value).trim());
      claimed.push(match);
      filled.push({ field: ROLES[role].report, value: value, matchedBy: roleMatches(ROLES[role], match) });
    });

    return {
      formFound: inputs.length > 0,
      filled: filled,
      missing: missing,
    };
  }

  /**
   * The values that were asked for and are not in the form *right now*.
   *
   * Only ever used to decide whether to write again, never to report what
   * happened. A controlled React input re-renders from its old state before
   * its `onChange` has run, so reading `.value` straight after dispatching
   * `input` can hand back the previous value on a field that is about to
   * settle correctly. Writing the same value twice costs nothing; telling
   * the user their password did not land when it did costs their trust.
   */
  function pending(scope, data) {
    var inputs = collectInputs(scope);
    var left = {};
    Object.keys(ROLES).forEach(function (role) {
      var value = data[role];
      if (value === undefined || value === null || String(value).trim() === "") return;
      var wanted = String(value).trim();
      var landed = inputs.some(function (el) {
        return roleMatches(ROLES[role], el) && el.value === wanted;
      });
      if (!landed) left[role] = value;
    });
    return left;
  }

  /**
   * Fill, check, and write again whatever failed to land.
   *
   * The first `input` event makes React (and Vue, and Angular) re-render,
   * which can replace the very nodes still waiting to be written to. The
   * classic symptom is switching accounts on a form and watching the
   * username change while the password keeps its old value: the password
   * element the first pass was holding got thrown away before it was used.
   *
   * The second pass carries only the values that are still missing. Writing
   * the whole set again would re-fire the event that caused the re-render in
   * the first place, and on a form that rebuilds on every keystroke that is
   * a race the filler cannot win.
   *
   * One extra pass, never a loop. If a page is actively clearing the field,
   * retrying harder does not beat it.
   */
  function fill(scope, data) {
    var out = fillOnce(scope, data);
    var left = pending(scope, data);
    if (Object.keys(left).length > 0) {
      var again = fillOnce(scope, left);
      out.retried = true;
      again.filled.forEach(function (f) {
        if (
          out.filled.some(function (existing) {
            return existing.field === f.field;
          })
        ) {
          return;
        }
        out.filled.push(f);
      });
    }
    return out;
  }

  global.Autofill = { fill: fill, detect: detect, isLogin: isLogin };
})(typeof window !== "undefined" ? window : this);
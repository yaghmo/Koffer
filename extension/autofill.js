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
    password: { typeRe: /^password$/, report: "password" },
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

  function fill(scope, data) {
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

  global.Autofill = { fill: fill };
})(typeof window !== "undefined" ? window : this);
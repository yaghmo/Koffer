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
 *   Autofill.detect(scope)        => { passwords: number, filled: number, identifier: boolean }
 *   Autofill.fillCode(scope, code) => true when a 2FA code box took the code
 *   Autofill.isLogin(result, href) => boolean
 *
 * `data` uses the vault's personal-info keys plus `password`:
 *   { name, username, email, phone, website, github, linkedin, password }
 *
 * `phone` carries its dial code ("+1 555-123-4567"). A form with a separate
 * country picker gets them apart, one with a single box gets them together.
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
      // Matched against `fieldMeta`, which is name, id, placeholder and
      // autocomplete joined into one string -- so an anchored /^password$/
      // never fires, however obvious the field looks. Word boundaries are
      // what actually work here.
      // The local words matter for a box the site's eye has revealed, which
      // its placeholder is then the only thing naming.
      nameRe: /(^|[^a-z])(current[-_]?)?(password|passwd|pwd)([^a-z]|$)|user[-_]?pass|mot de passe|passwort|kennwort|contraseña|senha|wachtwoord|كلمة المرور/i,
      report: "password",
    },
    email: {
      typeRe: /^email$/,
      autocomplete: "email",
      nameRe: /email/,
      report: "email",
    },
    // Before `phone`, because whether the phone box gets the whole number or
    // just the national part depends on whether this one was filled.
    dial_code: {
      nameRe: /country[-_\s]?code|dial[-_\s]?code|phone[-_\s]?code|calling[-_\s]?code|area[-_\s]?code/i,
      report: "dial_code",
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
    // Before `name`: a form that splits the name gets it split (`expand`).
    first_name: {
      autocomplete: "given-name",
      nameRe: /first[-_\s]?name|given[-_\s]?name|\bfname\b|prénom|prenom|vorname|\bnombre\b|\bnome\b/i,
      report: "first_name",
    },
    last_name: {
      autocomplete: "family-name",
      nameRe: /last[-_\s]?name|family[-_\s]?name|surname|\blname\b|\bnom\b|nachname|apellido|cognome|sobrenome/i,
      report: "last_name",
    },
    name: {
      autocomplete: "name",
      nameRe: /full\s?name|contactname|^\s*name\s*/i,
      report: "name",
    },
    website: { nameRe: /website|web[-_\s]?site|homepage|portfolio/i, report: "website" },
    github: { nameRe: /github/i, report: "github" },
    linkedin: { nameRe: /linkedin/i, report: "linkedin" },
    address: { autocomplete: "street-address", nameRe: /street|\baddress\b|addressline|addr1/i, report: "address" },
    city: { autocomplete: "address-level2", nameRe: /\bcity\b/i, report: "city" },
    state: { autocomplete: "address-level1", nameRe: /state|province|region/i, report: "state" },
    zip: { autocomplete: "postal-code", nameRe: /zip|postal|postcode/i, report: "zip" },
    country: { autocomplete: "country-name", nameRe: /country|nation/i, report: "country" },
    date_of_birth: { autocomplete: "bday", nameRe: /date\s?of\s?birth|birthdate|\bdob\b/i, report: "date_of_birth" },
    current_title: { nameRe: /job\s?title|jobtitle|\bposition\b|current\s?title/i, report: "current_title" },
    current_company: { nameRe: /company|employer|organisation|organization/i, report: "current_company" },
    years_experience: { nameRe: /years?\s?(of\s?)?experience|experience\b/i, report: "years_experience" },
    school: { nameRe: /school|university|college|institution/i, report: "school" },
    degree: { nameRe: /degree|major/i, report: "degree" },
    desired_salary: { nameRe: /salary|compensation|pay\b/i, report: "desired_salary" },
  };

  /**
   * Is this field actually on the page, in front of the person?
   *
   * "Has a box" is not enough. A sign-in page routinely keeps the password
   * input mounted and collapsed during the step that only asks for an email
   * — Google's does — and a zero-by-zero box still returns one client rect.
   * Filling that writes the password into a field the user cannot see, on a
   * form they have not agreed to submit.
   *
   * So a field has to have *area*, and it has to not be transparent.
   * `checkVisibility` answers both (and content-visibility besides) where it
   * exists; the fallback catches the cases that are the element's own style.
   */
  function isVisible(el) {
    if (!el || el.type === "hidden") return false;
    if (el.disabled || el.readOnly) return false;
    // Taken out of the tab order is the page saying this is not a field the
    // user types into. TikTok's login carries
    // `<input type="password" tabindex="-1" class="...InputPasskeyHack...">`,
    // which counted as the page's one password box and would have been
    // handed the password.
    if (el.tabIndex < 0) return false;
    var rects = el.getClientRects();
    if (!rects || rects.length === 0) return false;
    var hasArea = false;
    for (var i = 0; i < rects.length; i++) {
      if (rects[i].width > 0 && rects[i].height > 0) {
        hasArea = true;
        break;
      }
    }
    if (!hasArea) return false;
    if (typeof el.checkVisibility === "function") {
      return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    }
    var style = global.getComputedStyle(el);
    return (
      style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0"
    );
  }

  function collectInputs(scope) {
    var root = (scope && scope.nodeType === 1) ? scope : global.document;
    var nodes = root.querySelectorAll("input, select, textarea");
    return Array.prototype.filter.call(nodes, isVisible);
  }

  /**
   * Whatever text is attached to this field's own label.
   *
   * A framework-built form often has no useful `name` or `id` at all — both
   * are generated — and the only thing saying what the box is for is the
   * label beside it or an `aria-label`. Reading only the attributes meant
   * those fields were, to this code, anonymous.
   */
  function labelText(el) {
    var out = "";
    try {
      var labels = el.labels;
      if (labels) {
        for (var i = 0; i < labels.length; i++) out += " " + (labels[i].textContent || "");
      }
    } catch (e) {
      // `labels` is not on every element type, and some pages shadow it.
    }
    var by = el.getAttribute("aria-labelledby");
    if (by) {
      var ids = by.split(/\s+/);
      for (var j = 0; j < ids.length; j++) {
        var node = global.document.getElementById(ids[j]);
        if (node) out += " " + (node.textContent || "");
      }
    }
    return out;
  }

  /**
   * The words a person sees against this field.
   *
   * Deliberately excludes `autocomplete`. That attribute is not a
   * description, it is an instruction to the browser, and a site sets it to
   * whatever makes its own autofill behave: TikTok's phone box is
   * `autocomplete="username webauthn"`, because to TikTok the phone number
   * *is* the username. Reading that as "this box says username" is what let
   * a username be typed into it.
   */
  function humanMeta(el) {
    var parts = [
      el.name,
      el.id,
      el.placeholder,
      el.getAttribute("aria-label") || "",
      el.getAttribute("title") || "",
      // Capped: a label can be a whole paragraph, and nothing here needs
      // more than the words next to the box.
      labelText(el).slice(0, 200),
    ];
    return parts.join(" ").toLowerCase();
  }

  function fieldMeta(el) {
    return (
      humanMeta(el) +
      " " +
      (el.getAttribute("autocomplete") || "") +
      " " +
      (el.getAttribute("data-autofill") || "")
    ).toLowerCase();
  }

  /**
   * `autocomplete` is a space-separated token list, not a single word.
   * `"username webauthn"` is a perfectly ordinary value and an exact compare
   * against it matches nothing.
   */
  function autoTokens(el) {
    return String(el.getAttribute("autocomplete") || "")
      .toLowerCase()
      .split(/\s+/)
      .filter(function (t) {
        return t !== "";
      });
  }

  function hasAuto(el, want) {
    return autoTokens(el).indexOf(want) !== -1;
  }

  /**
   * Is this a password box, masked or not?
   *
   * `type="password"` is the easy half. The other half is a box the site's
   * own "show password" eye has flipped to `type="text"` -- still the
   * password field, still what a fill should write into, and invisible to a
   * detector that counts only the masked type. A page scanned after the eye
   * was clicked used to read as "no login here".
   *
   * Only a plain text input is ever promoted, and only on a name match. That
   * keeps `type="email"`, `type="search"` and every select and textarea out
   * of it -- which also means a fill can no longer land a password in a
   * search box named "passwd", the way the bare name match allowed.
   */
  function isPasswordBox(el) {
    var type = String(el.type || "").toLowerCase();
    if (type === "password") return true;
    if (el.tagName !== "INPUT" || (type !== "text" && type !== "")) return false;
    return !!roleMatches(ROLES.password, el);
  }

  /**
   * Is this box asking for a phone number and nothing else?
   *
   * The point is what must *not* go in it. TikTok's sign-in opens on a phone
   * tab, and the box there matched the username role well enough to be
   * filled with a username — a value that field will never accept.
   *
   * "And nothing else" is the careful half. Facebook's single login box is
   * named `email` and reads "Email address or phone number": it takes either,
   * and the username belongs in it. So a box only counts as a phone box when
   * it says phone and does *not* also name a kind of identifier.
   *
   * IDENTIFIER_HINT is deliberately narrower than the username role's own
   * pattern, which counts a bare "login". TikTok's box is `login-mobile`
   * with the placeholder "Phone number" — "login" says which form it is on,
   * not what goes in it, and letting it vote made this test useless there.
   */
  var IDENTIFIER_HINT = /user(name|id)?|loginid|e-?mail/i;

  /** A box the page has told the browser to put a *phone* keypad on. */
  function isTelBox(el) {
    return (el.getAttribute("inputmode") || "").toLowerCase() === "tel";
  }

  /** A box for digits, which may or may not be a phone number. */
  function isNumericBox(el) {
    var mode = (el.getAttribute("inputmode") || "").toLowerCase();
    if (mode === "numeric") return true;
    return String(el.type || "").toLowerCase() === "number";
  }

  /**
   * A `<select>` full of dial codes, whatever it is named.
   *
   * The country picker beside a phone box is the clearest signal there is,
   * and on a framework-built form its name is generated -- so it is
   * recognised by what is *in* it. Two options carrying a `+`-prefixed
   * number is not something any other kind of select does.
   */
  /**
   * Anything beside a field that is showing a dial code.
   *
   * TikTok's country picker is
   * `<div role="button" aria-label="FR +33 phone country code...">`, not a
   * `<select>`, which is the usual shape in a framework-built form. Limited
   * to things that announce themselves as controls, so this never walks an
   * arbitrary subtree.
   */
  function looksLikeDialControl(el) {
    if (el.options) return looksLikeDialSelect(el);
    var label = el.getAttribute("aria-label") || "";
    if (/\+\d{1,4}/.test(label)) return true;
    return /\+\d{1,4}/.test(String(el.textContent || "").slice(0, 80));
  }

  function looksLikeDialSelect(el) {
    if (!el.options || el.options.length < 2) return false;
    var seen = 0;
    var limit = Math.min(el.options.length, 40);
    for (var i = 0; i < limit; i++) {
      var opt = el.options[i];
      if (/\+\d{1,4}/.test(String(opt.value || "")) || /\+\d{1,4}/.test(String(opt.text || ""))) {
        seen++;
        if (seen >= 2) return true;
      }
    }
    return false;
  }

  /**
   * Is there a dial-code control beside this field?
   *
   * A country code next to a box is what a phone entry looks like even when
   * every name on the page is generated. Scoped to the form, or to the
   * grandparent when there is no form element, so a picker somewhere else
   * entirely does not vote.
   */
  function dialControl(el) {
    var root = el.form || (el.closest && el.closest("form"));
    if (!root) root = el.parentElement && el.parentElement.parentElement;
    if (!root || !root.querySelectorAll) return null;
    var nodes = root.querySelectorAll('input, select, [role="button"], [aria-haspopup]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] === el) continue;
      if (roleMatches(ROLES.dial_code, nodes[i]) || looksLikeDialControl(nodes[i])) {
        return nodes[i];
      }
    }
    return null;
  }

  function hasDialNeighbour(el) {
    return dialControl(el) !== null;
  }

  /** The dial code a picker is currently showing, if it is showing one. */
  function shownDial(el) {
    var text;
    if (el.options && el.selectedIndex >= 0 && el.options[el.selectedIndex]) {
      var opt = el.options[el.selectedIndex];
      text = String(opt.value || "") + " " + String(opt.text || "");
    } else {
      text = (el.getAttribute("aria-label") || "") + " " + String(el.textContent || "").slice(0, 80);
    }
    var m = /\+\d{1,4}/.exec(text);
    return m ? m[0] : "";
  }

  function isPhoneBox(el) {
    var type = String(el.type || "").toLowerCase();
    if (type === "tel") return true;
    if (type === "email" || type === "password") return false;
    var tokens = autoTokens(el);
    for (var t = 0; t < tokens.length; t++) {
      if (tokens[t] === "tel" || tokens[t].indexOf("tel-") === 0) return true;
    }

    // `inputmode="tel"` is the page asking for a phone keypad. Nothing else
    // wants one, so it outranks everything below.
    if (isTelBox(el)) return true;

    // Only the words a person reads decide this, never `autocomplete`. A
    // sign-in box that takes a phone number routinely declares
    // `autocomplete="username"` -- to the site that is exactly what it is --
    // and letting that vote made this whole test a no-op on the form it was
    // written for.
    var human = humanMeta(el);
    var saysPhone = ROLES.phone.nameRe.test(human);
    // Plain digits are more ambiguous -- an account number is digits too --
    // so those need the field to say phone, or a country code beside it.
    if (isNumericBox(el) && (saysPhone || hasDialNeighbour(el))) return true;

    if (!saysPhone) return false;
    return !IDENTIFIER_HINT.test(human);
  }

  /**
   * `roleMatches`, plus the rules that are not about the name. Used
   * everywhere a role is matched for writing, so `fill` and `pending` cannot
   * disagree about them.
   */
  function matchesRole(roleKey, el) {
    if (roleKey === "password" && !isPasswordBox(el)) return null;
    // A username or an email address typed into a phone box is a value that
    // field will never accept, and it stops the real box being filled when
    // the page finally shows it.
    if ((roleKey === "username" || roleKey === "email") && isPhoneBox(el)) return null;
    return roleMatches(ROLES[roleKey], el);
  }

  function roleMatches(role, el) {
    if (role.typeRe && role.typeRe.test(el.type || "")) return "type";
    if (role.autocomplete && hasAuto(el, role.autocomplete)) return "autocomplete";
    if (role.nameRe && role.nameRe.test(fieldMeta(el))) return "name";
    return null;
  }

  /**
   * The option of a `<select>` that this value means, if any.
   *
   * A country or dial-code picker is a select whose option values are
   * anybody's guess — "+1", "US", "1", "United States". Assigning a value
   * that matches no option silently leaves the select on its first entry, so
   * the label is worth reading too.
   */
  function optionFor(select, value) {
    var wanted = String(value).trim().toLowerCase();
    if (wanted === "") return null;
    var exact = null;
    var contains = null;
    for (var i = 0; i < select.options.length; i++) {
      var opt = select.options[i];
      var val = String(opt.value || "").trim().toLowerCase();
      var label = String(opt.text || "").trim().toLowerCase();
      if (val === wanted || label === wanted) return opt;
      if (exact === null && (val === wanted.replace(/^\+/, "") || label === wanted.replace(/^\+/, ""))) {
        exact = opt;
      }
      if (contains === null && label.indexOf(wanted) !== -1) contains = opt;
    }
    return exact || contains;
  }

  function setValue(el, value) {
    if (el instanceof HTMLSelectElement) {
      var opt = optionFor(el, value);
      if (!opt) return false;
      el.value = opt.value;
    } else {
      var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement : HTMLInputElement;
      var setter = Object.getOwnPropertyDescriptor(proto.prototype, "value").set;
      if (setter) setter.call(el, value);
      else el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  /**
   * What kind of credential form, if any, is on this page right now.
   *
   *   { passwords: <visible password boxes, revealed ones included>,
   *     filled: <how many of those hold text>,
   *     identifier: <bool>,
   *     declared: <bool: a box says autocomplete="username"> }
   *
   * Counts only. `isLogin` turns them into a verdict, because that needs
   * the page URL and this function deliberately only looks at the DOM.
   */
  function detect(scope) {
    var inputs = collectInputs(scope);
    var passwords = inputs.filter(isPasswordBox);
    var identifier = inputs.some(function (el) {
      if (isPasswordBox(el)) return false;
      return !!(roleMatches(ROLES.username, el) || roleMatches(ROLES.email, el));
    });
    // Boxes still holding text: a change-password form that emptied them
    // after a submit is how that form says it worked.
    var filled = passwords.filter(function (el) {
      return !!el.value;
    }).length;
    // A box the page itself calls `username`: step one of a sign-in says so
    // even when its URL does not. Newsletters ask for `email`.
    var declared = inputs.some(function (el) {
      return !isPasswordBox(el) && hasAuto(el, "username");
    });
    return { passwords: passwords.length, filled: filled, identifier: identifier, declared: declared };
  }

  /**
   * What a submitted form signs in with, for the offer to save it.
   *
   * `{ username, password, current }`, or null when no password box has a
   * value -- except step one of a two-step sign-in, a username with no
   * password box at all, which comes back with `password: ""`. `current`
   * is only set on a change-password form, where the account is often
   * found by its old password because there is no username box at all.
   */
  function captured(scope) {
    var inputs = collectInputs(scope);
    var user = inputs.filter(function (el) {
      if (isPasswordBox(el) || !el.value) return false;
      return !!(roleMatches(ROLES.username, el) || roleMatches(ROLES.email, el));
    })[0];
    var boxes = inputs.filter(function (el) {
      return isPasswordBox(el) && el.value;
    });
    if (boxes.length === 0) {
      // Step one of a two-step sign-in: a username and no password box at
      // all. Held so the password step can be matched to its account.
      var anyBox = inputs.some(isPasswordBox);
      return user && !anyBox ? { username: user.value.trim(), password: "", current: "" } : null;
    }
    var values = boxes.map(function (el) {
      return el.value;
    });
    var password = values[0];
    var current = "";
    var distinct = values.filter(function (v, i) {
      return values.indexOf(v) === i;
    });
    if (distinct.length > 1) {
      // A change-password form: the new one is the box that says so, else
      // the last; the current one is the box that says so, else the first.
      var fresh = boxes.filter(function (el) {
        return hasAuto(el, "new-password");
      });
      var old = boxes.filter(function (el) {
        return hasAuto(el, "current-password");
      });
      password = (fresh.length ? fresh[fresh.length - 1] : boxes[boxes.length - 1]).value;
      var oldBox = old.length ? old[0] : boxes[0];
      // Every box but the current one holds the new password. When those
      // disagree the site refuses the change, so there is nothing to offer.
      var mismatch = (fresh.length ? fresh : boxes.filter(function (el) {
        return el !== oldBox;
      })).some(function (el) {
        return el.value !== password;
      });
      if (mismatch) return null;
      var was = oldBox.value;
      if (was !== password) current = was;
    }
    return { username: user ? user.value.trim() : "", password: password, current: current };
  }

  /**
   * "+1 555-123-4567" as its dial code and the rest.
   *
   * Done here rather than in the app so no country table has to cross the
   * bridge. Country codes never prefix one another (ITU E.164), so the
   * digits alone say where the code ends, with or without a space after it:
   * "+33612345678" is +33, not +3361. One digit for zones 1 and 7, two for
   * the pairs below, three for everything else.
   */
  var DIAL_TWO = /^(2[07]|3[0-469]|4[013-9]|5[1-8]|6[0-6]|8[1246]|9[0-58])/;

  function splitDial(value) {
    var s = String(value == null ? "" : value).trim();
    if (s.charAt(0) !== "+") return { dial: "", local: s };
    var d = digits(s);
    var n = /^[17]/.test(d) ? 1 : DIAL_TWO.test(d) ? 2 : 3;
    return { dial: "+" + d.slice(0, n), local: d.slice(n) };
  }

  function digits(value) {
    return String(value == null ? "" : value).replace(/\D/g, "");
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
   * the page is, or the box declares `autocomplete="username"`.
   */
  function isLogin(result, href) {
    if (result.passwords === 1) return true;
    return result.passwords === 0 && result.identifier && (result.declared || LOGIN_URL.test(String(href || "")));
  }

  /**
   * The values to write, given the ones that were asked for.
   *
   * A stored phone number carries its dial code. A form that has a separate
   * country picker wants them apart; one with a single box wants them
   * together. `dial_code` is offered either way and `fillOnce` decides which
   * shape the phone box gets from whether that picker was actually there.
   */
  function expand(data) {
    var out = {};
    Object.keys(data).forEach(function (k) {
      out[k] = data[k];
    });
    // "Ada Lovelace" for a form with a first and a last box. Everything
    // after the first space is the last name, which is right more often
    // than any cleverer split.
    var full = String(data.name || "").trim();
    if (full.indexOf(" ") !== -1 && out.first_name === undefined && out.last_name === undefined) {
      out.first_name = full.slice(0, full.indexOf(" "));
      out.last_name = full.slice(full.indexOf(" ") + 1).trim();
    }
    if (data.phone && out.dial_code === undefined) {
      var dial = splitDial(data.phone).dial;
      if (dial) out.dial_code = dial;
    }
    return out;
  }

  /**
   * Which half of a phone number this box should get, and whether it should
   * get one at all.
   *
   * Three cases. The dial code went into a control of its own, so the box
   * takes the national part. There is no country picker at all, so the box
   * takes the whole number. Or there is a picker this cannot set — a
   * `<div role="button">` is a picker to a person and nothing to a script —
   * in which case the only safe fill is one where it already shows the right
   * country, and anything else is refused rather than guessed.
   */
  function phoneValue(value, box, filled) {
    var parts = splitDial(value);
    // Digits only, whichever half goes in. The vault groups a number with
    // hyphens so it is readable on screen; a form wants the number. Plenty
    // of them validate on length or strip nothing, and a hyphen is the
    // difference between accepted and "enter a valid phone number".
    var local = digits(parts.local);
    var whole = parts.dial ? parts.dial + local : local;
    var dialWent = filled.some(function (f) {
      return f.field === "dial_code";
    });
    if (dialWent) return { value: local };
    if (!parts.dial) return { value: local };

    var picker = dialControl(box);
    var shown = picker ? shownDial(picker) : "";
    if (!shown) return { value: whole };
    if (shown !== parts.dial) {
      return { refuse: true, mismatch: { wanted: parts.dial, shown: shown } };
    }
    return { value: local };
  }

  /**
   * `all` is the whole fill when this is a retry of part of it, and `held`
   * the boxes the first pass wrote that kept their value: those are not
   * the retry's to take.
   */
  function fillOnce(scope, wanted, all, held) {
    var inputs = collectInputs(scope);
    var claimed = (held || []).slice();
    var writes = [];
    var filled = [];
    var missing = [];
    var mismatch = null;
    var data = expand(wanted);

    Object.keys(ROLES).forEach(function (role) {
      var value = data[role];
      if (value === undefined || value === null || String(value).trim() === "") return;

      var match = null;
      for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i];
        if (claimed.indexOf(el) !== -1) continue;
        if (matchesRole(role, el)) {
          match = el;
          break;
        }
      }
      // Plenty of sign-in forms have one identifier box and call it `email`,
      // whatever you actually type into it. With no box of its own, the
      // username goes there rather than nowhere -- still never into a
      // phone-only box, which `matchesRole` refuses.
      // Not when the fill has an email of its own: a profile's username is
      // not an email address, and on a retry the box is already its email's.
      if (!match && role === "username" && !(all || wanted).email) {
        for (var j = 0; j < inputs.length; j++) {
          var box = inputs[j];
          if (claimed.indexOf(box) !== -1) continue;
          if (matchesRole("email", box)) {
            match = box;
            break;
          }
        }
      }
      if (!match) {
        // A dial code with nowhere to go is not a gap in the fill: most
        // forms have one phone box and no picker at all.
        if (role !== "dial_code") missing.push(ROLES[role].report);
        return;
      }
      // What the number box gets depends on what carries the country, which
      // is only knowable once the box itself is in hand.
      if (role === "phone") {
        var decided = phoneValue(value, match, filled);
        if (decided.refuse) {
          // A country picker showing a different country, and no way to
          // change it: this is a `<div role="button">`, not a control with a
          // value. Writing the whole number leaves "+1 555..." sitting under
          // a +33 picker, and writing the national part alone turns a US
          // number into a French one. Neither is a fill; say so instead.
          mismatch = decided.mismatch;
          missing.push(ROLES[role].report);
          return;
        }
        value = decided.value;
        if (String(value).trim() === "") return;
      }
      // The profile keeps a GitHub handle; a box that wants a link gets one.
      if (role === "github" && !/^https?:/i.test(value) && (match.type === "url" || /url|link|http/.test(fieldMeta(match)))) {
        value = "https://github.com/" + String(value).trim();
      }
      if (!setValue(match, String(value).trim())) {
        // A select with no option for this value. Saying it landed would be
        // a lie, and claiming the element would hide the next candidate.
        if (role !== "dial_code") missing.push(ROLES[role].report);
        return;
      }
      claimed.push(match);
      writes.push({ el: match, value: String(value).trim() });
      filled.push({ field: ROLES[role].report, value: value, matchedBy: matchesRole(role, match) });
    });

    return {
      formFound: inputs.length > 0,
      filled: filled,
      missing: missing,
      // Set when a number was refused because the page's own country picker
      // is on a different country and cannot be changed from here.
      mismatch: mismatch,
      writes: writes,
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
  function pending(scope, wanted) {
    var inputs = collectInputs(scope);
    var left = {};
    var data = expand(wanted);
    Object.keys(ROLES).forEach(function (role) {
      var value = data[role];
      if (value === undefined || value === null || String(value).trim() === "") return;
      var wanted = String(value).trim();
      var landed = inputs.some(function (el) {
        if (!matchesRole(role, el)) return false;
        // A phone number goes in as digits and may be only the national
        // half, so the stored string never matches the box character for
        // character. Compare what is actually in there.
        if (role === "phone") {
          var want = digits(value);
          var got = digits(el.value);
          return got !== "" && (want === got || want.slice(-got.length) === got);
        }
        return el.value === wanted;
      });
      // A dial code that found no picker is not outstanding work.
      if (!landed && role !== "dial_code") left[role] = value;
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
      // A box that took its value stays that value's. Without this, an email
      // box that also says autocomplete="username" -- most sign-ups -- got
      // the profile's email, then its username over it on the retry.
      var held = out.writes
        .filter(function (w) {
          return w.el.value === w.value;
        })
        .map(function (w) {
          return w.el;
        });
      var again = fillOnce(scope, left, data, held);
      out.retried = true;
      if (!out.mismatch) out.mismatch = again.mismatch;
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
    delete out.writes;
    return out;
  }

  /**
   * Words a 2FA code box goes by. Matched against what a person reads next
   * to the box (`humanMeta`), in the languages the rest of this file knows.
   */
  var CODE_WORDS =
    /one[-_\s]?time|\botp\b|totp|2fa|mfa|two[-_\s]?(factor|step)|verification|verify|authenticat|security[-_\s]?code|\bcode\b|vérification|código|codice|bestätigung|رمز/;

  /** Other things called a code, which a 2FA code must not land in. */
  var NOT_CODE = /zip|postal|post[-_\s]?code|promo|coupon|voucher|discount|gift|country|area|dial|referral|invite/;

  /** A box a code could go in: typed text, never a password box. */
  function isCodeCandidate(el) {
    if (el.tagName !== "INPUT" || isPasswordBox(el)) return false;
    var type = String(el.type || "").toLowerCase();
    return type === "text" || type === "tel" || type === "number" || type === "";
  }

  /**
   * The page's 2FA code box: `{ digits }` for a row of one-character boxes
   * at least `len` long, else `{ box }`.
   *
   * Only a box that says what it is counts: `one-time-code`, or a label or
   * name that reads like a code field. Anything else is left alone.
   */
  function codeBox(scope, len) {
    var boxes = collectInputs(scope).filter(isCodeCandidate);
    var digits = boxes.filter(function (el) {
      return el.maxLength === 1;
    });
    if (digits.length >= len) return { digits: digits };
    var box =
      boxes.filter(function (el) {
        return hasAuto(el, "one-time-code");
      })[0] ||
      boxes.filter(function (el) {
        var words = humanMeta(el);
        return CODE_WORDS.test(words) && !NOT_CODE.test(words);
      })[0];
    return box ? { box: box } : null;
  }

  /**
   * Type a 2FA code into the page's code box. True when it went somewhere;
   * when it did not, the popup copies the code instead, which is a paste
   * away.
   */
  function fillCode(scope, code) {
    var found = codeBox(scope, code.length);
    if (!found) return false;
    if (found.digits) {
      for (var i = 0; i < code.length; i++) setValue(found.digits[i], code.charAt(i));
    } else {
      setValue(found.box, code);
    }
    return true;
  }

  /** The 2FA code typed into the page's code box, or "". */
  function typedCode(scope) {
    var found = codeBox(scope, 6);
    if (!found) return "";
    var v = found.digits
      ? found.digits
          .map(function (el) {
            return el.value;
          })
          .join("")
      : found.box.value;
    v = String(v || "").replace(/\s/g, "");
    return /^\d{6,8}$/.test(v) ? v : "";
  }

  /**
   * A key printed under "can't scan it?": base32, in one run or in groups
   * of four, either case. A group run can pick up a four-letter word on
   * either side, so each is also tried without its first or last group.
   * Plain words match too; a candidate needs a letter and a digit, and the
   * app keeps only one that made the code the user typed.
   */
  var KEY_TEXT = /\b(?:[A-Za-z2-7]{16,64}|[A-Za-z2-7]{4}(?:[ -][A-Za-z2-7]{1,4}){3,15})\b/g;
  var MAX_KEYS = 8;

  function printedKeys(scope) {
    var root = scope.body || scope;
    // `innerText` breaks between blocks, where `textContent` would run a
    // label straight into the key. It also skips hidden text, which is fine:
    // a key typed from the page was on show when the code was.
    var text = typeof root.innerText === "string" ? root.innerText : root.textContent;
    var keys = [];
    (String(text || "").match(KEY_TEXT) || []).forEach(function (run) {
      var groups = run.split(/[ -]/);
      [groups, groups.slice(1), groups.slice(0, -1)].forEach(function (g) {
        var key = g.join("").toUpperCase();
        if (key.length < 16 || !/[A-Z]/.test(key) || !/[2-7]/.test(key)) return;
        if (keys.length < MAX_KEYS && keys.indexOf(key) === -1) keys.push(key);
      });
    });
    return keys;
  }

  /** What each sign-in provider's button says, or where it points. */
  var PROVIDER_WORDS = {
    google: /google/,
    github: /github/,
    microsoft: /microsoft|outlook|\blive\.com|azure/,
    apple: /apple/,
    facebook: /facebook/,
  };

  /**
   * A provider button also has to read as signing in, or "Follow us on
   * GitHub" in the footer would do -- unless it says the provider's name and
   * nothing else, which is the row of buttons under "or sign in with".
   */
  var SIGN_IN_WORDS = /sign[\s-]?in|sign[\s-]?up|log[\s-]?in|continue|connect|oauth|\bauth|sso|connexion|se connecter|continuer|anmelden|fortfahren|iniciar|continuar|accedi|continua|entrar|تسجيل|متابعة/;

  function shownOnScreen(el) {
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    return typeof el.checkVisibility === "function" ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true;
  }

  /**
   * The page's "Sign in with GitHub" (Google, Microsoft...) button, if it has
   * one on show. Found, never clicked: that click leaves the site and may
   * grant access, so it stays the user's.
   */
  function providerButton(scope, method) {
    var want = PROVIDER_WORDS[method];
    if (!want) return null;
    var best = null;
    var bestLen = Infinity;
    var all = scope.querySelectorAll('button, a[href], [role="button"], input[type="submit"], input[type="button"]');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var imgs = Array.prototype.map
        .call(el.querySelectorAll("img[alt], svg[aria-label]"), function (n) {
          return n.getAttribute("alt") || n.getAttribute("aria-label") || "";
        })
        .join(" ");
      var text = (el.textContent || "") + " " + (el.value || "");
      var words = (
        text +
        " " +
        (el.getAttribute("aria-label") || "") +
        " " +
        (el.getAttribute("title") || "") +
        " " +
        imgs +
        " " +
        (el.getAttribute("href") || "")
      ).toLowerCase();
      var named = text.trim().toLowerCase() === method;
      if (!want.test(words) || !(named || SIGN_IN_WORDS.test(words)) || !shownOnScreen(el)) continue;
      // The tightest match: a wrapper around every provider button says all
      // of their names at once.
      var len = text.trim().length;
      if (len < bestLen) {
        best = el;
        bestLen = len;
      }
    }
    return best;
  }

  /** Roles a profile fills; the login ones are not among them. */
  var PERSONAL_ROLES = Object.keys(ROLES).filter(function (k) {
    return k !== "password" && k !== "username" && k !== "dial_code";
  });

  /**
   * How many kinds of personal field the page has a box for: name, email,
   * phone, address... Two or more is a form the profile can help with; a
   * sign-in's lone email box is not.
   */
  function personalFields(scope) {
    var inputs = collectInputs(scope).filter(function (el) {
      return !isPasswordBox(el);
    });
    return PERSONAL_ROLES.filter(function (k) {
      return inputs.some(function (el) {
        return roleMatches(ROLES[k], el);
      });
    }).length;
  }

  /** The current password on a change form, by what it says it is. */
  var CURRENT_WORDS = /current|old|existing|actuel|ancien|aktuell|alt|actual|anterior|attuale|vecchi|atual|الحالية/;

  /**
   * The boxes a new password goes in: a sign-up's password and its
   * confirmation, or a change form's new and confirm -- never its current
   * one. Empty when the page is not asking for a new password: one box is a
   * sign-in unless it says `new-password`.
   */
  function newPasswordBoxes(scope) {
    var boxes = collectInputs(scope).filter(isPasswordBox);
    var fresh = boxes.filter(function (el) {
      return hasAuto(el, "new-password");
    });
    if (fresh.length > 0) return fresh;
    if (boxes.length < 2) return [];
    return boxes.filter(function (el) {
      return !hasAuto(el, "current-password") && !CURRENT_WORDS.test(humanMeta(el));
    });
  }

  /** The app's generator alphabet (password.rs), all four kinds. */
  var GEN_CLASSES = ["abcdefghijklmnopqrstuvwxyz", "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "0123456789", "!@#$%^&*()-_=+[]{};:,.<>?/"];
  var GEN_LENGTH = 20;

  /** A uniform index below `n`: bytes past the last multiple are redrawn. */
  function uniformBelow(n) {
    var limit = 256 - (256 % n);
    var b = new Uint8Array(1);
    do crypto.getRandomValues(b);
    while (b[0] >= limit);
    return b[0] % n;
  }

  /** A fresh password with at least one of each kind, in random order. */
  function generatePassword() {
    var all = GEN_CLASSES.join("");
    var chars = GEN_CLASSES.map(function (c) {
      return c.charAt(uniformBelow(c.length));
    });
    while (chars.length < GEN_LENGTH) chars.push(all.charAt(uniformBelow(all.length)));
    for (var i = chars.length - 1; i > 0; i--) {
      var j = uniformBelow(i + 1);
      var t = chars[i];
      chars[i] = chars[j];
      chars[j] = t;
    }
    return chars.join("");
  }

  /** Put one new password in every new-password box. How many took it. */
  function fillNewPassword(scope, password) {
    var boxes = newPasswordBoxes(scope);
    boxes.forEach(function (el) {
      setValue(el, password);
    });
    return boxes.length;
  }

  /** Largest side sent to the app; `MAX_BITS_SIDE` in totp.rs. */
  var QR_SIDE = 256;
  /** A setup page shows one QR code; `MAX_PAGE_QR` in bridge.rs. */
  var MAX_QR = 2;

  /**
   * One picture as black and white, one bit a pixel, rows packed high bit
   * first, base64. A QR code drawn from another origin taints the canvas
   * and cannot be read; null then.
   */
  function bitsOf(source, w, h) {
    var scale = Math.min(1, QR_SIDE / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    try {
      var canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      var g = canvas.getContext("2d");
      if (!g) return null;
      // A transparent PNG's background is white on the page.
      g.fillStyle = "#fff";
      g.fillRect(0, 0, w, h);
      g.drawImage(source, 0, 0, w, h);
      var px = g.getImageData(0, 0, w, h).data;
      var row = Math.ceil(w / 8);
      var out = new Uint8Array(row * h);
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var i = (y * w + x) * 4;
          if (px[i] * 3 + px[i + 1] * 6 + px[i + 2] < 1280) out[y * row + (x >> 3)] |= 0x80 >> (x & 7);
        }
      }
      var bin = "";
      for (var j = 0; j < out.length; j++) bin += String.fromCharCode(out[j]);
      return { w: w, h: h, bits: btoa(bin) };
    } catch (e) {
      return null;
    }
  }

  /** An inline SVG as a picture the canvas can draw. */
  function svgImage(svg, w, h) {
    return new Promise(function (done) {
      var copy = svg.cloneNode(true);
      copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      copy.setAttribute("width", String(w));
      copy.setAttribute("height", String(h));
      var img = new Image();
      img.onload = function () {
        done(img);
      };
      img.onerror = function () {
        done(null);
      };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(copy));
    });
  }

  /**
   * The square pictures on the page that could be a QR code: images,
   * canvases and inline SVGs between 64 and 1024 pixels a side. Nothing is
   * decoded here; the app does that.
   */
  function qrImages(scope) {
    var shown = Array.prototype.filter.call(scope.querySelectorAll("img, canvas, svg"), function (el) {
      var r = el.getBoundingClientRect();
      var side = Math.max(r.width, r.height);
      return side >= 64 && side <= 1024 && Math.abs(r.width - r.height) <= side * 0.2;
    });
    return Promise.all(
      shown.slice(0, MAX_QR * 2).map(function (el) {
        var r = el.getBoundingClientRect();
        if (el.tagName === "IMG") {
          return el.complete ? bitsOf(el, el.naturalWidth || r.width, el.naturalHeight || r.height) : null;
        }
        if (el.tagName === "CANVAS") return bitsOf(el, el.width, el.height);
        // Vector: draw it at full size, whatever it is shown at.
        return svgImage(el, QR_SIDE, QR_SIDE).then(function (img) {
          return img ? bitsOf(img, QR_SIDE, QR_SIDE) : null;
        });
      })
    ).then(function (all) {
      return all.filter(Boolean).slice(0, MAX_QR);
    });
  }

  global.Autofill = {
    fill: fill,
    detect: detect,
    isLogin: isLogin,
    captured: captured,
    fillCode: fillCode,
    typedCode: typedCode,
    newPasswordBoxes: newPasswordBoxes,
    personalFields: personalFields,
    providerButton: providerButton,
    generatePassword: generatePassword,
    fillNewPassword: fillNewPassword,
    hasCodeBox: function (scope) {
      return !!codeBox(scope, 6);
    },
    printedKeys: printedKeys,
    qrImages: qrImages,
  };
})(typeof window !== "undefined" ? window : this);
/**
 * One phone number, stored as a single "+dial local" string.
 *
 * Kept as one string because that is what a form wants pasted into it and
 * what the extension sends across the bridge; the split into a country
 * picker and a number box is an interface detail, and it lives here so the
 * personal-info screen and the login editor cannot disagree about it.
 */
import { COUNTRIES, groupsForDial, keepsTrunkZero, maxDigitsForDial } from "./countries";

const DIALS = [...new Set(COUNTRIES.map((c) => c.dial))].sort((a, b) => b.length - a.length);

// Phone is stored as one "+dial local" string; split it to drive the
// separate country-code select and number input in the UI.
export function splitPhone(phone: string): { dial: string; local: string } {
  for (const d of DIALS) {
    if (phone.startsWith(d)) return { dial: d, local: phone.slice(d.length).trim() };
  }
  return { dial: "+1", local: phone };
}

// Group the national number by the country's own convention where one is
// known, else in threes. Groups are joined with a hyphen: a plain space is
// too easy to lose against a long digit run.
//
// A leading 0 is a national trunk code ("06..." in France) and is redundant
// once a country code is attached, so it is dropped — but only once a second
// digit arrives, otherwise the first 0 someone types vanishes under them.
// Italy is the notable country that keeps it.
//
// Digits past the country's longest number are dropped as they are typed.
export function formatPhoneLocal(raw: string, dial: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length > 1 && digits.startsWith("0") && !keepsTrunkZero(dial)) {
    digits = digits.replace(/^0+/, "");
  }
  digits = digits.slice(0, maxDigitsForDial(dial));

  const pattern = groupsForDial(dial);
  const out: string[] = [];
  let i = 0;
  let p = 0;
  while (i < digits.length) {
    const remaining = digits.length - i;
    let size: number;
    if (pattern && p < pattern.length) {
      size = pattern[p];
      p++;
    } else {
      size = remaining === 4 || remaining < 3 ? remaining : 3;
    }
    out.push(digits.slice(i, i + size));
    i += size;
  }
  return out.join("-");
}

// E.164 allows 15 digits total including the country code, and no national
// number is shorter than 4.
export function isValidPhone(phone: string): boolean {
  const { dial, local } = splitPhone(phone);
  const localDigits = local.replace(/\D/g, "").length;
  if (localDigits === 0) return true;
  const dialDigits = dial.replace(/\D/g, "").length;
  return localDigits >= 4 && dialDigits + localDigits <= 15;
}

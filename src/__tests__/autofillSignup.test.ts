/**
 * Sign-up help, the two-step first page, and a phone number stored without
 * spaces.
 */
import { beforeAll, describe, expect, it } from "vitest";
import "../../extension/autofill.js";

interface AutofillApi {
  detect: (scope: Document) => { passwords: number; identifier: boolean; declared: boolean };
  isLogin: (result: { passwords: number; identifier: boolean; declared?: boolean }, href: string) => boolean;
  fill: (scope: Document, data: Record<string, string>) => { filled: { field: string }[] };
  newPasswordBoxes: (scope: Document) => HTMLInputElement[];
  generatePassword: () => string;
  fillNewPassword: (scope: Document, password: string) => number;
  personalFields: (scope: Document) => number;
}
const Autofill = (window as unknown as { Autofill: AutofillApi }).Autofill;
const value = (sel: string) => (document.querySelector(sel) as HTMLInputElement).value;

beforeAll(() => {
  Element.prototype.getClientRects = function (this: Element) {
    const style = window.getComputedStyle(this);
    if (style.display === "none" || style.visibility === "hidden") return [] as unknown as DOMRectList;
    return [{ width: 100, height: 20 }] as unknown as DOMRectList;
  };
});

describe("new password", () => {
  it("fills a sign-up's password and its confirmation", () => {
    document.body.innerHTML =
      '<input name="email" type="email"><input id="p" type="password"><input id="c" type="password">';
    expect(Autofill.fillNewPassword(document, "Pw-1")).toBe(2);
    expect([value("#p"), value("#c")]).toEqual(["Pw-1", "Pw-1"]);
  });

  it("leaves a change form's current password alone", () => {
    document.body.innerHTML =
      '<label for="o">Current password</label><input id="o" type="password">' +
      '<label for="n">New password</label><input id="n" type="password">' +
      '<label for="c">Confirm</label><input id="c" type="password">';
    expect(Autofill.fillNewPassword(document, "Pw-1")).toBe(2);
    expect([value("#o"), value("#n"), value("#c")]).toEqual(["", "Pw-1", "Pw-1"]);
  });

  it("says nothing on a sign-in, unless its one box asks for a new password", () => {
    document.body.innerHTML = '<input name="email"><input type="password">';
    expect(Autofill.newPasswordBoxes(document)).toEqual([]);
    document.body.innerHTML = '<input name="email"><input type="password" autocomplete="new-password">';
    expect(Autofill.newPasswordBoxes(document)).toHaveLength(1);
  });

  it("makes 20 characters with every kind in, different each time", () => {
    const a = Autofill.generatePassword();
    expect(a).toHaveLength(20);
    for (const kind of [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/]) expect(a).toMatch(kind);
    expect(Autofill.generatePassword()).not.toBe(a);
  });
});

describe("two-step first page", () => {
  it("counts a box that declares autocomplete=username, whatever the URL", () => {
    document.body.innerHTML = '<form><input name="identifier" type="email" autocomplete="username"><button>Next</button></form>';
    const found = Autofill.detect(document);
    expect(found).toMatchObject({ passwords: 0, identifier: true, declared: true });
    expect(Autofill.isLogin(found, "http://pm-test.localhost:8765/#twostep")).toBe(true);
  });

  it("still refuses a newsletter box", () => {
    document.body.innerHTML = '<input name="email" type="email" autocomplete="email">';
    expect(Autofill.isLogin(Autofill.detect(document), "https://example.com/blog")).toBe(false);
  });
});

describe("phone stored without spaces", () => {
  it("splits the dial code where the country code ends", () => {
    for (const [phone, dial, local] of [
      ["+33612345678", "+33", "612345678"],
      ["+15551234567", "+1", "5551234567"],
      ["+442079460000", "+44", "2079460000"],
      ["+971501234567", "+971", "501234567"],
    ]) {
      document.body.innerHTML =
        '<select id="d" aria-label="Country code"><option>+1</option><option>+33</option><option>+44</option><option>+971</option></select>' +
        '<input id="n" name="phone" type="tel"><input id="p" type="password">';
      Autofill.fill(document, { username: "", password: "pw", phone });
      expect([value("#d"), value("#n")], phone).toEqual([dial, local]);
    }
  });
});

describe("personal info", () => {
  // The test site's "Create account" page.
  const REGISTER = `<form>
    <label for="fn">First name</label><input id="fn" name="first_name" autocomplete="given-name">
    <label for="ln">Last name</label><input id="ln" name="last_name" autocomplete="family-name">
    <label for="e">Email</label><input id="e" name="email" type="email" autocomplete="email">
    <label for="n">Phone</label><select id="d" name="country_code" aria-label="Country code"><option>+1</option><option>+33</option></select>
    <input id="n" name="phone" type="tel" autocomplete="tel-national">
    <label for="b">Date of birth</label><input id="b" name="birthdate" type="date" autocomplete="bday">
    <label for="a">Street address</label><input id="a" name="address" autocomplete="street-address">
    <label for="c">City</label><input id="c" name="city" autocomplete="address-level2">
    <label for="z">Postal code</label><input id="z" name="zip" autocomplete="postal-code">
    <label for="co">Country</label><select id="co" name="country" autocomplete="country-name"><option value="">Choose</option><option>France</option></select>
    <label for="p">Password</label><input id="p" name="password" type="password" autocomplete="new-password">
    <label for="pc">Confirm password</label><input id="pc" name="confirm" type="password" autocomplete="new-password">
  </form>`;

  it("fills every box from the profile, the name split in two, and no password", () => {
    document.body.innerHTML = REGISTER;
    Autofill.fill(document, {
      name: "Ada Byron Lovelace",
      email: "ada@example.com",
      phone: "+33 7-53-52-32-39",
      date_of_birth: "1815-12-10",
      address: "12 rue de Rivoli",
      city: "Paris",
      zip: "75001",
      country: "France",
    });
    expect(["#fn", "#ln", "#e", "#d", "#n", "#b", "#a", "#c", "#z", "#co", "#p", "#pc"].map(value)).toEqual([
      "Ada", "Byron Lovelace", "ada@example.com", "+33", "753523239", "1815-12-10",
      "12 rue de Rivoli", "Paris", "75001", "France", "", "",
    ]);
  });

  it("counts a sign-up as a profile form and a sign-in as not", () => {
    document.body.innerHTML = REGISTER;
    expect(Autofill.personalFields(document)).toBeGreaterThanOrEqual(2);
    document.body.innerHTML = '<input name="email" type="email"><input type="password">';
    expect(Autofill.personalFields(document)).toBe(1);
  });
});

describe("GitHub", () => {
  it("writes the handle, or a link where the box asks for one", () => {
    document.body.innerHTML =
      '<label for="g">GitHub username</label><input id="g" name="github_user">' +
      '<label for="u">GitHub profile URL</label><input id="u" name="github_url" type="url">';
    Autofill.fill(document, { github: "yaghmo" });
    expect(value("#g")).toBe("yaghmo");
    document.body.innerHTML = '<label for="u">GitHub profile URL</label><input id="u" name="github_url" type="url">';
    Autofill.fill(document, { github: "yaghmo" });
    expect(value("#u")).toBe("https://github.com/yaghmo");
  });
});

describe("profile username", () => {
  it("never lands in the email box when the profile has an email", () => {
    document.body.innerHTML =
      '<label for="e">Email</label><input id="e" name="email" type="email"><input id="p" type="password" autocomplete="new-password">';
    Autofill.fill(document, { email: "ada@example.com", username: "ada99" });
    expect(value("#e")).toBe("ada@example.com");
  });

  it("keeps the email in a box that also says autocomplete=username", () => {
    // The test site's Sign up page, and most real ones.
    document.body.innerHTML =
      '<input id="e" name="email" type="email" autocomplete="username">' +
      '<input id="p" type="password" autocomplete="new-password"><input id="c" type="password" autocomplete="new-password">';
    Autofill.fill(document, { name: "Ada L", email: "ada@example.com", username: "ada99" });
    expect(value("#e")).toBe("ada@example.com");
  });

  it("still goes into a sign-in's email box when that is the only box", () => {
    document.body.innerHTML = '<input id="e" name="email" type="email"><input id="p" type="password">';
    Autofill.fill(document, { username: "me@site.test", password: "pw" });
    expect(value("#e")).toBe("me@site.test");
  });
});

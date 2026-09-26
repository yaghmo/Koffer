import { beforeAll, describe, expect, it } from "vitest";
import "../../extension/autofill.js";

const Autofill = (window as unknown as { Autofill: { fillCode: (s: Document, code: string) => boolean } }).Autofill;

beforeAll(() => {
  // jsdom lays nothing out; give every shown element one box.
  Element.prototype.getClientRects = function (this: Element) {
    const style = window.getComputedStyle(this);
    if (style.display === "none" || style.visibility === "hidden") return [] as unknown as DOMRectList;
    return [{ width: 100, height: 20 }] as unknown as DOMRectList;
  };
});

const value = (sel: string) => (document.querySelector(sel) as HTMLInputElement).value;

describe("fillCode", () => {
  it("fills the box the page marks as a one-time code", () => {
    document.body.innerHTML = '<input name="search"><input name="x" autocomplete="one-time-code">';
    expect(Autofill.fillCode(document, "287082")).toBe(true);
    expect(value('[name="x"]')).toBe("287082");
    expect(value('[name="search"]')).toBe("");
  });

  it("finds the box by its label, in more than one language", () => {
    for (const label of ["Verification code", "Code de vérification", "Authenticator code", "2FA"]) {
      document.body.innerHTML = `<label for="c">${label}</label><input id="c" inputmode="numeric">`;
      expect(Autofill.fillCode(document, "287082")).toBe(true);
      expect(value("#c")).toBe("287082");
    }
  });

  it("spreads the digits over one box per digit", () => {
    document.body.innerHTML = Array.from({ length: 6 }, (_, i) => `<input maxlength="1" name="d${i}">`).join("");
    expect(Autofill.fillCode(document, "287082")).toBe(true);
    expect(Array.from({ length: 6 }, (_, i) => value(`[name="d${i}"]`)).join("")).toBe("287082");
  });

  it("leaves other kinds of code alone", () => {
    document.body.innerHTML = '<label for="z">Zip code</label><input id="z"><label for="p">Promo code</label><input id="p">';
    expect(Autofill.fillCode(document, "287082")).toBe(false);
  });

  it("never types the code into a password box or an unnamed field", () => {
    document.body.innerHTML = '<input name="q"><input type="password" name="password">';
    expect(Autofill.fillCode(document, "287082")).toBe(false);
    expect(value('[name="q"]')).toBe("");
    expect(value('[name="password"]')).toBe("");
  });
});

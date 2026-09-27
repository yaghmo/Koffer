import { beforeAll, describe, expect, it } from "vitest";
import "../../extension/autofill.js";

const Autofill = (
  window as unknown as {
    Autofill: {
      fillCode: (s: Document, code: string) => boolean;
      typedCode: (s: Document) => string;
      hasCodeBox: (s: Document) => boolean;
      printedKeys: (s: Document) => string[];
    };
  }
).Autofill;

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

describe("typedCode", () => {
  it("reads a whole code from the code box, and nothing short of one", () => {
    document.body.innerHTML = '<input name="q" value="123456"><input autocomplete="one-time-code" value="28 70 82">';
    expect(Autofill.typedCode(document)).toBe("287082");
    (document.querySelector("[autocomplete]") as HTMLInputElement).value = "2870";
    expect(Autofill.typedCode(document)).toBe("");
  });

  it("joins a row of one-digit boxes", () => {
    document.body.innerHTML = Array.from({ length: 6 }, (_, i) => `<input maxlength="1" value="${"287082"[i]}">`).join("");
    expect(Autofill.typedCode(document)).toBe("287082");
  });

  it("reads nothing from a page with no code box", () => {
    document.body.innerHTML = '<label for="z">Zip code</label><input id="z" value="902101">';
    expect(Autofill.typedCode(document)).toBe("");
    expect(Autofill.hasCodeBox(document)).toBe(false);
  });

  it("says when the page has a code box, empty or not", () => {
    document.body.innerHTML = '<label for="z">Zip code</label><input id="z"><input autocomplete="one-time-code">';
    expect(Autofill.hasCodeBox(document)).toBe(true);
  });
});

describe("printedKeys", () => {
  // jsdom has no `innerText`, which breaks lines between blocks in a
  // browser; the markup's own line breaks stand in for it.
  it("finds a key printed in groups, in either case, without the words around it", () => {
    document.body.innerHTML = `<p>Can't scan it? Enter this key</p>
<code>jbsw y3dp ehpk 3pxp</code>
<p>then the code</p>`;
    expect(Autofill.printedKeys(document)).toContain("JBSWY3DPEHPK3PXP");
  });

  it("finds a key in one run", () => {
    document.body.innerHTML = "<p>Setup key:</p><p>GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ</p>";
    expect(Autofill.printedKeys(document)).toEqual(["GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"]);
  });

  it("ignores ordinary words in groups of four", () => {
    document.body.innerHTML = "<p>this code will make your life easy</p>";
    expect(Autofill.printedKeys(document)).toEqual([]);
  });
});

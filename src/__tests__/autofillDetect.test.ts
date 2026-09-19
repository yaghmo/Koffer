import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import "../../extension/autofill.js";

interface Detected {
  passwords: number;
  identifier: boolean;
}
interface AutofillApi {
  detect: (scope?: Element | Document) => Detected;
  isLogin: (result: Detected, href: string) => boolean;
}
const Autofill = (window as unknown as { Autofill: AutofillApi }).Autofill;

beforeAll(() => {
  // jsdom lays nothing out, so every element reports zero client rects and
  // autofill.js would call the whole page invisible. One box for everything
  // is enough: the visibility rules that matter here (type="hidden",
  // disabled, display:none) are checked separately from the rects.
  Element.prototype.getClientRects = function (this: Element) {
    const style = window.getComputedStyle(this);
    const hidden = style.display === "none" || style.visibility === "hidden";
    return (hidden ? [] : [{ width: 100, height: 20 }]) as unknown as DOMRectList;
  };
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("detect", () => {
  it("reads a sign-in form as one password box and an identifier", () => {
    document.body.innerHTML = `
      <form>
        <input name="username">
        <input name="password" type="password">
      </form>`;
    expect(Autofill.detect(document)).toEqual({ passwords: 1, identifier: true });
  });

  it("counts both boxes on a sign-up form", () => {
    // The count is what keeps a saved login from being offered here.
    document.body.innerHTML = `
      <form>
        <input name="email" type="email">
        <input name="password" type="password">
        <input name="confirmPassword" type="password">
      </form>`;
    expect(Autofill.detect(document).passwords).toBe(2);
  });

  it("ignores a hidden password box", () => {
    document.body.innerHTML = `
      <input name="password" type="password">
      <input name="oldPassword" type="password" style="display:none">`;
    expect(Autofill.detect(document).passwords).toBe(1);
  });

  it("finds nothing on a page that only has a search box", () => {
    document.body.innerHTML = `<input name="q" type="search">`;
    expect(Autofill.detect(document)).toEqual({ passwords: 0, identifier: false });
  });

  it("sees the identifier on step one of a two-step login", () => {
    document.body.innerHTML = `<input name="email" type="email">`;
    expect(Autofill.detect(document)).toEqual({ passwords: 0, identifier: true });
  });
});

describe("isLogin", () => {
  const url = "https://example.com/";

  it("says yes to exactly one password box, wherever it is", () => {
    expect(Autofill.isLogin({ passwords: 1, identifier: true }, url)).toBe(true);
    expect(Autofill.isLogin({ passwords: 1, identifier: false }, url)).toBe(true);
  });

  it("says no to a sign-up or change-password form", () => {
    expect(Autofill.isLogin({ passwords: 2, identifier: true }, url)).toBe(false);
    expect(Autofill.isLogin({ passwords: 3, identifier: true }, url)).toBe(false);
  });

  it("accepts an identifier-only page when the URL says it is a login", () => {
    const state = { passwords: 0, identifier: true };
    for (const href of [
      "https://accounts.google.com/signin/v2/identifier",
      "https://login.microsoftonline.com/",
      "https://example.com/sign-in",
      "https://example.com/log_in?next=/",
      "https://example.com/auth/start",
    ]) {
      expect(Autofill.isLogin(state, href), href).toBe(true);
    }
  });

  it("refuses an identifier-only page anywhere else", () => {
    // Otherwise every newsletter box on the web badges as a login.
    const state = { passwords: 0, identifier: true };
    for (const href of [
      "https://example.com/",
      "https://example.com/blog/post",
      "https://example.com/newsletter",
      "https://example.com/contact",
    ]) {
      expect(Autofill.isLogin(state, href), href).toBe(false);
    }
  });

  it("refuses a page with neither, whatever the URL", () => {
    expect(Autofill.isLogin({ passwords: 0, identifier: false }, "https://x.com/login")).toBe(false);
  });
});

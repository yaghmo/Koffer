import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import "../../extension/autofill.js";

interface Detected {
  passwords: number;
  identifier: boolean;
}
interface FillResult {
  formFound: boolean;
  filled: string[];
  missing: string[];
  retried?: boolean;
}
interface AutofillApi {
  detect: (scope?: Element | Document) => Detected;
  isLogin: (result: Detected, href: string) => boolean;
  fill: (scope: Element | Document, data: Record<string, string>) => FillResult;
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

describe("fill survives a re-render", () => {
  const creds = { username: "me@example.test", password: "hunter2hunter" };

  function form() {
    document.body.innerHTML = `
      <form>
        <input name="username" autocomplete="username">
        <input name="password" type="password">
      </form>`;
    return {
      user: document.querySelector<HTMLInputElement>('input[name="username"]')!,
      pass: document.querySelector<HTMLInputElement>('input[name="password"]')!,
    };
  }

  it("fills both fields on a form that stays put", () => {
    const { user, pass } = form();
    Autofill.fill(document, creds);
    expect(user.value).toBe(creds.username);
    expect(pass.value).toBe(creds.password);
  });

  it("still fills the password when the first keystroke replaces the node", () => {
    // Exactly the Twitch symptom: switching accounts updated the username
    // and left the old password. React re-renders on the username's `input`
    // event and throws away the password element the fill was holding.
    const { user } = form();
    user.addEventListener("input", () => {
      const old = document.querySelector<HTMLInputElement>('input[type="password"]')!;
      const fresh = document.createElement("input");
      fresh.type = "password";
      fresh.name = "password";
      old.replaceWith(fresh);
    });

    const out = Autofill.fill(document, creds);
    const pass = document.querySelector<HTMLInputElement>('input[type="password"]')!;
    expect(pass.value).toBe(creds.password);
    expect(out.retried).toBe(true);
  });

  it("does not retry when the first pass already worked", () => {
    form();
    expect(Autofill.fill(document, creds).retried).toBeUndefined();
  });

  it("gives up rather than looping when the page keeps clearing the field", () => {
    const { user } = form();
    user.addEventListener("input", () => {
      document.querySelector<HTMLInputElement>('input[type="password"]')!.value = "";
    });
    // The point is that this returns at all.
    expect(() => Autofill.fill(document, creds)).not.toThrow();
  });
});

describe("fill reports what actually landed", () => {
  const creds = { username: "me@example.test", password: "hunter2hunter" };

  it("names both fields when both stuck", () => {
    document.body.innerHTML = `
      <input name="username" autocomplete="username">
      <input name="password" type="password">`;
    const out = Autofill.fill(document, creds);
    expect(out.filled.sort()).toEqual(["password", "username"]);
    expect(out.missing).toEqual([]);
  });

  it("does not claim a password it could not place", () => {
    // The form has no password box at all. Reporting "filled: password"
    // here is what would let the popup say everything was fine.
    document.body.innerHTML = `<input name="username" autocomplete="username">`;
    const out = Autofill.fill(document, creds);
    expect(out.filled).toEqual(["username"]);
    expect(out.missing).toEqual(["password"]);
  });

  it("does not claim a value the page threw away", () => {
    document.body.innerHTML = `
      <input name="username" autocomplete="username">
      <input name="password" type="password">`;
    // A page that refuses to hold a password however often it is written.
    // Setting `.value` directly dispatches nothing, so this cannot loop.
    const pass = document.querySelector<HTMLInputElement>('input[type="password"]')!;
    pass.addEventListener("input", () => {
      pass.value = "";
    });
    const out = Autofill.fill(document, creds);
    expect(out.filled).toEqual(["username"]);
    expect(out.missing).toEqual(["password"]);
  });
});

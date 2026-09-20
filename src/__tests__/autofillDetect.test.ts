import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import "../../extension/autofill.js";

interface Detected {
  passwords: number;
  identifier: boolean;
}
interface FillResult {
  formFound: boolean;
  filled: { field: string; value: string; matchedBy: string }[];
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
    if (hidden) return [] as unknown as DOMRectList;
    // A box with no area: still one rect, which is what a sign-in page's
    // collapsed password field looks like before the step that asks for it.
    const collapsed = this.hasAttribute("data-collapsed");
    return [
      collapsed ? { width: 0, height: 0 } : { width: 100, height: 20 },
    ] as unknown as DOMRectList;
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

  it("counts a password box the site's own eye has revealed", () => {
    // Clicking "show password" flips the field to type="text". Counting only
    // the masked type read this page as "no login here", and the badge, the
    // menu and the popup all went quiet on a form that was right there.
    document.body.innerHTML = `
      <form>
        <input name="username">
        <input name="password" type="text">
      </form>`;
    expect(Autofill.detect(document)).toEqual({ passwords: 1, identifier: true });
  });

  it("still sees a sign-up form as two boxes once they are revealed", () => {
    // The count is the guard that stops a saved login being offered on a
    // registration form, so revealing the boxes must not disarm it.
    document.body.innerHTML = `
      <form>
        <input name="email" type="email">
        <input name="password" type="text">
        <input name="confirm-password" type="text">
      </form>`;
    expect(Autofill.detect(document).passwords).toBe(2);
  });

  it("ignores a password box that is mounted but collapsed", () => {
    // Found live on a Google sign-in: the password input is in the DOM
    // during the step that only asks for an email, sized to nothing. It has
    // a client rect, so "has a box" counted it, and the fill wrote the
    // password into a field nobody could see.
    document.body.innerHTML = `
      <form>
        <input name="email" type="email">
        <input name="password" type="password" data-collapsed>
      </form>`;
    expect(Autofill.detect(document)).toEqual({ passwords: 0, identifier: true });
  });

  it("ignores a password box that is there but transparent", () => {
    document.body.innerHTML = `
      <input name="password" type="password" style="opacity: 0">`;
    expect(Autofill.detect(document).passwords).toBe(0);
  });

  it("does not mistake a search box for a revealed password", () => {
    document.body.innerHTML = `
      <input type="search" name="password-search" placeholder="Search passwords">`;
    expect(Autofill.detect(document).passwords).toBe(0);
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

describe("fill finds a revealed password box", () => {
  const creds = { username: "me@example.test", password: "hunter2hunter" };

  it("fills a password field the site has un-masked", () => {
    // A site's own "show password" eye flips the input to type="text".
    // Matching on the type alone meant the filler silently stopped working
    // the moment the user revealed the field — which looked exactly like
    // "it fills the username but never the password".
    document.body.innerHTML = `
      <input name="username" autocomplete="username">
      <input name="password" type="text" autocomplete="current-password">`;
    Autofill.fill(document, creds);
    expect(
      document.querySelector<HTMLInputElement>('input[name="password"]')!.value
    ).toBe(creds.password);
  });

  it("still fills the masked field, which is the normal case", () => {
    document.body.innerHTML = `
      <input name="username" autocomplete="username">
      <input name="password" type="password">`;
    Autofill.fill(document, creds);
    expect(
      document.querySelector<HTMLInputElement>('input[type="password"]')!.value
    ).toBe(creds.password);
  });

  it("does not mistake a sign-up confirm box for the password box", () => {
    document.body.innerHTML = `
      <input name="password" type="password">
      <input name="confirmPassword" type="password">`;
    Autofill.fill(document, creds);
    expect(document.querySelector<HTMLInputElement>('input[name="password"]')!.value).toBe(
      creds.password
    );
    expect(
      document.querySelector<HTMLInputElement>('input[name="confirmPassword"]')!.value
    ).toBe("");
  });
});

describe("phone boxes", () => {
  it("never puts a username in a phone-only box", () => {
    // TikTok opens its sign-in on a phone tab. The box matched the username
    // role well enough to be filled with a username it will never accept,
    // and the real username box was never reached.
    document.body.innerHTML = `
      <form>
        <input name="login-mobile" placeholder="Phone number">
        <input name="password" type="password">
      </form>`;
    const out = Autofill.fill(document, { username: "me", password: "hunter2" });
    expect(out.missing).toContain("username");
    expect((document.querySelector('input[name="login-mobile"]') as HTMLInputElement).value).toBe(
      ""
    );
  });

  it("still fills a box that takes either a phone or a username", () => {
    // Facebook's single login box is named `email` and reads "Email address
    // or phone number". It takes either, and the username belongs in it.
    document.body.innerHTML = `
      <form>
        <input name="email" placeholder="Email address or phone number">
        <input name="password" type="password">
      </form>`;
    Autofill.fill(document, { username: "me@test.example", password: "hunter2" });
    expect((document.querySelector('input[name="email"]') as HTMLInputElement).value).toBe(
      "me@test.example"
    );
  });

  it("puts the whole number in a lone phone box", () => {
    document.body.innerHTML = `<input type="tel" name="phone">`;
    Autofill.fill(document, { phone: "+1 555-123-4567" });
    expect((document.querySelector("input") as HTMLInputElement).value).toBe("+1 555-123-4567");
  });

  it("splits the dial code off when the form has a picker for it", () => {
    document.body.innerHTML = `
      <form>
        <select name="country-code">
          <option value="">Pick</option>
          <option value="+44">United Kingdom (+44)</option>
          <option value="+1">United States (+1)</option>
        </select>
        <input type="tel" name="phone">
      </form>`;
    const out = Autofill.fill(document, { phone: "+1 555-123-4567" });
    expect(out.missing).not.toContain("phone");
    expect((document.querySelector("select") as HTMLSelectElement).value).toBe("+1");
    expect((document.querySelector('input[name="phone"]') as HTMLInputElement).value).toBe(
      "555-123-4567"
    );
  });

  it("matches a picker by its label when the values are not dial codes", () => {
    document.body.innerHTML = `
      <form>
        <select name="dialCode">
          <option value="gb">United Kingdom +44</option>
          <option value="us">United States +1</option>
        </select>
        <input type="tel" name="phone">
      </form>`;
    Autofill.fill(document, { phone: "+1 555-123-4567" });
    expect((document.querySelector("select") as HTMLSelectElement).value).toBe("us");
  });

  it("leaves a picker alone when no option means this dial code", () => {
    // Assigning a value no option carries silently leaves the select on its
    // first entry, which would say "United Kingdom" for a US number.
    document.body.innerHTML = `
      <form>
        <select name="country-code"><option value="+44">United Kingdom</option></select>
        <input type="tel" name="phone">
      </form>`;
    Autofill.fill(document, { phone: "+1 555-123-4567" });
    expect((document.querySelector("select") as HTMLSelectElement).value).toBe("+44");
    // And the number box keeps the dial code, because nothing else carries it.
    expect((document.querySelector('input[name="phone"]') as HTMLInputElement).value).toBe(
      "+1 555-123-4567"
    );
  });
});

describe("filling a revealed password", () => {
  it("writes into the unmasked box", () => {
    document.body.innerHTML = `
      <form>
        <input name="username">
        <input name="password" type="text">
      </form>`;
    const out = Autofill.fill(document, { username: "me", password: "hunter2" });
    expect(out.missing).not.toContain("password");
    expect((document.querySelector('input[name="password"]') as HTMLInputElement).value).toBe(
      "hunter2"
    );
  });

  it("never writes into a collapsed box", () => {
    document.body.innerHTML = `
      <form>
        <input name="username">
        <input name="password" type="password" data-collapsed>
      </form>`;
    const out = Autofill.fill(document, { username: "me", password: "hunter2" });
    expect(out.missing).toContain("password");
    expect((document.querySelector('input[name="password"]') as HTMLInputElement).value).toBe(
      ""
    );
  });

  it("never writes a password into a search box that happens to be named one", () => {
    // The name match alone used to be enough, which meant a password could
    // be typed into a site's own search field and submitted with it.
    document.body.innerHTML = `<input type="search" name="passwd">`;
    const out = Autofill.fill(document, { password: "hunter2" });
    expect(out.missing).toContain("password");
    expect((document.querySelector("input") as HTMLInputElement).value).toBe("");
  });
});

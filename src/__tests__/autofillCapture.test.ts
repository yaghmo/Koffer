import { beforeAll, describe, expect, it } from "vitest";
import "../../extension/autofill.js";

interface Captured {
  username: string;
  password: string;
  current: string;
}
const Autofill = (
  window as unknown as {
    Autofill: {
      captured: (s: Element | Document) => Captured | null;
      detect: (s: Element | Document) => { passwords: number; filled: number };
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

function page(html: string, values: Record<string, string>) {
  document.body.innerHTML = html;
  for (const [name, value] of Object.entries(values)) {
    (document.querySelector(`[name="${name}"]`) as HTMLInputElement).value = value;
  }
  return document;
}

describe("captured", () => {
  it("reads a sign-in", () => {
    const d = page('<form><input name="email" type="email"><input name="password" type="password"></form>', {
      email: " me@site.test ",
      password: "pw",
    });
    expect(Autofill.captured(d)).toEqual({ username: "me@site.test", password: "pw", current: "" });
  });

  it("reads a sign-up's password once", () => {
    const d = page(
      '<form><input name="username"><input name="password" type="password"><input name="confirm" type="password"></form>',
      { username: "me", password: "pw", confirm: "pw" },
    );
    expect(Autofill.captured(d)).toEqual({ username: "me", password: "pw", current: "" });
  });

  it("reads a change-password form's new and current passwords", () => {
    const d = page(
      '<form><input name="old" type="password" autocomplete="current-password">' +
        '<input name="new" type="password" autocomplete="new-password"></form>',
      { old: "before", new: "after" },
    );
    expect(Autofill.captured(d)).toEqual({ username: "", password: "after", current: "before" });
  });

  it("reads a change form with a confirm box", () => {
    const d = page(
      '<form><input name="old" type="password"><input name="new" type="password"><input name="again" type="password"></form>',
      { old: "before", new: "after", again: "after" },
    );
    expect(Autofill.captured(d)).toEqual({ username: "", password: "after", current: "before" });
  });

  it("has nothing to say when the new password and its confirmation disagree", () => {
    // The site refuses this, so there is no new password to offer.
    const d = page(
      '<form><input name="old" type="password"><input name="new" type="password"><input name="again" type="password"></form>',
      { old: "before", new: "after", again: "aftr" },
    );
    expect(Autofill.captured(d)).toBeNull();
  });

  it("counts the password boxes that still hold something", () => {
    const d = page('<form><input name="a" type="password"><input name="b" type="password"></form>', { a: "x" });
    expect(Autofill.detect(d)).toMatchObject({ passwords: 2, filled: 1 });
  });

  it("has nothing to say about an empty password", () => {
    const d = page('<form><input name="email" type="email"><input name="password" type="password"></form>', {
      email: "me@site.test",
    });
    expect(Autofill.captured(d)).toBeNull();
  });

  it("reads the username alone on step one of a two-step sign-in", () => {
    const d = page('<form><input name="email" type="email"></form>', { email: "me@site.test" });
    expect(Autofill.captured(d)).toEqual({ username: "me@site.test", password: "", current: "" });
  });
});

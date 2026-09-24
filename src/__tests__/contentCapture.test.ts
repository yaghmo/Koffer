/**
 * The content script's half of "offer to save": a submitted login is handed
 * to the background script, and nothing is kept here.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sent: Record<string, unknown>[] = [];

beforeAll(async () => {
  Element.prototype.getClientRects = function (this: Element) {
    const style = window.getComputedStyle(this);
    if (style.display === "none" || style.visibility === "hidden") return [] as unknown as DOMRectList;
    return [{ width: 100, height: 20 }] as unknown as DOMRectList;
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: (m: Record<string, unknown>) => {
        sent.push(m);
        return Promise.resolve();
      },
      onMessage: { addListener: () => {} },
    },
  };
  // @ts-expect-error untyped extension source
  await import("../../extension/autofill.js");
  // @ts-expect-error untyped extension source
  await import("../../extension/content.js");
});

beforeEach(() => {
  sent.length = 0;
  vi.useRealTimers();
});

function login(values: { email?: string; password?: string }) {
  document.body.innerHTML =
    '<form><input name="email" type="email"><input name="password" type="password">' +
    '<button type="submit">Log in</button></form>';
  const form = document.querySelector("form")!;
  form.addEventListener("submit", (e) => e.preventDefault());
  (document.querySelector('[name="email"]') as HTMLInputElement).value = values.email ?? "";
  (document.querySelector('[name="password"]') as HTMLInputElement).value = values.password ?? "";
  return form;
}

const captures = () => sent.filter((m) => m.type === "captured");

describe("content capture", () => {
  it("hands a submitted login to the background script", () => {
    login({ email: "me@site.test", password: "pw" }).requestSubmit();
    expect(captures()).toEqual([
      { type: "captured", origin: location.origin, username: "me@site.test", password: "pw", current: "" },
    ]);
  });

  it("ignores a submit the page forged", () => {
    const form = login({ email: "me@site.test", password: "pw" });
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(captures()).toEqual([]);
  });

  it("sends nothing for a form with no password typed", () => {
    login({ email: "me@site.test" }).requestSubmit();
    expect(captures()).toEqual([]);
  });
});

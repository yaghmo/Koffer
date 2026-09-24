/**
 * The content script's half of "offer to save": a submitted login is handed
 * to the background script, and nothing is kept here.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sent: Record<string, unknown>[] = [];
type Listener = (msg: Record<string, unknown>, sender: unknown, respond: (r: unknown) => void) => boolean;
let listener: Listener;

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
      onMessage: {
        addListener: (fn: Listener) => {
          listener = fn;
        },
      },
    },
  };
  // @ts-expect-error untyped extension source
  await import("../../extension/autofill.js");
  // @ts-expect-error untyped extension source
  await import("../../extension/bar.js");
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

describe("offer bar plumbing", () => {
  type Show = (view: unknown, onChoice: (c: string) => void) => unknown;
  const bar = () => (window as unknown as { PMBar: { show: Show; hide: () => void } }).PMBar;

  it("shows the bar the background asks for", () => {
    listener({ type: "offer", view: { kind: "new", host: "site.test", username: "me" } }, null, () => {});
    expect(document.querySelector("[data-pm-bar]")).not.toBeNull();
    bar().hide();
  });

  it("sends the choice back to the background", () => {
    const show = vi.spyOn(bar(), "show");
    listener({ type: "offer", view: { kind: "update", host: "site.test", username: "me" } }, null, () => {});
    const onChoice = show.mock.calls[0][1];
    onChoice("later");
    expect(sent).toContainEqual({ type: "offer-choice", choice: "later" });
    // Anything but Save closes the bar at once.
    expect(document.querySelector("[data-pm-bar]")).toBeNull();
    show.mockRestore();
  });
});

/**
 * The content script's half of a two-step login.
 *
 * `autofill.js` can only write into boxes that exist. On step one of a
 * Google/Microsoft-style sign-in there is no password box at all, and the
 * popup has closed by the time there is — so the password is held here, in
 * the isolated world, until the second step mounts. That is the one place
 * this extension keeps a credential in memory, which is reason enough to
 * pin down exactly when it lets go of it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (
  msg: Record<string, unknown>,
  sender: unknown,
  respond: (r: Record<string, unknown>) => void
) => boolean;

let listener: Listener;

function fill(data: Record<string, string>) {
  let out: Record<string, unknown> = {};
  listener({ type: "fill", origin: location.origin, data }, null, (r) => {
    out = r;
  });
  return out;
}

function valueOf(selector: string) {
  return (document.querySelector(selector) as HTMLInputElement | null)?.value;
}

/** Let the MutationObserver deliver, then run the settle timer. */
async function settle(ms = 500) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeAll(async () => {
  vi.useFakeTimers();
  // jsdom lays nothing out, so every element reports zero client rects and
  // autofill.js would call the whole page invisible.
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
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: () => Promise.resolve(),
      onMessage: {
        addListener: (fn: Listener) => {
          listener = fn;
        },
      },
    },
  };
  // Imported for their side effects, after the stub above exists: both are
  // plain JS with no declarations, which is what these suppressions are for.
  // @ts-expect-error untyped extension source
  await import("../../extension/autofill.js");
  // @ts-expect-error untyped extension source
  await import("../../extension/content.js");
});

afterAll(() => vi.useRealTimers());

beforeEach(async () => {
  // A page with a password box clears anything still pending from the last
  // test, which is also how the real thing lets go of it.
  document.body.innerHTML = '<input name="password" type="password">';
  await settle();
  document.body.innerHTML = "";
  await settle();
});

describe("two-step login", () => {
  it("writes the password when the second step mounts", async () => {
    document.body.innerHTML = '<form><input name="email" type="email"></form>';
    const out = fill({ email: "me@test.example", password: "hunter2" });
    expect(out.twoStep).toBe(true);
    expect(out.missing).toContain("password");
    expect(valueOf('input[name="email"]')).toBe("me@test.example");

    document.body.innerHTML = '<form><input name="password" type="password"></form>';
    await settle();
    expect(valueOf('input[name="password"]')).toBe("hunter2");
  });

  it("only holds it once — a later password box gets nothing", async () => {
    document.body.innerHTML = '<form><input name="email" type="email"></form>';
    fill({ email: "me@test.example", password: "hunter2" });

    document.body.innerHTML = '<form><input name="password" type="password"></form>';
    await settle();
    expect(valueOf('input[name="password"]')).toBe("hunter2");

    // A second form on the same page is not the second step of anything.
    document.body.innerHTML = '<form><input name="password" type="password"></form>';
    await settle();
    expect(valueOf('input[name="password"]')).toBe("");
  });

  it("lets go of it after a minute", async () => {
    document.body.innerHTML = '<form><input name="email" type="email"></form>';
    expect(fill({ email: "me@test.example", password: "hunter2" }).twoStep).toBe(true);

    await settle(61_000);
    document.body.innerHTML = '<form><input name="password" type="password"></form>';
    await settle();
    expect(valueOf('input[name="password"]')).toBe("");
  });

  it("holds nothing when the page already has a password box", async () => {
    // An ordinary sign-in form: the password landed, so there is nothing to
    // wait for and nothing to keep.
    document.body.innerHTML =
      '<form><input name="username"><input name="password" type="password"></form>';
    const out = fill({ username: "me", password: "hunter2" });
    expect(out.twoStep).toBe(false);
    expect(valueOf('input[name="password"]')).toBe("hunter2");

    document.body.innerHTML = '<form><input name="password" type="password"></form>';
    await settle();
    expect(valueOf('input[name="password"]')).toBe("");
  });

  it("refuses a fill aimed at an origin this page is no longer on", async () => {
    document.body.innerHTML = '<form><input name="email" type="email"></form>';
    let out: Record<string, unknown> = {};
    listener(
      { type: "fill", origin: "https://somewhere.else.example", data: { password: "hunter2" } },
      null,
      (r) => {
        out = r;
      }
    );
    expect(out.wrongOrigin).toBe(location.origin);

    document.body.innerHTML = '<form><input name="password" type="password"></form>';
    await settle();
    expect(valueOf('input[name="password"]')).toBe("");
  });
});

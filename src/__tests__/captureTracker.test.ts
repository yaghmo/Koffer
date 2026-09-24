import { describe, expect, it, vi } from "vitest";
// @ts-expect-error untyped extension source
import { createTracker, sameSite, isFresh, HOLD_MS, CONFIRM_MS } from "../../extension/capture.js";

function harness(state: { login: boolean; origin: string; passwords?: number } | null) {
  const saved = new Map<number, unknown>();
  let clock = 1_000;
  const timers: (() => Promise<void> | void)[] = [];
  const onSuccess = vi.fn();
  const tracker = createTracker({
    store: {
      get: async (t: number) => saved.get(t) ?? null,
      set: async (t: number, v: unknown) => void (v === null ? saved.delete(t) : saved.set(t, v)),
    },
    askState: async () => state,
    onSuccess,
    now: () => clock,
    setTimer: (fn: () => void) => timers.push(fn),
  });
  return {
    tracker,
    onSuccess,
    saved,
    tick: (ms: number) => (clock += ms),
    fire: async () => {
      for (const fn of timers.splice(0)) await fn();
    },
  };
}

const cap = { origin: "https://accounts.site.test", username: "me", password: "pw", current: "" };

describe("sameSite", () => {
  it("treats subdomains of one site as one site", () => {
    expect(sameSite("https://accounts.site.test", "https://www.site.test")).toBe(true);
    expect(sameSite("https://a.example.co.uk", "https://b.example.co.uk")).toBe(true);
  });
  it("keeps short real domains whole", () => {
    expect(sameSite("https://login.gmx.de", "https://www.gmx.de")).toBe(true);
    expect(sameSite("https://id.web.de", "https://web.de")).toBe(true);
    expect(sameSite("https://gmx.de", "https://web.de")).toBe(false);
  });

  it("does not treat an OAuth hop as the same site", () => {
    expect(sameSite("https://site.test", "https://accounts.google.com")).toBe(false);
    expect(sameSite("https://one.co.uk", "https://two.co.uk")).toBe(false);
  });
});

describe("tracker", () => {
  it("succeeds once the form has stayed gone", async () => {
    const h = harness({ login: false, origin: "https://www.site.test", passwords: 0 });
    await h.tracker.captured(1, cap);
    await h.tracker.detected(1, { login: false, origin: "https://www.site.test", passwords: 0 });
    expect(h.onSuccess).not.toHaveBeenCalled();
    h.tick(CONFIRM_MS);
    await h.fire();
    expect(h.onSuccess).toHaveBeenCalledWith(1, expect.objectContaining({ username: "me", password: "pw" }));
  });

  it("never succeeds while the login form is still up", async () => {
    const h = harness({ login: true, origin: cap.origin });
    await h.tracker.captured(1, cap);
    await h.tracker.detected(1, { login: true, origin: cap.origin });
    await h.fire();
    expect(h.onSuccess).not.toHaveBeenCalled();
  });

  it("does not succeed if the form came back before the check", async () => {
    const h = harness({ login: true, origin: cap.origin });
    await h.tracker.captured(1, cap);
    await h.tracker.detected(1, { login: false, origin: cap.origin });
    h.tick(CONFIRM_MS);
    await h.fire();
    expect(h.onSuccess).not.toHaveBeenCalled();
  });

  it("waits through a hop to another site", async () => {
    const h = harness({ login: false, origin: "https://accounts.google.com" });
    await h.tracker.captured(1, cap);
    await h.tracker.detected(1, { login: false, origin: "https://accounts.google.com" });
    h.tick(CONFIRM_MS);
    await h.fire();
    expect(h.onSuccess).not.toHaveBeenCalled();
    expect(h.saved.has(1)).toBe(true);
  });

  it("drops a capture older than two minutes", async () => {
    const h = harness({ login: false, origin: cap.origin });
    await h.tracker.captured(1, cap);
    h.tick(HOLD_MS + 1);
    await h.tracker.detected(1, { login: false, origin: cap.origin });
    await h.fire();
    expect(h.onSuccess).not.toHaveBeenCalled();
    expect(h.saved.has(1)).toBe(false);
  });

  it("offers only the second of two attempts", async () => {
    const h = harness({ login: false, origin: cap.origin, passwords: 0 });
    await h.tracker.captured(1, { ...cap, password: "wrong" });
    await h.tracker.detected(1, { login: true, origin: cap.origin });
    await h.tracker.captured(1, { ...cap, password: "right" });
    await h.tracker.detected(1, { login: false, origin: cap.origin, passwords: 0 });
    h.tick(CONFIRM_MS);
    await h.fire();
    expect(h.onSuccess).toHaveBeenCalledTimes(1);
    expect(h.onSuccess.mock.calls[0][1].password).toBe("right");
  });

  it("does not count a sign-up page that is still up as success", async () => {
    // Two password boxes: not a "login" page, but the form is still there.
    const h = harness({ login: false, origin: cap.origin, passwords: 2 });
    await h.tracker.captured(1, cap);
    await h.tracker.detected(1, { login: false, origin: cap.origin, passwords: 2 });
    h.tick(CONFIRM_MS);
    await h.fire();
    expect(h.onSuccess).not.toHaveBeenCalled();
  });

  it("drops the attempt when a fresh page serves the form again", async () => {
    // Wrong password, full reload with the form: then the user wanders off.
    const h = harness({ login: false, origin: cap.origin, passwords: 0 });
    await h.tracker.captured(1, cap);
    await h.tracker.detected(1, { login: true, origin: cap.origin, passwords: 1, fresh: true });
    await h.tracker.detected(1, { login: false, origin: cap.origin, passwords: 0 });
    h.tick(CONFIRM_MS);
    await h.fire();
    expect(h.onSuccess).not.toHaveBeenCalled();
    expect(h.saved.has(1)).toBe(false);
  });

  it("carries the username from step one into a password-only step", async () => {
    const h = harness({ login: false, origin: cap.origin, passwords: 0 });
    await h.tracker.captured(1, { ...cap, password: "" });
    // Step two loads fresh with a password box: that is not a failure.
    await h.tracker.detected(1, { login: true, origin: cap.origin, passwords: 1, fresh: true });
    await h.tracker.captured(1, { ...cap, username: "", password: "pw" });
    await h.tracker.detected(1, { login: false, origin: cap.origin, passwords: 0 });
    h.tick(CONFIRM_MS);
    await h.fire();
    expect(h.onSuccess.mock.calls[0][1]).toMatchObject({ username: "me", password: "pw" });
  });

  it("never offers a username with no password", async () => {
    const h = harness({ login: false, origin: cap.origin, passwords: 0 });
    await h.tracker.captured(1, { ...cap, password: "" });
    await h.tracker.detected(1, { login: false, origin: cap.origin, passwords: 0 });
    h.tick(CONFIRM_MS);
    await h.fire();
    expect(h.onSuccess).not.toHaveBeenCalled();
  });
});

describe("overlapping checks", () => {
  it("offers once even when two checks wait on the tab together", async () => {
    const saved = new Map<number, unknown>();
    const timers: (() => Promise<void>)[] = [];
    const waiting: ((v: unknown) => void)[] = [];
    const onSuccess = vi.fn();
    const tracker = createTracker({
      store: {
        get: async (t: number) => saved.get(t) ?? null,
        set: async (t: number, v: unknown) => void (v === null ? saved.delete(t) : saved.set(t, v)),
      },
      // Slow tab: both checks are waiting on it at once.
      askState: () => new Promise((r) => waiting.push(r)),
      onSuccess,
      now: () => 1_000,
      setTimer: (fn: () => Promise<void>) => timers.push(fn),
    });
    await tracker.captured(1, cap);
    await tracker.detected(1, { login: false, origin: cap.origin, passwords: 0 });
    await tracker.detected(1, { login: false, origin: cap.origin, passwords: 0 });
    const both = Promise.all(timers.map((fn) => fn()));
    await new Promise((r) => setTimeout(r, 0));
    for (const r of waiting.splice(0)) r({ login: false, origin: cap.origin, passwords: 0 });
    await both;
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("puts the attempt back when the check finds the form still there", async () => {
    const h = harness({ login: true, origin: cap.origin, passwords: 1 });
    await h.tracker.captured(1, cap);
    await h.tracker.detected(1, { login: false, origin: cap.origin, passwords: 0 });
    h.tick(CONFIRM_MS);
    await h.fire();
    expect(h.saved.has(1)).toBe(true);
  });
});

describe("isFresh", () => {
  it("keeps an open offer no longer than a capture", () => {
    expect(isFresh({ at: 0 }, HOLD_MS)).toBe(true);
    expect(isFresh({ at: 0 }, HOLD_MS + 1)).toBe(false);
    expect(isFresh(null, 0)).toBe(false);
  });
});

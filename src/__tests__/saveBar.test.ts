import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface Bar {
  show: (view: { kind: string; host: string; username: string }, onChoice: (c: string) => void) => ShadowRoot;
  say: (text: string, done?: boolean) => void;
  hide: () => void;
}
let Bar: Bar;

beforeAll(async () => {
  // @ts-expect-error untyped extension source
  await import("../../extension/bar.js");
  Bar = (window as unknown as { PMBar: Bar }).PMBar;
});

beforeEach(() => Bar.hide());

const buttons = (root: ShadowRoot) => [...root.querySelectorAll("button")];
const press = (root: ShadowRoot, name: RegExp) => buttons(root).find((b) => name.test(b.textContent || ""))!.click();

describe("save bar", () => {
  it("offers to save a new login, naming the site and account", () => {
    const onChoice = vi.fn();
    const root = Bar.show({ kind: "new", host: "site.test", username: "me" }, onChoice);
    expect(root.textContent).toContain("site.test");
    expect(root.textContent).toContain("me");
    press(root, /^save$/i);
    expect(onChoice).toHaveBeenCalledWith("save");
  });

  it("says Update for a changed password", () => {
    const root = Bar.show({ kind: "update", host: "site.test", username: "me" }, vi.fn());
    expect(buttons(root).map((b) => b.textContent)).toContain("Update");
  });

  it("offers never and not now", () => {
    const onChoice = vi.fn();
    press(Bar.show({ kind: "new", host: "site.test", username: "me" }, onChoice), /never/i);
    press(Bar.show({ kind: "new", host: "site.test", username: "me" }, onChoice), /not now/i);
    expect(onChoice.mock.calls.map((c) => c[0])).toEqual(["never", "later"]);
  });

  it("ignores a choice the page forged", () => {
    const onChoice = vi.fn();
    const root = Bar.show({ kind: "new", host: "site.test", username: "me" }, onChoice);
    const form = root.querySelector("form")!;
    const save = buttons(root)[0];
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: save }));
    expect(onChoice).not.toHaveBeenCalled();
  });

  it("keeps the page out of the bar", () => {
    Bar.show({ kind: "new", host: "site.test", username: "me" }, vi.fn());
    expect(document.querySelector("[data-pm-bar]")!.shadowRoot).toBeNull();
  });

  it("replaces its message and closes when done", () => {
    vi.useFakeTimers();
    const root = Bar.show({ kind: "new", host: "site.test", username: "me" }, vi.fn());
    Bar.say("Saved to Password Manager.", true);
    expect(root.textContent).toContain("Saved to Password Manager.");
    expect(buttons(root)).toHaveLength(0);
    vi.advanceTimersByTime(3000);
    expect(document.querySelector("[data-pm-bar]")).toBeNull();
    vi.useRealTimers();
  });

  it("takes one Save however fast it is clicked, until it has an answer", () => {
    const onChoice = vi.fn();
    const root = Bar.show({ kind: "approve", host: "site.test", username: "me" }, onChoice);
    press(root, /^save$/i);
    press(root, /^save$/i);
    expect(onChoice).toHaveBeenCalledTimes(1);
    // An answer that wants another click hands the buttons back.
    Bar.say("Approve this site in the app, then click Save again.");
    press(root, /^save$/i);
    expect(onChoice).toHaveBeenCalledTimes(2);
  });
});

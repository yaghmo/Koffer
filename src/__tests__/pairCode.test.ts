import { describe, expect, it, vi } from "vitest";
// @ts-expect-error untyped extension source
import { parseCode } from "../../extension/vault.js";

describe("parseCode", () => {
  it("reads a plain code as the usual port", () => {
    expect(parseCode(" k7f2q9mr ")).toEqual({ code: "K7F2Q9MR", port: 38471 });
  });

  it("reads the port the app moved to", () => {
    expect(parseCode("K7F2Q9MR-3")).toEqual({ code: "K7F2Q9MR", port: 38474 });
  });

  it("refuses anything else, so a typo never reaches some other port", () => {
    expect(parseCode("K7F2Q9M")).toBeNull();
    expect(parseCode("K7F2Q9MR-40")).toBeNull();
    expect(parseCode("K7F2Q9MR:38474")).toBeNull();
  });
});

describe("whenAllowed", () => {
  it("waits through the app's Allow, telling the caller once", async () => {
    vi.useFakeTimers();
    // @ts-expect-error untyped extension source
    const { whenAllowed, NEEDS_CONFIRM } = await import("../../extension/vault.js");
    let calls = 0;
    const onWait = vi.fn();
    const done = whenAllowed(async () => {
      calls += 1;
      if (calls < 3) throw new Error(NEEDS_CONFIRM);
      return "filled";
    }, onWait);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(done).resolves.toBe("filled");
    expect(onWait).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("passes any other error straight through", async () => {
    // @ts-expect-error untyped extension source
    const { whenAllowed } = await import("../../extension/vault.js");
    await expect(whenAllowed(async () => { throw new Error("locked"); })).rejects.toThrow("locked");
  });
});

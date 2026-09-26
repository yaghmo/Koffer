import { describe, expect, it } from "vitest";
import { fuzzyScore } from "../lib/fuzzy";

describe("fuzzyScore", () => {
  it("matches letters in order with gaps, like typing a few of them", () => {
    expect(fuzzyScore("atlk", "Auto-lock")).not.toBeNull();
    expect(fuzzyScore("clpb", "Clipboard")).not.toBeNull();
  });

  it("does not match letters out of order", () => {
    expect(fuzzyScore("kcol", "Auto-lock")).toBeNull();
  });

  it("ignores case and accents", () => {
    expect(fuzzyScore("verification", "Vérification")).not.toBeNull();
  });

  it("needs every word, each anywhere", () => {
    expect(fuzzyScore("backup cloud", "Cloud backup")).not.toBeNull();
    expect(fuzzyScore("backup zebra", "Cloud backup")).toBeNull();
  });

  it("ranks a whole-word hit above a scattered one", () => {
    const whole = fuzzyScore("lock", "Auto-lock")!;
    const scattered = fuzzyScore("lock", "Live cloud backup keys")!;
    expect(whole).toBeGreaterThan(scattered);
  });

  it("matches everything for an empty query", () => {
    expect(fuzzyScore("  ", "Anything")).toBe(0);
  });
});

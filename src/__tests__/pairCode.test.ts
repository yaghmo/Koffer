import { describe, expect, it } from "vitest";
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

import { describe, it, expect } from "vitest";
import { cardBrand } from "../lib/cardBrand";

describe("cardBrand", () => {
  it("detects visa from a leading 4", () => {
    expect(cardBrand("4111-1111-1111-1111")).toBe("visa");
  });

  it("detects mastercard from the 51-55 and 2221-2720 ranges", () => {
    expect(cardBrand("5500000000000004")).toBe("mastercard");
    expect(cardBrand("2223000000000000")).toBe("mastercard");
  });

  it("detects amex from 34/37", () => {
    expect(cardBrand("340000000000009")).toBe("amex");
    expect(cardBrand("370000000000002")).toBe("amex");
  });

  it("detects discover from 6011/65", () => {
    expect(cardBrand("6011000000000004")).toBe("discover");
    expect(cardBrand("6500000000000002")).toBe("discover");
  });

  it("falls back to other for unrecognized or empty input", () => {
    expect(cardBrand("9999999999999999")).toBe("other");
    expect(cardBrand("")).toBe("other");
    expect(cardBrand(null)).toBe("other");
    expect(cardBrand(undefined)).toBe("other");
  });
});

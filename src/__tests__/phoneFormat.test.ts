import { describe, it, expect } from "vitest";
import { formatPhoneLocal } from "../lib/phone";

describe("formatPhoneLocal", () => {
  it("groups US numbers 3-3-4 with hyphens", () => {
    expect(formatPhoneLocal("5551234567", "+1")).toBe("555-123-4567");
  });

  it("uses the country's own grouping for France", () => {
    expect(formatPhoneLocal("152895839", "+33")).toBe("1-52-89-58-39");
  });

  it("drops the trunk zero once a second digit arrives", () => {
    expect(formatPhoneLocal("0152895839", "+33")).toBe("1-52-89-58-39");
    expect(formatPhoneLocal("0612345678", "+33")).toBe("6-12-34-56-78");
    // A lone 0 stays put, so the digit does not vanish as it is typed.
    expect(formatPhoneLocal("0", "+33")).toBe("0");
    expect(formatPhoneLocal("06", "+33")).toBe("6");
  });

  it("stops at the country's longest number", () => {
    expect(formatPhoneLocal("61234567899999", "+33")).toBe("6-12-34-56-78");
    expect(formatPhoneLocal("555123456789", "+1")).toBe("555-123-4567");
    // No known length: E.164's 15 digits, dial code included.
    expect(formatPhoneLocal("1234567890123456", "+49").replace(/\D/g, "")).toHaveLength(13);
  });

  it("keeps the trunk zero for Italy", () => {
    expect(formatPhoneLocal("0612345678", "+39")).toBe("061-234-5678");
  });

  it("falls back to threes for countries with no rule, keeping a final four together", () => {
    expect(formatPhoneLocal("1234567", "+49")).toBe("123-4567");
    expect(formatPhoneLocal("123456789", "+49")).toBe("123-456-789");
  });

  it("re-formatting its own output is stable", () => {
    const once = formatPhoneLocal("5551234567", "+1");
    expect(formatPhoneLocal(once, "+1")).toBe(once);
  });
});

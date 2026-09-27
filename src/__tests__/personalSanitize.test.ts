import { describe, expect, it } from "vitest";
import { sanitize } from "../screens/PersonalInfo";

describe("GitHub field", () => {
  it("keeps the handle from a pasted profile link", () => {
    expect(sanitize("github", "https://github.com/yaghmo")).toBe("yaghmo");
    expect(sanitize("github", "github.com/yaghmo/")).toBe("yaghmo");
    expect(sanitize("github", "https://www.github.com/yaghmo?tab=repos")).toBe("yaghmo");
    expect(sanitize("github", " yaghmo ")).toBe("yaghmo");
  });
});

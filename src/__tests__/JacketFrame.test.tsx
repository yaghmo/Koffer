import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import JacketFrame from "../components/JacketFrame";

describe("JacketFrame", () => {
  it("puts the content on the shirt beside a jacket as wide as the sidebar", () => {
    const { container } = render(
      <JacketFrame>
        <p>Unlock</p>
      </JacketFrame>,
    );
    const aside = container.querySelector("aside");
    expect(aside?.className).toContain("jacket");
    expect(aside?.className).toContain("w-[220px]");
    expect(screen.getByText("Koffer")).toBeTruthy();
    expect(screen.getByText("Unlock").closest("main")).toBeTruthy();
    expect(aside?.contains(screen.getByText("Unlock"))).toBe(false);
  });
});

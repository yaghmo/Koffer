import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import RailFrame from "../components/RailFrame";

describe("RailFrame", () => {
  it("puts the content on the page beside a rail as wide as the sidebar", () => {
    const { container } = render(
      <RailFrame>
        <p>Unlock</p>
      </RailFrame>,
    );
    const aside = container.querySelector("aside");
    expect(aside?.className).toContain("rail");
    expect(aside?.className).toContain("w-[220px]");
    expect(screen.getByText("Koffer")).toBeTruthy();
    expect(screen.getByText("Unlock").closest("main")).toBeTruthy();
    expect(aside?.contains(screen.getByText("Unlock"))).toBe(false);
  });
});

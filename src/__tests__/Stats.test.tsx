import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Stats from "../screens/Stats";

vi.mock("../lib/api", () => ({
  api: {
    vaultStats: vi.fn().mockResolvedValue({
      total: 5,
      logins: 3,
      notes: 1,
      cards: 1,
      weak: [{ id: "1", title: "Weak Site" }],
      reused: [],
      old: [],
      health_score: 67,
    }),
  },
}));

describe("Stats", () => {
  it("shows counts by kind and the health score once loaded", async () => {
    render(<Stats onViewItem={() => {}} />);
    expect(await screen.findByText("67%")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("lists flagged weak passwords by title", async () => {
    render(<Stats onViewItem={() => {}} />);
    expect(await screen.findByText("Weak Site")).toBeTruthy();
  });

  it("opens the item when a flagged row is clicked", async () => {
    const onViewItem = vi.fn();
    render(<Stats onViewItem={onViewItem} />);
    (await screen.findByText("Weak Site")).closest("button")?.click();
    expect(onViewItem).toHaveBeenCalledWith("1");
  });
});

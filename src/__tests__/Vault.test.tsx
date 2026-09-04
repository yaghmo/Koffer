import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Vault from "../screens/Vault";

vi.mock("../lib/api", () => ({
  api: {
    listItems: vi.fn().mockResolvedValue([
      { id: "1", kind: "login", title: "GitHub", updated_at: 1 },
      { id: "2", kind: "note", title: "wifi", updated_at: 2 },
    ]),
    deleteItem: vi.fn().mockResolvedValue(undefined),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Vault", () => {
  it("loads and shows items on mount", async () => {
    render(<Vault />);
    expect(await screen.findByText("GitHub")).toBeTruthy();
    expect(await screen.findByText("wifi")).toBeTruthy();
  });

  it("filters by kind when a filter button is clicked", async () => {
    const { api } = await import("../lib/api");
    render(<Vault />);
    await screen.findByText("GitHub");
    fireEvent.click(screen.getByRole("button", { name: /^login$/i }));
    await waitFor(() => expect(api.listItems).toHaveBeenCalledWith(undefined, "login"));
  });

  it("filters by search text", async () => {
    const { api } = await import("../lib/api");
    render(<Vault />);
    await screen.findByText("GitHub");
    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: "git" },
    });
    await waitFor(() => expect(api.listItems).toHaveBeenCalledWith("git", undefined));
  });
});

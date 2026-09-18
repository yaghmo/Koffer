import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Sidebar from "../components/Sidebar";

const props = {
  accountName: "Personal",
  isUnlocked: true,
  onLock: () => {},
  currentView: "vault" as const,
  onNavigate: () => {},
  currentFilter: "all" as const,
  onFilterChange: () => {},
  autolock: null,
};

beforeEach(() => {
  localStorage.clear();
});

describe("Sidebar — vault tree", () => {
  it("nests the three kinds under All items and collapses them", () => {
    render(<Sidebar {...props} />);
    expect(screen.getByRole("button", { name: "Logins" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /collapse item kinds/i }));
    expect(screen.queryByRole("button", { name: "Logins" })).toBeNull();
    expect(screen.getByRole("button", { name: "All items" })).toBeTruthy();
  });

  it("remembers the collapsed state across mounts", () => {
    const first = render(<Sidebar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /collapse item kinds/i }));
    first.unmount();
    render(<Sidebar {...props} />);
    expect(screen.queryByRole("button", { name: "Logins" })).toBeNull();
  });

  it("re-opens the tree when a kind is the active section", () => {
    const first = render(<Sidebar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /collapse item kinds/i }));
    first.unmount();
    render(<Sidebar {...props} currentFilter="card" />);
    expect(screen.getByRole("button", { name: "Cards" })).toBeTruthy();
  });

  it("toggling the tree does not navigate", () => {
    const onFilterChange = vi.fn();
    render(<Sidebar {...props} onFilterChange={onFilterChange} />);
    fireEvent.click(screen.getByRole("button", { name: /collapse item kinds/i }));
    expect(onFilterChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "All items" }));
    expect(onFilterChange).toHaveBeenCalledWith("all");
  });
});

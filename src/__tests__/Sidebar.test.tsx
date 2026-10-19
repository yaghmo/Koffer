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

  const railProps = {
    accountName: "Yaghmo",
    isUnlocked: true,
    onLock: () => {},
    currentView: "vault" as const,
    onNavigate: () => {},
    currentFilter: "all" as const,
    onFilterChange: () => {},
  };

  it("warns in amber for the last 30 seconds and not before", () => {
    const { rerender } = render(<Sidebar {...railProps} autolock={{ remainingSecs: 872, timeoutSecs: 900 }} />);
    expect(screen.getByText("Locks in 14:32").className).not.toContain("bg-warning-container");
    rerender(<Sidebar {...railProps} autolock={{ remainingSecs: 31, timeoutSecs: 900 }} />);
    expect(screen.getByText("Locks in 0:31").className).not.toContain("bg-warning-container");
    rerender(<Sidebar {...railProps} autolock={{ remainingSecs: 30, timeoutSecs: 900 }} />);
    const closing = screen.getByText("Locks in 0:30").className;
    expect(closing).toContain("bg-warning-container");
    expect(closing).toContain("text-on-warning-container");
  });

  it("is the rail, and truncates a long vault name instead of growing", () => {
    const name = "A very long vault name that would never fit in two hundred pixels";
    const { container } = render(<Sidebar {...railProps} accountName={name} autolock={null} />);
    expect(container.querySelector("aside")?.className).toContain("rail");
    expect(container.querySelector("aside")?.className).toContain("w-[220px]");
    expect(screen.getByText(name).className).toContain("truncate");
  });

  it("shows the selected entry one step lighter than the rail", () => {
    render(<Sidebar {...railProps} autolock={null} />);
    expect(screen.getByRole("button", { name: /all items/i }).className).toContain("bg-surface-container-highest");
  });
});

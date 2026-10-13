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

  const jacketProps = {
    accountName: "Yaghmo",
    isUnlocked: true,
    onLock: () => {},
    currentView: "vault" as const,
    onNavigate: () => {},
    currentFilter: "all" as const,
    onFilterChange: () => {},
  };

  it("warns on yellow tape for the last 30 seconds and not before", () => {
    const { rerender } = render(<Sidebar {...jacketProps} autolock={{ remainingSecs: 872, timeoutSecs: 900 }} />);
    expect(screen.getByText("Locks in 14:32").className).not.toContain("bg-tape");
    rerender(<Sidebar {...jacketProps} autolock={{ remainingSecs: 31, timeoutSecs: 900 }} />);
    expect(screen.getByText("Locks in 0:31").className).not.toContain("bg-tape");
    rerender(<Sidebar {...jacketProps} autolock={{ remainingSecs: 30, timeoutSecs: 900 }} />);
    const closing = screen.getByText("Locks in 0:30").className;
    expect(closing).toContain("bg-tape");
    expect(closing).toContain("text-on-tape");
  });

  it("is the jacket, and truncates a long vault name instead of growing", () => {
    const name = "A very long vault name that would never fit in two hundred pixels";
    const { container } = render(<Sidebar {...jacketProps} accountName={name} autolock={null} />);
    expect(container.querySelector("aside")?.className).toContain("jacket");
    expect(container.querySelector("aside")?.className).toContain("w-[220px]");
    expect(screen.getByText(name).className).toContain("truncate");
  });

  it("shows the selected entry as the shirt showing through", () => {
    render(<Sidebar {...jacketProps} autolock={null} />);
    expect(screen.getByRole("button", { name: /all items/i }).className).toContain("bg-shirt");
  });
});

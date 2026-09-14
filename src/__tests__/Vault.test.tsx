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

const noop = () => {};
const editorProps = {
  editing: null as null,
  viewingId: null as string | null,
  onViewItem: noop,
  onEditItem: noop,
  onEditNew: noop,
  onEditorClose: noop,
  onViewerClose: noop,
  onItemSaved: noop,
};

describe("Vault", () => {
  it("loads and shows items on mount", async () => {
    render(<Vault filter="all" {...editorProps} />);
    expect(await screen.findByText("GitHub")).toBeTruthy();
    expect(await screen.findByText("wifi")).toBeTruthy();
  });

  it("filters by kind when a filter button is clicked", async () => {
    const { api } = await import("../lib/api");
    render(<Vault filter="login" {...editorProps} />);
    await screen.findByText("GitHub");
    await waitFor(() =>
      expect(api.listItems).toHaveBeenCalledWith(undefined, "login")
    );
  });

  it("filters by search text", async () => {
    const { api } = await import("../lib/api");
    render(<Vault filter="all" {...editorProps} />);
    await screen.findByText("GitHub");
    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: "git" },
    });
    await waitFor(() =>
      expect(api.listItems).toHaveBeenCalledWith("git", undefined)
    );
  });

  it("Ctrl+K focuses the search input", async () => {
    render(<Vault filter="all" {...editorProps} />);
    await screen.findByText("GitHub");
    const search = screen.getByPlaceholderText(/search/i) as HTMLInputElement;
    search.blur();
    expect(document.activeElement).not.toBe(search);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(document.activeElement).toBe(search);
  });

  it("opens an item-kind menu from a single Add button and calls onEditNew on selection", async () => {
    const onEditNew = vi.fn();
    render(<Vault filter="all" {...editorProps} onEditNew={onEditNew} />);
    await screen.findByText("GitHub");
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Card" }));
    expect(onEditNew).toHaveBeenCalledWith("card");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes the Add menu on outside click and on Escape", async () => {
    render(<Vault filter="all" {...editorProps} />);
    await screen.findByText("GitHub");
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

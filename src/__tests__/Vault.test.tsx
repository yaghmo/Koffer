import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import Vault from "../screens/Vault";
import type { ItemMeta } from "../lib/types";

function meta(over: Partial<ItemMeta> & Pick<ItemMeta, "id" | "kind" | "title">): ItemMeta {
  return {
    updated_at: 1,
    favicon: "",
    method: over.kind === "login" ? "credentials" : null,
    username: null,
    card_bin: null,
    host: null,
    pinned: false,
    icon_checked_at: 0,
    ...over,
  };
}

const ITEMS: ItemMeta[] = [
  meta({ id: "1", kind: "login", title: "GitHub", pinned: true }),
  meta({ id: "2", kind: "login", title: "Amazon" }),
  meta({ id: "3", kind: "note", title: "wifi", pinned: true }),
  meta({ id: "4", kind: "note", title: "recovery codes" }),
  meta({ id: "5", kind: "card", title: "Visa", pinned: true }),
];

vi.mock("../lib/api", () => ({
  api: {
    listItems: vi.fn().mockResolvedValue([]),
    deleteItem: vi.fn().mockResolvedValue(undefined),
    setItemPinned: vi.fn().mockResolvedValue(undefined),
    openLoginItem: vi.fn().mockResolvedValue(undefined),
  },
}));

beforeEach(async () => {
  vi.clearAllMocks();
  const { api } = await import("../lib/api");
  (api.listItems as any).mockResolvedValue(ITEMS);
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
    expect((await screen.findAllByText("GitHub")).length).toBeGreaterThan(0);
    expect(await screen.findByText("wifi")).toBeTruthy();
  });

  it("filters by kind when a filter button is clicked", async () => {
    const { api } = await import("../lib/api");
    render(<Vault filter="login" {...editorProps} />);
    await screen.findAllByText("GitHub");
    await waitFor(() => expect(api.listItems).toHaveBeenCalledWith(undefined, "login"));
  });

  it("filters by search text", async () => {
    const { api } = await import("../lib/api");
    render(<Vault filter="all" {...editorProps} />);
    await screen.findAllByText("GitHub");
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "git" } });
    await waitFor(() => expect(api.listItems).toHaveBeenCalledWith("git", undefined));
  });

  it("Ctrl+K focuses the search input", async () => {
    render(<Vault filter="all" {...editorProps} />);
    await screen.findAllByText("GitHub");
    const search = screen.getByPlaceholderText(/search/i) as HTMLInputElement;
    search.blur();
    expect(document.activeElement).not.toBe(search);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(document.activeElement).toBe(search);
  });

  it("opens an item-kind menu from a single Add button and calls onEditNew on selection", async () => {
    const onEditNew = vi.fn();
    render(<Vault filter="all" {...editorProps} onEditNew={onEditNew} />);
    await screen.findAllByText("GitHub");
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Card" }));
    expect(onEditNew).toHaveBeenCalledWith("card");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes the Add menu on outside click and on Escape", async () => {
    render(<Vault filter="all" {...editorProps} />);
    await screen.findAllByText("GitHub");
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("Vault — All items dashboard", () => {
  it("shows pinned logins as cards above the split panes", async () => {
    render(<Vault filter="all" {...editorProps} />);
    await screen.findAllByText("GitHub");
    // The pinned login appears twice: once as a card, once in the logins pane.
    expect(screen.getAllByRole("button", { name: /view github/i }).length).toBeGreaterThan(1);
    expect(screen.getByText("1/10")).toBeTruthy();
  });

  it("shows every note and card in its pane, pinned ones first", async () => {
    render(<Vault filter="all" {...editorProps} />);
    await screen.findAllByText("GitHub");
    expect(screen.getByText("wifi")).toBeTruthy();
    expect(screen.getByText("recovery codes")).toBeTruthy();
    expect(screen.getByText("Visa")).toBeTruthy();
    // "wifi" is pinned, so it leads despite sorting after "recovery codes".
    const noteTitles = screen
      .getAllByRole("button", { name: /^view (wifi|recovery codes)$/i })
      .map((b) => b.textContent ?? "");
    expect(noteTitles[0]).toContain("wifi");
  });

  it("sends the user to the dedicated page from a pane footer", async () => {
    const onFilterChange = vi.fn();
    render(<Vault filter="all" {...editorProps} onFilterChange={onFilterChange} />);
    await screen.findAllByText("GitHub");
    fireEvent.click(screen.getByRole("button", { name: /all 2 notes/i }));
    expect(onFilterChange).toHaveBeenCalledWith("note");
  });

  it("pins and unpins through the backend, then refreshes", async () => {
    const { api } = await import("../lib/api");
    render(<Vault filter="all" {...editorProps} />);
    await screen.findByText("Amazon");
    fireEvent.click(screen.getByRole("button", { name: /^pin amazon$/i }));
    await waitFor(() => expect(api.setItemPinned).toHaveBeenCalledWith("2", true));
  });

  it("surfaces the limit error when too many items are pinned", async () => {
    const { api } = await import("../lib/api");
    (api.setItemPinned as any).mockRejectedValueOnce("You can pin up to 10 logins. Unpin one first.");
    render(<Vault filter="all" {...editorProps} />);
    await screen.findByText("Amazon");
    fireEvent.click(screen.getByRole("button", { name: /^pin amazon$/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/pin up to 10 logins/i);
  });

  it("sorts alphabetically by default and can flip to Z–A on a dedicated page", async () => {
    render(<Vault filter="login" {...editorProps} />);
    await screen.findByText("Amazon");
    const titles = () =>
      screen.getAllByRole("button", { name: /^view /i }).map((b) => b.textContent ?? "");
    expect(titles()[0]).toContain("Amazon");
    fireEvent.click(screen.getByRole("button", { name: /name a–z/i }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: /name z–a/i }));
    expect(titles()[0]).toContain("wifi");
  });
});

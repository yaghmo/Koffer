import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ItemList, { PinnedTiles, providerOf } from "../components/ItemList";
import type { ItemMeta } from "../lib/types";

function login(id: string, title: string, pinned = false): ItemMeta {
  return {
    id,
    kind: "login",
    title,
    updated_at: Number(id),
    favicon: "",
    method: "credentials",
    username: `${title.toLowerCase()}@gmail.com`,
    card_bin: null,
    host: `${title.toLowerCase()}.com`,
    pinned,
    icon_checked_at: 0,
  };
}

const note: ItemMeta = {
  id: "9",
  kind: "note",
  title: "Wifi",
  updated_at: 9,
  favicon: "",
  method: null,
  username: null,
  card_bin: null,
  host: null,
  pinned: false,
  icon_checked_at: 0,
};

describe("ItemList", () => {
  it("renders every item as its own row, including same-platform logins", () => {
    render(
      <ItemList
        items={[login("1", "Twitch"), login("2", "Twitch"), note]}
        onView={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getAllByRole("button", { name: /view twitch/i })).toHaveLength(2);
    expect(screen.getByText("Wifi")).toBeTruthy();
  });

  it("offers a pin action per row and reports which item was hit", () => {
    const onTogglePin = vi.fn();
    const items = [login("1", "Gmail"), login("2", "Bank", true)];
    render(<ItemList items={items} onView={() => {}} onDelete={() => {}} onTogglePin={onTogglePin} />);
    fireEvent.click(screen.getByRole("button", { name: /^pin gmail$/i }));
    expect(onTogglePin).toHaveBeenCalledWith(items[0]);
    // An already-pinned row offers the inverse.
    expect(screen.getByRole("button", { name: /^unpin bank$/i })).toBeTruthy();
  });

  it("shows a custom empty label", () => {
    render(<ItemList items={[]} onView={() => {}} onDelete={() => {}} emptyLabel="No pinned cards" />);
    expect(screen.getByText("No pinned cards")).toBeTruthy();
  });
});

describe("PinnedTiles", () => {
  it("renders a card per pinned item and can unpin it", () => {
    const onTogglePin = vi.fn();
    const items = [login("1", "Gmail", true)];
    render(<PinnedTiles items={items} onView={() => {}} onTogglePin={onTogglePin} />);
    expect(screen.getByRole("button", { name: /view gmail/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /unpin gmail/i }));
    expect(onTogglePin).toHaveBeenCalledWith(items[0]);
  });
});

describe("providerOf", () => {
  it("does not dress a site login in its email provider's logo", () => {
    expect(providerOf(login("1", "Twitch"))).toBeNull();
    expect(providerOf({ ...login("2", "Gmail"), host: null })).toBe("google");
  });
});

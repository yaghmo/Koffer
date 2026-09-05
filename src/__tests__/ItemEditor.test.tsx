import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ItemEditor from "../screens/ItemEditor";

vi.mock("../lib/api", () => ({
  api: {
    getItem: vi.fn().mockResolvedValue({
      type: "login",
      id: "1",
      title: "GitHub",
      notes: "",
      created_at: 0,
      updated_at: 0,
      url: "https://github.com",
      username: "octocat",
      password: "s3cret",
    }),
    saveItem: vi.fn().mockResolvedValue(undefined),
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("ItemEditor", () => {
  it("loads an existing item and shows its fields", async () => {
    render(<ItemEditor id="1" onClose={() => {}} />);
    expect(await screen.findByDisplayValue("GitHub")).toBeTruthy();
    expect(await screen.findByDisplayValue("octocat")).toBeTruthy();
  });

  it("shows a new empty form when id is null", async () => {
    render(<ItemEditor id={null} onClose={() => {}} />);
    expect(await screen.findByLabelText(/title/i)).toBeTruthy();
  });

  it("calls saveItem with the form values on save", async () => {
    const { api } = await import("../lib/api");
    const onClose = vi.fn();
    render(<ItemEditor id={null} onClose={onClose} />);
    fireEvent.change(await screen.findByLabelText(/title/i), {
      target: { value: "Test login" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(api.saveItem).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("opens with the requested initial kind", async () => {
    render(<ItemEditor id={null} initialKind="note" onClose={() => {}} />);
    // Note editor shows a textarea with aria-label "Note body"
    expect(await screen.findByLabelText(/note body/i)).toBeTruthy();
  });
});

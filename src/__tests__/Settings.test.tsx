import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Settings from "../screens/Settings";

vi.mock("../lib/api", () => ({
  api: {
    getConfig: vi.fn().mockResolvedValue({ autolock_mins: 15 }),
    listItems: vi.fn().mockResolvedValue([
      { id: "1", kind: "login", title: "GitHub" },
      { id: "2", kind: "login", title: "No favicon site" },
    ]),
    getItem: vi.fn((id: string) =>
      Promise.resolve({
        type: "login",
        id,
        title: id === "1" ? "GitHub" : "No favicon site",
        notes: "",
        created_at: 0,
        updated_at: 0,
        favicon: "",
        method: "credentials",
        url: `https://example${id}.com`,
        username: "",
        password: "",
      })
    ),
    fetchUrlMetadata: vi.fn((url: string) =>
      url.includes("example1")
        ? Promise.resolve({ title: null, favicon_data_url: "data:image/png;base64,abc" })
        : Promise.resolve({ title: null, favicon_data_url: null })
    ),
    saveItem: vi.fn().mockResolvedValue(undefined),
    exportVault: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Settings — site logos", () => {
  it("re-fetches favicons for every login and reports how many were updated", async () => {
    const { api } = await import("../lib/api");
    render(<Settings accountId="acct-1" onLock={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /refresh site logos/i }));
    expect(await screen.findByText(/updated 1 of 2/i)).toBeTruthy();
    expect(api.saveItem).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(api.saveItem).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1", favicon: "data:image/png;base64,abc" })
      )
    );
  });
});

describe("Settings — export backup", () => {
  it("saves the vault file to the chosen path", async () => {
    const { api } = await import("../lib/api");
    const { save } = await import("@tauri-apps/plugin-dialog");
    (save as any).mockResolvedValue("C:\\backups\\vault-backup.enc");
    render(<Settings accountId="acct-1" onLock={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /export vault backup/i }));
    await waitFor(() =>
      expect(api.exportVault).toHaveBeenCalledWith("C:\\backups\\vault-backup.enc")
    );
    expect(await screen.findByText(/backup saved/i)).toBeTruthy();
  });

  it("does nothing when the save dialog is cancelled", async () => {
    const { api } = await import("../lib/api");
    const { save } = await import("@tauri-apps/plugin-dialog");
    (save as any).mockResolvedValue(null);
    render(<Settings accountId="acct-1" onLock={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /export vault backup/i }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(api.exportVault).not.toHaveBeenCalled();
  });
});

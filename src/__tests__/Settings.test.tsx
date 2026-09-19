import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import Settings from "../screens/Settings";

vi.mock("../lib/api", () => ({
  api: {
    getConfig: vi.fn().mockResolvedValue({ autolock_mins: 15 }),
    listItems: vi.fn().mockResolvedValue([
      { id: "1", kind: "login", title: "GitHub", icon_checked_at: 0 },
      { id: "2", kind: "login", title: "No favicon site", icon_checked_at: 0 },
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
    setItemFavicon: vi.fn().mockResolvedValue(undefined),
    vaultStorage: vi.fn().mockResolvedValue({
      path: "C:\vaults\acct-1.vault",
      bytes: 2048,
      modified_secs: 1_700_000_000,
    }),
    exportVault: vi.fn().mockResolvedValue(undefined),
    securityState: vi.fn().mockResolvedValue({ has_recovery: true, last_export_secs: 0, last_cloud_backup_secs: 0 }),
    createRecoveryCode: vi.fn().mockResolvedValue("K7F2Q 9MRXB 4TWHE 3NYD8 P6VJS 2GZK5"),
    changeMasterPassword: vi.fn().mockResolvedValue(undefined),
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
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
    // Both logins are stamped as checked; only the one whose icon changed
    // carries a new favicon, the other records "looked, nothing new".
    expect(api.setItemFavicon).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(api.setItemFavicon).toHaveBeenCalledWith("1", "data:image/png;base64,abc")
    );
    expect(api.setItemFavicon).toHaveBeenCalledWith("2", null);
  });
});

describe("Settings — security", () => {
  it("shows a one-time recovery code after confirming the master password", async () => {
    const { api } = await import("../lib/api");
    render(<Settings accountId="acct-1" onLock={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /issue a new code/i }));
    fireEvent.change(screen.getByLabelText(/^master password$/i), { target: { value: "hunter2hunter" } });
    fireEvent.click(screen.getByRole("button", { name: /generate code/i }));
    await waitFor(() => expect(api.createRecoveryCode).toHaveBeenCalledWith("hunter2hunter"));
    const dialog = await screen.findByRole("dialog", { name: /recovery code/i });
    expect(within(dialog).getByLabelText(/recovery code/i).textContent).toContain("K7F2Q");
    // The dialog will not close until the code is acknowledged.
    const done = within(dialog).getByRole("button", { name: /done/i }) as HTMLButtonElement;
    expect(done.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(done.disabled).toBe(false);
  });

  it("refuses a password change when the confirmation does not match", async () => {
    const { api } = await import("../lib/api");
    render(<Settings accountId="acct-1" onLock={() => {}} />);
    fireEvent.change(await screen.findByLabelText(/current master password/i), { target: { value: "old-one" } });
    fireEvent.change(screen.getByLabelText(/^new master password$/i), { target: { value: "new-password" } });
    fireEvent.change(screen.getByLabelText(/confirm new master password/i), { target: { value: "different" } });
    fireEvent.click(screen.getByRole("button", { name: /change password/i }));
    expect(await screen.findByText(/do not match/i)).toBeTruthy();
    expect(api.changeMasterPassword).not.toHaveBeenCalled();
  });

  it("warns when the vault has never been exported", async () => {
    render(<Settings accountId="acct-1" onLock={() => {}} />);
    expect(await screen.findByText(/never been exported/i)).toBeTruthy();
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

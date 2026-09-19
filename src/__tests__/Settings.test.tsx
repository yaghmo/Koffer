import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import Settings from "../screens/Settings";

vi.mock("../lib/api", () => ({
  api: {
    getConfig: vi.fn().mockResolvedValue({ autolock_mins: 15, auto_refresh_icons: false }),
    setAutoRefreshIcons: vi.fn().mockResolvedValue(undefined),
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
    securityState: vi.fn().mockResolvedValue({ has_recovery: true, last_export_secs: 0 }),
    createRecoveryCode: vi.fn().mockResolvedValue("K7F2Q 9MRXB 4TWHE 3NYD8 P6VJS 2GZK5"),
    changeMasterPassword: vi.fn().mockResolvedValue(undefined),
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
    getBackupConfig: vi.fn().mockResolvedValue({ configured: false, url: "", last_backup_secs: 0, last_backup_error: "" }),
    bridgeState: vi.fn().mockResolvedValue({ listen_error: "", port: 38471, clients: [] }),
    bridgePairCode: vi.fn().mockResolvedValue("K7F2Q9MR"),
    bridgeCancelPairing: vi.fn().mockResolvedValue(undefined),
    bridgeUnpair: vi.fn().mockResolvedValue(undefined),
    setBackupConfig: vi.fn().mockResolvedValue(undefined),
    clearBackupConfig: vi.fn().mockResolvedValue(undefined),
    backupNow: vi.fn().mockResolvedValue(undefined),
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

  it("shows the automatic refresh off, and says what turning it on reveals", async () => {
    render(<Settings accountId="acct-1" onLock={() => {}} />);
    const toggle = (await screen.findByRole("checkbox", {
      name: /automatically each time the vault unlocks/i,
    })) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    // The copy has to name the exposure, not just say "may use the network".
    expect(screen.getByText(/internet provider/i)).toBeTruthy();
    expect(screen.getByText(/which sites you keep accounts with/i)).toBeTruthy();
  });

  it("persists the automatic refresh when it is turned on", async () => {
    const { api } = await import("../lib/api");
    render(<Settings accountId="acct-1" onLock={() => {}} />);
    const toggle = (await screen.findByRole("checkbox", {
      name: /automatically each time the vault unlocks/i,
    })) as HTMLInputElement;
    fireEvent.click(toggle);
    await waitFor(() => expect(api.setAutoRefreshIcons).toHaveBeenCalledWith(true));
    expect(toggle.checked).toBe(true);
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

describe("Settings cloud backup card", () => {
  it("explains that the master password is still required", async () => {
    render(<Settings accountId="a1" onLock={() => {}} />);
    expect(await screen.findByText(/cloud backup/i)).toBeTruthy();
    expect(screen.getByText(/master password is still required/i)).toBeTruthy();
  });

  it("warns that the download token is not stored by the app", async () => {
    render(<Settings accountId="a1" onLock={() => {}} />);
    expect(await screen.findByText(/never stores your download token/i)).toBeTruthy();
  });

  it("saves the url and token", async () => {
    const { api } = await import("../lib/api");
    render(<Settings accountId="a1" onLock={() => {}} />);
    fireEvent.change(await screen.findByLabelText(/worker url/i), {
      target: { value: "https://w.example.dev" },
    });
    fireEvent.change(screen.getByLabelText(/upload token/i), {
      target: { value: "put-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save backup settings/i }));
    await waitFor(() =>
      expect(api.setBackupConfig).toHaveBeenCalledWith("https://w.example.dev", "put-secret")
    );
  });

  it("masks the token field", async () => {
    render(<Settings accountId="a1" onLock={() => {}} />);
    const field = (await screen.findByLabelText(/upload token/i)) as HTMLInputElement;
    expect(field.type).toBe("password");
  });

  it("surfaces an upload failure", async () => {
    const { api } = await import("../lib/api");
    vi.mocked(api.getBackupConfig).mockResolvedValue({
      configured: true,
      url: "https://w.example.dev",
      last_backup_secs: 0,
      last_backup_error: "",
    });
    vi.mocked(api.backupNow).mockRejectedValue("could not reach the worker");
    render(<Settings accountId="a1" onLock={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /back up now/i }));
    expect(await screen.findByText(/could not reach the worker/i)).toBeTruthy();
  });

  it("shows a persisted last-backup error on load, before any action this session", async () => {
    const { api } = await import("../lib/api");
    vi.mocked(api.getBackupConfig).mockResolvedValue({
      configured: true,
      url: "https://w.example.dev",
      last_backup_secs: 0,
      last_backup_error: "token rejected by the worker",
    });
    render(<Settings accountId="a1" onLock={() => {}} />);
    expect(await screen.findByText(/token rejected by the worker/i)).toBeTruthy();
  });

  it("allows saving a URL-only change, keeping the existing token, when already configured", async () => {
    const { api } = await import("../lib/api");
    vi.mocked(api.getBackupConfig).mockResolvedValue({
      configured: true,
      url: "https://old.example.dev",
      last_backup_secs: 0,
      last_backup_error: "",
    });
    render(<Settings accountId="a1" onLock={() => {}} />);
    const urlField = (await screen.findByLabelText(/worker url/i)) as HTMLInputElement;
    await waitFor(() => expect(urlField.value).toBe("https://old.example.dev"));
    fireEvent.change(urlField, { target: { value: "https://new.example.dev" } });
    const saveBtn = screen.getByRole("button", { name: /save backup settings/i }) as HTMLButtonElement;
    // Token field left blank on purpose: the button must not require it when
    // a config already exists, since get_backup_config never returns the
    // token to re-enter.
    expect(saveBtn.disabled).toBe(false);
    fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(api.setBackupConfig).toHaveBeenCalledWith("https://new.example.dev", undefined)
    );
  });
});

describe("Settings browser extension card", () => {
  it("starts unpaired and says the bridge is local-only", async () => {
    render(<Settings accountId="a1" onLock={() => {}} />);
    expect(await screen.findByText(/not paired/i)).toBeTruthy();
    expect(screen.getByText(/127\.0\.0\.1:38471/)).toBeTruthy();
    expect(screen.getByText(/never the network/i)).toBeTruthy();
  });

  it("shows a pairing code on request, and says it expires", async () => {
    const { api } = await import("../lib/api");
    render(<Settings accountId="a1" onLock={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /pair a browser/i }));
    expect(await screen.findByText("K7F2Q9MR")).toBeTruthy();
    expect(screen.getByText(/three minutes, once/i)).toBeTruthy();
    expect(api.bridgePairCode).toHaveBeenCalled();
  });

  it("cancels the pending code when pairing is explicitly cancelled", async () => {
    const { api } = await import("../lib/api");
    render(<Settings accountId="a1" onLock={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /pair a browser/i }));
    fireEvent.click(await screen.findByRole("button", { name: /cancel pairing/i }));
    await waitFor(() => expect(api.bridgeCancelPairing).toHaveBeenCalled());
    expect(screen.queryByText("K7F2Q9MR")).toBeNull();
  });

  it("lists a paired browser and unpairs it by origin", async () => {
    const { api } = await import("../lib/api");
    vi.mocked(api.bridgeState).mockResolvedValue({
      listen_error: "",
      port: 38471,
      clients: [{ origin: "chrome-extension://abcdef", label: "Chrome", paired_at: 1_700_000_000 }],
    });
    render(<Settings accountId="a1" onLock={() => {}} />);
    expect(await screen.findByText("Chrome")).toBeTruthy();
    expect(screen.getByText("chrome-extension://abcdef")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /unpair/i }));
    await waitFor(() =>
      expect(api.bridgeUnpair).toHaveBeenCalledWith("chrome-extension://abcdef")
    );
  });

  it("says so when the port was not available", async () => {
    // Otherwise the extension just fails silently and nothing explains why.
    const { api } = await import("../lib/api");
    vi.mocked(api.bridgeState).mockResolvedValue({
      listen_error: "port 38471 is not available: os error 10048",
      port: 38471,
      clients: [],
    });
    render(<Settings accountId="a1" onLock={() => {}} />);
    expect(await screen.findByText(/could not start.*10048/i)).toBeTruthy();
  });
});

describe("Settings pairing panel closes itself", () => {
  it("dismisses the code once a browser has paired, without cancelling it", async () => {
    // The bug this covers: the only way out used to be a button that
    // silently killed the code, so a user who read the code and clicked it
    // could never pair.
    const { api } = await import("../lib/api");
    vi.mocked(api.bridgeState).mockResolvedValue({ listen_error: "", port: 38471, clients: [] });
    render(<Settings accountId="a1" onLock={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /pair a browser/i }));
    expect(await screen.findByText("K7F2Q9MR")).toBeTruthy();

    vi.mocked(api.bridgeState).mockResolvedValue({
      listen_error: "",
      port: 38471,
      clients: [{ origin: "chrome-extension://abcdef", label: "Chrome", paired_at: 1 }],
    });
    await waitFor(() => expect(screen.queryByText("K7F2Q9MR")).toBeNull(), { timeout: 4000 });
    expect(screen.getByText("Chrome")).toBeTruthy();
    expect(api.bridgeCancelPairing).not.toHaveBeenCalled();
  });
});

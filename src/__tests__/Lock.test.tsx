import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import AccountLock from "../screens/AccountLock";
import type { Account } from "../lib/types";

const acct1 = { id: "a1", name: "user1" };
const acct2 = { id: "a2", name: "user2" };

vi.mock("../lib/api", () => ({
  api: {
    unlockVault: vi.fn().mockResolvedValue(undefined),
    importVault: vi.fn(),
    restoreFromCloud: vi.fn(),
  },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

describe("AccountLock", () => {
  it("renders a password field and unlock button for a single account", () => {
    render(
      <AccountLock
        accounts={[acct1]}
        onUnlocked={() => {}}
        onAddNew={() => {}}
      />
    );
    expect(screen.getByLabelText("Master password")).toBeTruthy();
    expect(screen.getByRole("button", { name: /unlock/i })).toBeTruthy();
  });

  it("calls unlockVault and onUnlocked on success", async () => {
    const onUnlocked = vi.fn();
    const { api } = await import("../lib/api");
    render(
      <AccountLock
        accounts={[acct1]}
        onUnlocked={onUnlocked}
        onAddNew={() => {}}
      />
    );
    fireEvent.change(screen.getByLabelText("Master password"), {
      target: { value: "secret-pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: /unlock/i }));
    await waitFor(() =>
      expect(api.unlockVault).toHaveBeenCalledWith("secret-pw", "a1")
    );
    expect(onUnlocked).toHaveBeenCalledWith(acct1);
  });

  it("shows an error message on failure", async () => {
    const { api } = await import("../lib/api");
    (api.unlockVault as any).mockRejectedValueOnce("invalid password");
    render(
      <AccountLock
        accounts={[acct1]}
        onUnlocked={() => {}}
        onAddNew={() => {}}
      />
    );
    fireEvent.change(screen.getByLabelText("Master password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: /unlock/i }));
    expect(await screen.findByText(/wrong password/i)).toBeTruthy();
  });

  it("renders a Switch button that opens a popup listing every vault", () => {
    render(
      <AccountLock
        accounts={[acct1, acct2]}
        onUnlocked={() => {}}
        onAddNew={() => {}}
      />
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /switch/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("user1")).toBeTruthy();
    expect(within(dialog).getByText(/current/i)).toBeTruthy();
    expect(within(dialog).getByText("user2")).toBeTruthy();
  });

  it("picking a different account in the popup switches the unlock target and closes the popup", async () => {
    const { api } = await import("../lib/api");
    render(
      <AccountLock
        accounts={[acct1, acct2]}
        onUnlocked={() => {}}
        onAddNew={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /switch/i }));
    fireEvent.click(within(screen.getByRole("dialog")).getByText("user2"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.change(screen.getByLabelText("Master password"), {
      target: { value: "pw2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /unlock/i }));
    await waitFor(() =>
      expect(api.unlockVault).toHaveBeenCalledWith("pw2", "a2")
    );
  });

  it("'add another vault' calls onAddNew", () => {
    const onAddNew = vi.fn();
    render(
      <AccountLock
        accounts={[acct1]}
        onUnlocked={() => {}}
        onAddNew={onAddNew}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /add another vault/i }));
    expect(onAddNew).toHaveBeenCalled();
  });

  it("does not show a reset link on the lock screen", () => {
    render(
      <AccountLock
        accounts={[acct1]}
        onUnlocked={() => {}}
        onAddNew={() => {}}
      />
    );
    expect(screen.queryByRole("button", { name: /forgot password/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reset/i })).toBeNull();
  });

  it("removes a deleted account from the switcher popup immediately when the prop changes", () => {
    const { rerender } = render(
      <AccountLock
        accounts={[acct1, acct2]}
        onUnlocked={() => {}}
        onAddNew={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /switch/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("user1")).toBeTruthy();
    expect(within(dialog).getByText("user2")).toBeTruthy();
    rerender(
      <AccountLock
        accounts={[acct1]}
        onUnlocked={() => {}}
        onAddNew={() => {}}
      />
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("user1")).toBeTruthy();
    expect(screen.queryByText("user2")).toBeNull();
  });

  it("falls back to a 'create one' empty state with no accounts", () => {
    const onAddNew = vi.fn();
    render(
      <AccountLock
        accounts={[]}
        onUnlocked={() => {}}
        onAddNew={onAddNew}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /create one/i }));
    expect(onAddNew).toHaveBeenCalled();
  });

  // Regression test: an account list going from empty to populated (e.g. a
  // freshly imported vault on a machine with zero accounts) must land the
  // user on that account's unlock form rather than staying stuck on the
  // "No vaults exist" empty state. This previously failed because the
  // selection-repair effect was guarded by `selectedId &&`, which never
  // fires when selectedId starts as "" (the zero-accounts default).
  it("auto-selects the newly available account when the list goes from empty to populated", () => {
    const { rerender } = render(
      <AccountLock accounts={[]} onUnlocked={() => {}} onAddNew={() => {}} />
    );
    expect(screen.getByText(/no vaults exist/i)).toBeTruthy();

    rerender(<AccountLock accounts={[acct1]} onUnlocked={() => {}} onAddNew={() => {}} />);

    expect(screen.getByText("user1")).toBeTruthy();
    expect(screen.queryByText(/no vaults exist/i)).toBeNull();
  });
});

describe("AccountLock — import vault", () => {
  it("imports a picked file under the typed name and reports it via onImported", async () => {
    const { api } = await import("../lib/api");
    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as any).mockResolvedValue("C:\\backups\\vault-backup.enc");
    (api.importVault as any).mockResolvedValue({ id: "a3", name: "restored" });
    const onImported = vi.fn();
    render(
      <AccountLock accounts={[acct1]} onUnlocked={() => {}} onAddNew={() => {}} onImported={onImported} />
    );

    fireEvent.click(screen.getByRole("button", { name: /import vault/i }));
    await waitFor(() => expect(open).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/vault name/i), { target: { value: "restored" } });
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() =>
      expect(api.importVault).toHaveBeenCalledWith("C:\\backups\\vault-backup.enc", "restored")
    );
    expect(onImported).toHaveBeenCalled();
  });

  it("does nothing when the open dialog is cancelled", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as any).mockResolvedValue(null);
    render(<AccountLock accounts={[acct1]} onUnlocked={() => {}} onAddNew={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /import vault/i }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(screen.queryByLabelText(/vault name/i)).toBeNull();
  });

  // Regression test for a race that the earlier "empty to populated" test
  // above does NOT catch: it drives `accounts` with a direct `rerender()`,
  // which updates the prop in the same tick as the assertion. The real
  // App.tsx wiring is different — `accounts` lives in the PARENT, and
  // `onImported` triggers an async IPC refetch (`listAccounts()`) that
  // resolves strictly later than `setSelectedId(result.id)` runs inside
  // `confirmImport`. This harness models that real shape: a parent that owns
  // `accounts` state and only updates it after a genuine async gap.
  function LockHarness({
    initialAccounts,
    accountsAfterImport,
  }: {
    initialAccounts: Account[];
    accountsAfterImport: Account[];
  }) {
    const [accounts, setAccounts] = useState(initialAccounts);
    const onImported = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      setAccounts(accountsAfterImport);
    };
    return (
      <AccountLock
        accounts={accounts}
        onUnlocked={() => {}}
        onAddNew={() => {}}
        onImported={onImported}
      />
    );
  }

  it("selects the newly imported vault even when other vaults already exist (parent-owned accounts state, async refresh)", async () => {
    const { api } = await import("../lib/api");
    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as any).mockResolvedValue("C:\\backups\\vault-backup.enc");
    (api.importVault as any).mockResolvedValue({ id: acct2.id, name: acct2.name });

    render(<LockHarness initialAccounts={[acct1]} accountsAfterImport={[acct1, acct2]} />);

    fireEvent.click(screen.getByRole("button", { name: /import vault/i }));
    await waitFor(() => expect(open).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/vault name/i), { target: { value: "user2" } });
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() => expect(api.importVault).toHaveBeenCalled());

    // The newly imported vault must end up selected, not reverted back to
    // the pre-existing one by the stale-selection repair effect.
    await waitFor(() => expect(screen.getByText("user2")).toBeTruthy());
  });

  // Regression test for round 3: the import itself succeeds, but the
  // post-import `onImported()` refresh rejects (e.g. a transient
  // `listAccounts()` IPC failure) — mirroring App.tsx's real
  // `onImported={async () => { await refreshAccounts().catch(() => {}); }}`
  // wiring, where the rejection is swallowed and `accounts` never catches up
  // with the newly imported id. Before this fix, `pendingSelectionRef` would
  // stay set forever (nothing ever clears it), permanently suppressing the
  // repair effect: `selected` resolves to `undefined` and the UI falls into
  // the "No vaults exist" empty state even though `acct1` is still valid.
  function FailedRefreshHarness({ initialAccounts }: { initialAccounts: Account[] }) {
    const [accounts] = useState(initialAccounts);
    const onImported = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      // The refresh failed and swallowed its own error (as App.tsx's
      // `.catch(() => {})` does) — `accounts` is never updated.
    };
    return (
      <AccountLock accounts={accounts} onUnlocked={() => {}} onAddNew={() => {}} onImported={onImported} />
    );
  }

  it("falls back to the previously-selected account, not the empty state, when the post-import refresh fails", async () => {
    const { api } = await import("../lib/api");
    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as any).mockResolvedValue("C:\\backups\\vault-backup.enc");
    (api.importVault as any).mockResolvedValue({ id: acct2.id, name: acct2.name });

    render(<FailedRefreshHarness initialAccounts={[acct1]} />);

    fireEvent.click(screen.getByRole("button", { name: /import vault/i }));
    await waitFor(() => expect(open).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/vault name/i), { target: { value: "user2" } });
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() => expect(api.importVault).toHaveBeenCalled());

    // `accounts` never gained acct2 (refresh silently failed) — must not get
    // stuck on the empty state; should self-heal back to the still-valid acct1.
    await waitFor(() => expect(screen.getByText("user1")).toBeTruthy());
    expect(screen.queryByText(/no vaults exist/i)).toBeNull();
  });
});

describe("AccountLock — restore from cloud", () => {
  it("sends the url, token, and name, and never renders the token field as plain text", async () => {
    const { api } = await import("../lib/api");
    (api.restoreFromCloud as any).mockResolvedValue({ id: "a3", name: "Restored" });
    render(<AccountLock accounts={[acct1]} onUnlocked={() => {}} onAddNew={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /restore from cloud/i }));
    const tokenField = screen.getByLabelText(/download token/i) as HTMLInputElement;
    expect(tokenField.type).toBe("password");

    fireEvent.change(screen.getByLabelText(/worker url/i), {
      target: { value: "https://w.example.dev" },
    });
    fireEvent.change(tokenField, { target: { value: "get-secret" } });
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Restored" } });
    fireEvent.click(screen.getByRole("button", { name: /^restore$/i }));

    await waitFor(() =>
      expect(api.restoreFromCloud).toHaveBeenCalledWith(
        "https://w.example.dev",
        "get-secret",
        "Restored"
      )
    );
  });

  it("tells the user the restore adds a new vault and overwrites nothing", () => {
    render(<AccountLock accounts={[acct1]} onUnlocked={() => {}} onAddNew={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /restore from cloud/i }));
    expect(screen.getByText(/adds it as a new vault/i)).toBeTruthy();
    expect(screen.getByText(/nothing on this device is overwritten/i)).toBeTruthy();
  });

  it("surfaces a restore failure without touching the account list", async () => {
    const { api } = await import("../lib/api");
    (api.restoreFromCloud as any).mockRejectedValue("token rejected by the worker");
    render(<AccountLock accounts={[acct1]} onUnlocked={() => {}} onAddNew={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /restore from cloud/i }));
    fireEvent.change(screen.getByLabelText(/worker url/i), {
      target: { value: "https://w.example.dev" },
    });
    fireEvent.change(screen.getByLabelText(/download token/i), { target: { value: "bad" } });
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Restored" } });
    fireEvent.click(screen.getByRole("button", { name: /^restore$/i }));

    expect(await screen.findByText(/token rejected by the worker/i)).toBeTruthy();
    expect(screen.getByText("user1")).toBeTruthy();
  });

  // Same async-refetch race as the import-vault harness above: `accounts`
  // lives in the parent and `onImported` resolves strictly later than
  // `setSelectedId(result.id)` runs inside `confirmRestore`.
  function RestoreHarness({
    initialAccounts,
    accountsAfterRestore,
  }: {
    initialAccounts: Account[];
    accountsAfterRestore: Account[];
  }) {
    const [accounts, setAccounts] = useState(initialAccounts);
    const onImported = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      setAccounts(accountsAfterRestore);
    };
    return (
      <AccountLock
        accounts={accounts}
        onUnlocked={() => {}}
        onAddNew={() => {}}
        onImported={onImported}
      />
    );
  }

  it("selects the newly restored vault even when other vaults already exist (parent-owned accounts state, async refresh)", async () => {
    const { api } = await import("../lib/api");
    (api.restoreFromCloud as any).mockResolvedValue({ id: acct2.id, name: acct2.name });

    render(<RestoreHarness initialAccounts={[acct1]} accountsAfterRestore={[acct1, acct2]} />);

    fireEvent.click(screen.getByRole("button", { name: /restore from cloud/i }));
    fireEvent.change(screen.getByLabelText(/worker url/i), {
      target: { value: "https://w.example.dev" },
    });
    fireEvent.change(screen.getByLabelText(/download token/i), { target: { value: "tok" } });
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "user2" } });
    fireEvent.click(screen.getByRole("button", { name: /^restore$/i }));

    await waitFor(() => expect(api.restoreFromCloud).toHaveBeenCalled());

    // The newly restored vault must end up selected, not reverted back to
    // the pre-existing one by the stale-selection repair effect.
    await waitFor(() => expect(screen.getByText("user2")).toBeTruthy());
  });
});

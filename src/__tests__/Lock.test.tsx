import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AccountLock from "../screens/AccountLock";

const acct1 = { id: "a1", name: "user1" };
const acct2 = { id: "a2", name: "user2" };

vi.mock("../lib/api", () => ({
  api: {
    unlockVault: vi.fn().mockResolvedValue(undefined),
    resetVault: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("AccountLock", () => {
  it("renders a password field and unlock button for a single account", () => {
    render(
      <AccountLock
        accounts={[acct1]}
        onUnlocked={() => {}}
        onReset={() => {}}
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
        onReset={() => {}}
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
        onReset={() => {}}
        onAddNew={() => {}}
      />
    );
    fireEvent.change(screen.getByLabelText("Master password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: /unlock/i }));
    expect(await screen.findByText(/wrong password/i)).toBeTruthy();
  });

  it("renders an account picker when there is more than one account", () => {
    render(
      <AccountLock
        accounts={[acct1, acct2]}
        onUnlocked={() => {}}
        onReset={() => {}}
        onAddNew={() => {}}
      />
    );
    expect(screen.getByText("user1")).toBeTruthy();
    expect(screen.getByText("user2")).toBeTruthy();
  });

  it("picking a different account switches the unlock target", async () => {
    const { api } = await import("../lib/api");
    render(
      <AccountLock
        accounts={[acct1, acct2]}
        onUnlocked={() => {}}
        onReset={() => {}}
        onAddNew={() => {}}
      />
    );
    fireEvent.click(screen.getByText("user2"));
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
        onReset={() => {}}
        onAddNew={onAddNew}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /add another vault/i }));
    expect(onAddNew).toHaveBeenCalled();
  });

  it("renders a 'forgot password' link", () => {
    render(
      <AccountLock
        accounts={[acct1]}
        onUnlocked={() => {}}
        onReset={() => {}}
        onAddNew={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: /forgot password/i })).toBeTruthy();
  });

  it("reset flow: two warnings then password confirm, calls api.resetVault and onReset", async () => {
    const onReset = vi.fn();
    const { api } = await import("../lib/api");
    render(
      <AccountLock
        accounts={[acct1]}
        onUnlocked={() => {}}
        onReset={onReset}
        onAddNew={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
    expect(
      await screen.findByRole("heading", { name: /permanently delete/i })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(
      await screen.findByRole("heading", { name: /last warning/i })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    const confirmInput = await screen.findByLabelText(/confirm master password/i);
    fireEvent.change(confirmInput, { target: { value: "secret-pw" } });
    fireEvent.click(screen.getByRole("button", { name: /^reset vault$/i }));

    await waitFor(() =>
      expect(api.resetVault).toHaveBeenCalledWith("secret-pw", "a1")
    );
    expect(onReset).toHaveBeenCalledWith("a1");
  });

  it("reset flow: wrong password on confirm step shows error and aborts", async () => {
    const onReset = vi.fn();
    const { api } = await import("../lib/api");
    (api.resetVault as any).mockRejectedValueOnce("invalid password");
    render(
      <AccountLock
        accounts={[acct1]}
        onUnlocked={() => {}}
        onReset={onReset}
        onAddNew={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
    fireEvent.click(await screen.findByRole("button", { name: /continue/i }));
    fireEvent.click(await screen.findByRole("button", { name: /continue/i }));

    const confirmInput = await screen.findByLabelText(/confirm master password/i);
    fireEvent.change(confirmInput, { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /^reset vault$/i }));

    expect(await screen.findByText(/wrong password/i)).toBeTruthy();
    expect(onReset).not.toHaveBeenCalled();
  });

  it("reset flow: cancel returns to the lock screen", async () => {
    render(
      <AccountLock
        accounts={[acct1]}
        onUnlocked={() => {}}
        onReset={() => {}}
        onAddNew={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));
    expect(screen.getByRole("button", { name: /unlock/i })).toBeTruthy();
  });

  it("falls back to a 'create one' empty state with no accounts", () => {
    const onAddNew = vi.fn();
    render(
      <AccountLock
        accounts={[]}
        onUnlocked={() => {}}
        onReset={() => {}}
        onAddNew={onAddNew}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /create one/i }));
    expect(onAddNew).toHaveBeenCalled();
  });
});

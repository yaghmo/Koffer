import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AccountLock from "../screens/AccountLock";

const acct1 = { id: "a1", name: "user1" };
const acct2 = { id: "a2", name: "user2" };

vi.mock("../lib/api", () => ({
  api: {
    unlockVault: vi.fn().mockResolvedValue(undefined),
  },
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

  it("renders an account picker when there is more than one account", () => {
    render(
      <AccountLock
        accounts={[acct1, acct2]}
        onUnlocked={() => {}}
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

  it("removes a deleted account from the list immediately when the prop changes", () => {
    const { rerender } = render(
      <AccountLock
        accounts={[acct1, acct2]}
        onUnlocked={() => {}}
        onAddNew={() => {}}
      />
    );
    expect(screen.getByText("user1")).toBeTruthy();
    expect(screen.getByText("user2")).toBeTruthy();
    rerender(
      <AccountLock
        accounts={[acct1]}
        onUnlocked={() => {}}
        onAddNew={() => {}}
      />
    );
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
});

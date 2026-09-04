import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Lock from "../screens/Lock";

vi.mock("../lib/api", () => ({
  api: {
    unlockVault: vi.fn().mockResolvedValue(undefined),
    resetVault: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("Lock", () => {
  it("renders a password field and unlock button", () => {
    render(<Lock onUnlocked={() => {}} />);
    expect(screen.getByLabelText("Master password")).toBeTruthy();
    expect(screen.getByRole("button", { name: /unlock/i })).toBeTruthy();
  });

  it("calls unlockVault and onUnlocked on success", async () => {
    const onUnlocked = vi.fn();
    const { api } = await import("../lib/api");
    render(<Lock onUnlocked={onUnlocked} />);
    fireEvent.change(screen.getByLabelText("Master password"), {
      target: { value: "secret-pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: /unlock/i }));
    await waitFor(() => expect(api.unlockVault).toHaveBeenCalledWith("secret-pw"));
    expect(onUnlocked).toHaveBeenCalled();
  });

  it("shows an error message on failure", async () => {
    const { api } = await import("../lib/api");
    (api.unlockVault as any).mockRejectedValueOnce("invalid password");
    render(<Lock onUnlocked={() => {}} />);
    fireEvent.change(screen.getByLabelText("Master password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: /unlock/i }));
    expect(await screen.findByText(/wrong password/i)).toBeTruthy();
  });

  it("renders a 'forgot password' link", () => {
    render(<Lock onUnlocked={() => {}} />);
    expect(screen.getByRole("button", { name: /forgot password/i })).toBeTruthy();
  });

  it("reset flow: two warnings then password confirm, calls api.resetVault and onReset", async () => {
    const onReset = vi.fn();
    const { api } = await import("../lib/api");
    render(<Lock onUnlocked={() => {}} onReset={onReset} />);

    // 1st click → 1st warning
    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
    expect(
      await screen.findByText(/this will permanently delete/i)
    ).toBeTruthy();
    // click "Continue" inside the modal
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    // 2nd warning
    expect(
      await screen.findByText(/all your items will be lost/i)
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    // 3rd step: confirm by re-entering password
    const confirmInput = await screen.findByLabelText(/confirm master password/i);
    fireEvent.change(confirmInput, { target: { value: "secret-pw" } });
    fireEvent.click(screen.getByRole("button", { name: /^reset vault$/i }));

    await waitFor(() =>
      expect(api.resetVault).toHaveBeenCalledWith("secret-pw")
    );
    expect(onReset).toHaveBeenCalled();
  });

  it("reset flow: wrong password on confirm step shows error and aborts", async () => {
    const onReset = vi.fn();
    const { api } = await import("../lib/api");
    (api.resetVault as any).mockRejectedValueOnce("invalid password");
    render(<Lock onUnlocked={() => {}} onReset={onReset} />);

    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
    fireEvent.click(await screen.findByRole("button", { name: /continue/i }));
    fireEvent.click(await screen.findByRole("button", { name: /continue/i }));

    const confirmInput = await screen.findByLabelText(/confirm master password/i);
    fireEvent.change(confirmInput, { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /^reset vault$/i }));

    expect(await screen.findByText(/wrong password/i)).toBeTruthy();
    expect(onReset).not.toHaveBeenCalled();
  });

  it("reset flow: cancel button on warning returns to the lock screen", async () => {
    render(<Lock onUnlocked={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));
    // back to lock: the original unlock button is visible
    expect(
      screen.getByRole("button", { name: /unlock/i })
    ).toBeTruthy();
  });
});

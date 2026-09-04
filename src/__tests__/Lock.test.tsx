import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Lock from "../screens/Lock";

vi.mock("../lib/api", () => ({
  api: {
    unlockVault: vi.fn().mockResolvedValue(undefined),
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
});

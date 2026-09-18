import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Setup from "../screens/Setup";

const newAccount = { id: "a1", name: "user1" };

vi.mock("../lib/api", () => {
  return {
    api: {
      setupVault: vi.fn().mockResolvedValue({ id: "a1", name: "user1" }),
    },
  };
});

describe("Setup", () => {
  it("renders a display name field, two password fields, and a create button", () => {
    render(<Setup onCreated={() => {}} onCancel={() => {}} />);
    expect(screen.getByLabelText("Display name")).toBeTruthy();
    expect(screen.getByLabelText("Master password")).toBeTruthy();
    expect(screen.getByLabelText("Confirm master password")).toBeTruthy();
    expect(screen.getByRole("button", { name: /create/i })).toBeTruthy();
  });

  it("calls setupVault with name + password and onCreated when valid", async () => {
    const onCreated = vi.fn();
    const { api } = await import("../lib/api");
    render(<Setup onCreated={onCreated} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "user1" },
    });
    fireEvent.change(screen.getByLabelText("Master password"), {
      target: { value: "correcthorse" },
    });
    fireEvent.change(screen.getByLabelText("Confirm master password"), {
      target: { value: "correcthorse" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() =>
      expect(api.setupVault).toHaveBeenCalledWith("correcthorse", "user1")
    );
    expect(onCreated).toHaveBeenCalledWith(newAccount);
  });

  it("rejects an empty display name", async () => {
    render(<Setup onCreated={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "   " },
    });
    fireEvent.change(screen.getByLabelText("Master password"), {
      target: { value: "correcthorse" },
    });
    fireEvent.change(screen.getByLabelText("Confirm master password"), {
      target: { value: "correcthorse" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/display name is required/i)).toBeTruthy();
  });

  it("shows an error when passwords do not match", async () => {
    render(<Setup onCreated={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "user1" },
    });
    fireEvent.change(screen.getByLabelText("Master password"), {
      target: { value: "abcdefgh" },
    });
    fireEvent.change(screen.getByLabelText("Confirm master password"), {
      target: { value: "xxxxxx" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/do not match/i)).toBeTruthy();
  });
});

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import UpdatePrompt from "../components/UpdatePrompt";

vi.mock("../lib/api", () => ({
  api: {
    checkUpdate: vi.fn().mockResolvedValue("0.1.57"),
    // Never settles: a real install ends with the app restarting.
    installUpdate: vi.fn().mockReturnValue(new Promise(() => {})),
  },
}));

describe("UpdatePrompt", () => {
  it("offers the newer version and installs only when asked", async () => {
    const { api } = await import("../lib/api");
    render(<UpdatePrompt />);
    expect(await screen.findByRole("dialog", { name: /koffer 0\.1\.57/i })).toBeTruthy();
    expect(api.installUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(api.installUpdate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toMatch(/downloading the update/i);
  });
});

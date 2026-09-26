import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import LeakCheck from "../components/LeakCheck";

vi.mock("../lib/api", () => ({
  api: {
    checkLeakedPasswords: vi.fn().mockResolvedValue([{ id: "i1", title: "Gmail", username: "me", count: 12345 }]),
  },
}));

describe("LeakCheck", () => {
  it("checks only when asked, then lists leaked logins that open the item", async () => {
    const { api } = await import("../lib/api");
    const onViewItem = vi.fn();
    render(<LeakCheck onViewItem={onViewItem} />);
    expect(api.checkLeakedPasswords).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /check for leaked passwords/i }));
    fireEvent.click(await screen.findByText(/gmail/i));
    expect(onViewItem).toHaveBeenCalledWith("i1");
    expect(screen.getByText(/12,345/)).toBeTruthy();
  });
});

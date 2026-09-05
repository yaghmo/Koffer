import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ItemViewer from "../screens/ItemViewer";

vi.mock("../lib/api", () => ({
  api: {
    getItem: vi.fn().mockResolvedValue({
      type: "login",
      id: "1",
      title: "GitHub",
      notes: "",
      created_at: 0,
      updated_at: 0,
      method: "credentials",
      url: "https://github.com",
      username: "octocat",
      password: "s3cret",
    }),
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
    deleteItem: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("ItemViewer", () => {
  it("loads the item and shows non-secret fields", async () => {
    render(<ItemViewer id="1" onEdit={() => {}} onClose={() => {}} onDelete={() => {}} />);
    expect(await screen.findByDisplayValue("GitHub")).toBeTruthy();
    expect(await screen.findByDisplayValue("octocat")).toBeTruthy();
  });

  it("masks the password and reveals it on toggle", async () => {
    render(<ItemViewer id="1" onEdit={() => {}} onClose={() => {}} onDelete={() => {}} />);
    const pwInput = (await screen.findByLabelText(/password/i, {
      selector: "input",
    })) as HTMLInputElement;
    expect(pwInput.value).not.toBe("s3cret");
    expect(pwInput.value).toMatch(/[•]/);
    fireEvent.click(screen.getByRole("button", { name: /^show$/i }));
    expect(pwInput.value).toBe("s3cret");
  });

  it("fires onEdit when the Edit button is clicked", async () => {
    const onEdit = vi.fn();
    render(<ItemViewer id="1" onEdit={onEdit} onClose={() => {}} onDelete={() => {}} />);
    await screen.findByDisplayValue("GitHub");
    fireEvent.click(screen.getByRole("button", { name: /^edit item$/i }));
    expect(onEdit).toHaveBeenCalledWith("1");
  });

  it("copies a field via api.copyToClipboard", async () => {
    const { api } = await import("../lib/api");
    render(<ItemViewer id="1" onEdit={() => {}} onClose={() => {}} onDelete={() => {}} />);
    await screen.findByDisplayValue("octocat");
    fireEvent.click(screen.getByRole("button", { name: /copy username/i }));
    await waitFor(() => expect(api.copyToClipboard).toHaveBeenCalledWith("octocat", 30));
  });
});

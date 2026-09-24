import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
    totpCode: vi.fn().mockResolvedValue({ code: "287082", seconds_left: 12 }),
    useLastSeen: vi.fn().mockResolvedValue(undefined),
    dismissLastSeen: vi.fn().mockResolvedValue(undefined),
    restorePreviousPassword: vi.fn().mockResolvedValue(undefined),
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

  it("shows the 2FA code with its countdown, and copies it without the space", async () => {
    const { api } = await import("../lib/api");
    vi.mocked(api.getItem).mockResolvedValueOnce({
      type: "login", id: "1", title: "GitHub", notes: "", created_at: 0, updated_at: 0, favicon: "",
      method: "credentials", url: "https://github.com", username: "octocat", password: "s3cret",
      phone: "", totp: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    });
    render(<ItemViewer id="1" onEdit={() => {}} onClose={() => {}} onDelete={() => {}} />);
    expect(await screen.findByDisplayValue("287 082")).toBeTruthy();
    expect(screen.getByText("12s")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /copy 2fa code/i }));
    await waitFor(() => expect(api.copyToClipboard).toHaveBeenCalledWith("287082", 30));
  });

  it("shows no 2FA row for a login without a key", async () => {
    render(<ItemViewer id="1" onEdit={() => {}} onClose={() => {}} onDelete={() => {}} />);
    await screen.findByDisplayValue("GitHub");
    expect(screen.queryByLabelText(/2fa code/i)).toBeNull();
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

  it("Esc calls onClose", async () => {
    const onClose = vi.fn();
    render(<ItemViewer id="1" onEdit={() => {}} onClose={onClose} onDelete={() => {}} />);
    await screen.findByDisplayValue("GitHub");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("ItemViewer password history", () => {
  const withHistory = {
    type: "login", id: "1", title: "GitHub", notes: "", created_at: 0, updated_at: 0, favicon: "",
    method: "credentials", url: "https://github.com", username: "octocat", password: "s3cret",
    phone: "", totp: "",
    last_seen: { password: "n3wer", seen_at: 1790000000 },
    previous_passwords: [{ password: "0lder", replaced_at: 1780000000 }],
  };
  let original: unknown;

  beforeEach(async () => {
    const { api } = await import("../lib/api");
    original = await api.getItem("1");
    vi.mocked(api.getItem).mockResolvedValue(withHistory as never);
  });

  afterEach(async () => {
    const { api } = await import("../lib/api");
    vi.mocked(api.getItem).mockResolvedValue(original as never);
  });

  it("warns when a browser login last worked with a different password", async () => {
    const { api } = await import("../lib/api");
    render(<ItemViewer id="1" onEdit={() => {}} onClose={() => {}} onDelete={() => {}} />);
    const banner = await screen.findByRole("status", { name: /password may be out of date/i });
    expect(banner.textContent).not.toContain("n3wer");
    fireEvent.click(within(banner).getByRole("button", { name: /reveal/i }));
    expect(banner.textContent).toContain("n3wer");
    fireEvent.click(within(banner).getByRole("button", { name: /use this one/i }));
    await waitFor(() => expect(api.useLastSeen).toHaveBeenCalledWith("1"));
  });

  it("dismisses the warning", async () => {
    const { api } = await import("../lib/api");
    render(<ItemViewer id="1" onEdit={() => {}} onClose={() => {}} onDelete={() => {}} />);
    const banner = await screen.findByRole("status", { name: /password may be out of date/i });
    fireEvent.click(within(banner).getByRole("button", { name: /dismiss/i }));
    await waitFor(() => expect(api.dismissLastSeen).toHaveBeenCalledWith("1"));
  });

  it("lists previous passwords masked and restores one", async () => {
    const { api } = await import("../lib/api");
    render(<ItemViewer id="1" onEdit={() => {}} onClose={() => {}} onDelete={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /previous passwords \(1\)/i }));
    const list = screen.getByRole("list", { name: /previous passwords/i });
    expect(list.textContent).not.toContain("0lder");
    fireEvent.click(within(list).getByRole("button", { name: /restore/i }));
    await waitFor(() => expect(api.restorePreviousPassword).toHaveBeenCalledWith("1", 0));
  });
});

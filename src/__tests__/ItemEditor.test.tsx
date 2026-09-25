import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import ItemEditor from "../screens/ItemEditor";

let itemsChanged: () => void = () => {};
vi.mock("../lib/events", () => ({
  onItemsChanged: (fn: () => void) => {
    itemsChanged = fn;
    return Promise.resolve(() => {});
  },
}));

vi.mock("../lib/api", () => ({
  api: {
    getItem: vi.fn().mockResolvedValue({
      type: "login",
      id: "1",
      title: "GitHub",
      notes: "",
      created_at: 0,
      updated_at: 0,
      url: "https://github.com",
      username: "octocat",
      password: "s3cret",
    }),
    saveItem: vi.fn().mockResolvedValue(undefined),
    listItems: vi.fn().mockResolvedValue([]),
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
    totpFromClipboard: vi.fn(),
    totpCheck: vi.fn().mockResolvedValue("<svg></svg>"),
    fetchUrlMetadata: vi.fn().mockResolvedValue({
      title: null,
      favicon_data_url: null,
    }),
    getPersonalInfo: vi.fn().mockResolvedValue({
      name: "",
      username: "",
      email: "",
      phone: "",
      website: "",
      github: "",
      linkedin: "",
    }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ItemEditor", () => {
  it("refuses to save a credentials login without a password", async () => {
    const { api } = await import("../lib/api");
    render(<ItemEditor id={null} onClose={() => {}} />);
    fireEvent.change(await screen.findByLabelText(/title/i), { target: { value: "No password" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/password is required/i)).toBeTruthy();
    expect(api.saveItem).not.toHaveBeenCalled();
  });

  it("fills the 2FA key from a QR code on the clipboard, and saves it", async () => {
    const { api } = await import("../lib/api");
    const link = "otpauth://totp/Site:me?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    vi.mocked(api.totpFromClipboard).mockResolvedValueOnce(link);
    render(<ItemEditor id={null} onClose={() => {}} />);
    fireEvent.change(await screen.findByLabelText(/title/i), { target: { value: "Site" } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: /paste qr code/i }));
    expect(await screen.findByDisplayValue(link)).toBeTruthy();
    // Drawn back, so the user can see it was read.
    expect(await screen.findByAltText(/2fa key as a qr code/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(api.saveItem).toHaveBeenCalledWith(expect.objectContaining({ totp: link })));
  });

  it("confirms a typed key with a button, and shows it back", async () => {
    const { api } = await import("../lib/api");
    render(<ItemEditor id={null} onClose={() => {}} />);
    const key = await screen.findByLabelText(/2fa key/i);
    fireEvent.change(key, { target: { value: "GEZD GNBV GY3T QOJQ" } });
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
    expect(await screen.findByAltText(/2fa key as a qr code/i)).toBeTruthy();
    expect(api.totpCheck).toHaveBeenCalledWith("GEZD GNBV GY3T QOJQ");
    // Editing the key again takes the confirmation away.
    fireEvent.change(key, { target: { value: "GEZD" } });
    expect(screen.queryByAltText(/2fa key as a qr code/i)).toBeNull();
  });

  it("reads a QR code pasted straight into the key box", async () => {
    const { api } = await import("../lib/api");
    const link = "otpauth://totp/Site:me?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    vi.mocked(api.totpFromClipboard).mockResolvedValueOnce(link);
    render(<ItemEditor id={null} onClose={() => {}} />);
    fireEvent.paste(await screen.findByLabelText(/2fa key/i), {
      clipboardData: { items: [{ type: "image/png" }] },
    });
    expect(await screen.findByDisplayValue(link)).toBeTruthy();
  });

  it("says why when the clipboard holds no QR code", async () => {
    const { api } = await import("../lib/api");
    vi.mocked(api.totpFromClipboard).mockRejectedValueOnce("No QR code found in the copied image.");
    render(<ItemEditor id={null} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /paste qr code/i }));
    expect(await screen.findByText(/no qr code found/i)).toBeTruthy();
  });

  it("takes a password the browser changed while it was open, unless it was edited here", async () => {
    const { api } = await import("../lib/api");
    render(<ItemEditor id="1" onClose={() => {}} />);
    const pw = (await screen.findByLabelText(/^password$/i)) as HTMLInputElement;
    await waitFor(() => expect(pw.value).toBe("s3cret"));
    vi.mocked(api.getItem).mockResolvedValueOnce({
      type: "login", id: "1", title: "GitHub", notes: "", created_at: 0, updated_at: 0, favicon: "",
      method: "credentials", url: "https://github.com", username: "octocat", password: "fr0m-browser",
      phone: "", totp: "",
    });
    itemsChanged();
    await waitFor(() => expect(pw.value).toBe("fr0m-browser"));

    // Typed here: the user's edit wins, and the browser's stays in history.
    fireEvent.change(pw, { target: { value: "typed" } });
    vi.mocked(api.getItem).mockResolvedValueOnce({
      type: "login", id: "1", title: "GitHub", notes: "", created_at: 0, updated_at: 0, favicon: "",
      method: "credentials", url: "https://github.com", username: "octocat", password: "again",
      phone: "", totp: "",
    });
    itemsChanged();
    await new Promise((r) => setTimeout(r, 50));
    expect(pw.value).toBe("typed");
  });

  it("keeps the kind selector locked when editing an existing item", async () => {
    render(<ItemEditor id="1" onClose={() => {}} />);
    await screen.findByDisplayValue("GitHub");
    expect(screen.queryByRole("group", { name: /item kind/i })).toBeNull();
  });

  it("loads an existing item and shows its fields", async () => {
    render(<ItemEditor id="1" onClose={() => {}} />);
    expect(await screen.findByDisplayValue("GitHub")).toBeTruthy();
    expect(await screen.findByDisplayValue("octocat")).toBeTruthy();
  });

  it("shows a new empty form when id is null", async () => {
    render(<ItemEditor id={null} onClose={() => {}} />);
    expect(await screen.findByLabelText(/title/i)).toBeTruthy();
  });

  it("calls saveItem with the form values on save", async () => {
    const { api } = await import("../lib/api");
    const onClose = vi.fn();
    render(<ItemEditor id={null} onClose={onClose} />);
    fireEvent.change(await screen.findByLabelText(/title/i), {
      target: { value: "Test login" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "s3cret-pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(api.saveItem).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("opens with the requested initial kind", async () => {
    render(<ItemEditor id={null} initialKind="note" onClose={() => {}} />);
    // Note editor shows a textarea with aria-label "Note body"
    expect(await screen.findByLabelText(/note body/i)).toBeTruthy();
  });

  it("rejects a non-URL string in the URL field", async () => {
    const { api } = await import("../lib/api");
    render(<ItemEditor id={null} onClose={() => {}} />);
    fireEvent.change(await screen.findByLabelText(/title/i), {
      target: { value: "Bad" },
    });
    fireEvent.change(screen.getByLabelText(/^url$/i), {
      target: { value: "not a link" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/valid http/i)).toBeTruthy();
    expect(api.saveItem).not.toHaveBeenCalled();
  });

  it("accepts a valid https URL", async () => {
    const { api } = await import("../lib/api");
    const onClose = vi.fn();
    render(<ItemEditor id={null} onClose={onClose} />);
    fireEvent.change(await screen.findByLabelText(/title/i), {
      target: { value: "Good" },
    });
    fireEvent.change(screen.getByLabelText(/^url$/i), {
      target: { value: "https://example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "s3cret-pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(api.saveItem).toHaveBeenCalled());
  });

  it("strips path from URL on blur and fetches metadata", async () => {
    const { api } = await import("../lib/api");
    render(<ItemEditor id={null} onClose={() => {}} />);
    const urlInput = screen.getByLabelText(/^url$/i) as HTMLInputElement;
    fireEvent.change(urlInput, {
      target: { value: "https://www.twitch.tv/humzh" },
    });
    fireEvent.blur(urlInput);
    await waitFor(() =>
      expect((screen.getByLabelText(/^url$/i) as HTMLInputElement).value).toBe(
        "https://www.twitch.tv"
      )
    );
    expect(api.fetchUrlMetadata).toHaveBeenCalledWith("https://www.twitch.tv");
  });

  it("masks the password and reveals it on toggle", async () => {
    render(<ItemEditor id={null} onClose={() => {}} />);
    const pw = (await screen.findByLabelText(/^password$/i, {
      selector: "input",
    })) as HTMLInputElement;
    expect(pw.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: /show password/i }));
    expect(pw.type).toBe("text");
  });

  it("lowercases a typed email account", async () => {
    const { api } = await import("../lib/api");
    render(<ItemEditor id={null} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /google/i }));
    fireEvent.click(screen.getByRole("button", { name: /\+ add new account/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^account$/i), {
      target: { value: "Me.Loud@GMAIL.com" },
    });
    fireEvent.change(within(dialog).getByLabelText(/^password$/i), { target: { value: "pw" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /save/i }));
    await waitFor(() => expect(api.saveItem).toHaveBeenCalled());
    const saved = (api.saveItem as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saved.username).toBe("me.loud@gmail.com");
  });

  it("hides the password field for a provider login until asked for", async () => {
    render(<ItemEditor id={null} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /google/i }));
    expect(screen.queryByLabelText(/^password$/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /still have a password/i }));
    expect(screen.getByLabelText(/^password$/i)).toBeTruthy();
  });

  it("saves an added account as a login of the provider method", async () => {
    const { api } = await import("../lib/api");
    render(<ItemEditor id={null} onClose={() => {}} />);
    // Pick the Google method → account sub-flow appears, no account input.
    fireEvent.click(screen.getByRole("radio", { name: /google/i }));
    fireEvent.click(screen.getByRole("button", { name: /\+ add new account/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^account$/i), {
      target: { value: "me@gmail.com" },
    });
    fireEvent.change(within(dialog).getByLabelText(/^password$/i), {
      target: { value: "pw" },
    });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /save/i }));
    await waitFor(() => expect(api.saveItem).toHaveBeenCalled());
    const saved = (api.saveItem as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saved.method).toBe("google");
    expect(saved.username).toBe("me@gmail.com");
    // A Google sign-in is a Gmail account: titled and linked as one.
    expect(saved.title).toBe("Gmail");
    expect(saved.url).toBe("https://mail.google.com");
    expect(saved.password).toBe("pw");
  });

  it("calls onSaved after a successful save", async () => {
    const onSaved = vi.fn();
    render(<ItemEditor id={null} onClose={() => {}} onSaved={onSaved} />);
    fireEvent.change(await screen.findByLabelText(/title/i), {
      target: { value: "Saved" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "s3cret-pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("Ctrl+S saves the form", async () => {
    const { api } = await import("../lib/api");
    const onClose = vi.fn();
    render(<ItemEditor id={null} onClose={onClose} />);
    fireEvent.change(await screen.findByLabelText(/title/i), {
      target: { value: "Hotkey save" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "s3cret-pw" },
    });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(api.saveItem).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("Esc cancels when the form is untouched", async () => {
    const onClose = vi.fn();
    render(<ItemEditor id={null} onClose={onClose} />);
    await screen.findByLabelText(/title/i);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("Esc does not cancel after typing", async () => {
    const onClose = vi.fn();
    render(<ItemEditor id={null} onClose={onClose} />);
    fireEvent.change(await screen.findByLabelText(/title/i), {
      target: { value: "Don't lose me" },
    });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  async function fillCard(values: { number: string; exp: string }) {
    render(<ItemEditor id={null} initialKind="card" onClose={() => {}} />);
    fireEvent.change(await screen.findByLabelText(/title/i), { target: { value: "My card" } });
    fireEvent.change(screen.getByLabelText(/card number/i), { target: { value: values.number } });
    fireEvent.change(screen.getByLabelText(/card expiration/i), { target: { value: values.exp } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
  }

  it("rejects a card number that fails the Luhn check", async () => {
    const { api } = await import("../lib/api");
    await fillCard({ number: "4111111111111112", exp: "12/40" });
    expect(await screen.findByText(/check the digits/i)).toBeTruthy();
    expect(api.saveItem).not.toHaveBeenCalled();
  });

  it("rejects an expired card", async () => {
    const { api } = await import("../lib/api");
    await fillCard({ number: "4111111111111111", exp: "01/20" });
    expect(await screen.findByText(/has expired/i)).toBeTruthy();
    expect(api.saveItem).not.toHaveBeenCalled();
  });

  it("saves a card that passes Luhn and is still valid", async () => {
    const { api } = await import("../lib/api");
    await fillCard({ number: "4111111111111111", exp: "12/40" });
    await waitFor(() => expect(api.saveItem).toHaveBeenCalled());
  });
});

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Item, ItemKind, LoginFields, NoteFields, CardFields } from "../lib/types";
import { CopyIcon, CheckIcon, EyeIcon, EyeOffIcon, XIcon } from "../components/Icon";
import { methods, MethodChip } from "../lib/methods";

interface Props {
  id: string | null;
  initialKind?: ItemKind;
  onClose: () => void;
  onSaved?: () => void;
}

const emptyLogin = (): LoginFields => ({ method: "credentials", url: "", username: "", password: "" });
const emptyNote = (): NoteFields => ({ body: "" });
const emptyCard = (): CardFields => ({ cardholder: "", number: "", exp: "", cvv: "" });

// Accept http(s) URLs only, with a host. Empty is allowed (URL is optional).
function isValidUrl(s: string): boolean {
  if (!s.trim()) return true;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Card expiration: MM/YY only (2 digits slash 2 digits). Must be complete or empty.
function isValidExp(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  // MM/YY exactly, or incomplete (1-4 digits, possibly with slash) if not submitting
  return /^\d{2}\/\d{2}$/.test(t);
}

// Format card number as user types: "1234567890123456" → "1234-5678-9012-3456".
function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 16);
  const parts = [];
  for (let i = 0; i < digits.length; i += 4) {
    parts.push(digits.slice(i, i + 4));
  }
  return parts.join("-");
}

// Format exp as user types: "0125" → "01/25", "1" → "1", "12" → "12/".
function formatCardExp(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length >= 3) {
    return digits.slice(0, 2) + "/" + digits.slice(2, 4);
  }
  return digits;
}

export default function ItemEditor({ id, initialKind, onClose, onSaved }: Props) {
  const [kind, setKind] = useState<ItemKind>(initialKind ?? "login");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [login, setLogin] = useState<LoginFields>(emptyLogin());
  const [note, setNote] = useState<NoteFields>(emptyNote());
  const [card, setCard] = useState<CardFields>(emptyCard());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Passwords are masked by default; the reveal toggle shows them in the clear.
  const [showPassword, setShowPassword] = useState(false);

  // URL metadata (favicon + title) fetched on paste
  const [favicon, setFavicon] = useState<string | null>(null);
  const [fetchingMeta, setFetchingMeta] = useState(false);

  useEffect(() => {
    if (id === null) return;
    api.getItem(id).then((item) => {
      setKind(item.type);
      setTitle(item.title);
      setNotes(item.notes);
      setFavicon(item.favicon || null);
      if (item.type === "login") {
        setLogin({
          method: item.method || "credentials",
          url: item.url,
          username: item.username,
          password: item.password,
        });
      } else if (item.type === "note") {
        setNote({ body: item.body });
      } else {
        setCard({
          cardholder: item.cardholder,
          number: item.number,
          exp: item.exp,
          cvv: item.cvv,
        });
      }
    }).catch((err) => {
      setError(`Failed to load item: ${err}`);
    });
  }, [id]);

  async function copy(label: string, text: string) {
    if (!text) return;
    try {
      await api.copyToClipboard(text, 30);
      setCopied(label);
      window.setTimeout(() => setCopied((c) => (c === label ? null : c)), 1400);
    } catch {
      // ignore
    }
  }

  async function handleUrlBlur() {
    let url = login.url.trim();
    if (!url || !isValidUrl(url) || fetchingMeta) return;

    // Strip path/query: store bare host origin (https://www.twitch.tv).
    try {
      const u = new URL(url);
      const cleaned = `${u.protocol}//${u.host}`;
      if (cleaned !== url) {
        url = cleaned;
        setLogin((prev) => ({ ...prev, url: url }));
      }
    } catch {
      // not a parseable URL — leave as typed
    }

    setFetchingMeta(true);
    try {
      const meta = await api.fetchUrlMetadata(url);
      if (meta.favicon_data_url) {
        setFavicon(meta.favicon_data_url);
      }
      if (meta.title && !title.trim()) {
        setTitle(meta.title);
      }
    } catch {
      // Fetch failed, no metadata. Silent ignore.
    } finally {
      setFetchingMeta(false);
    }
  }

  async function save() {
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (kind === "login" && !isValidUrl(login.url)) {
      setError("URL must be a valid http(s) link (e.g. https://example.com).");
      return;
    }
    if (kind === "card") {
      if (!card.exp.trim()) {
        setError("Card expiration is required.");
        return;
      }
      if (!isValidExp(card.exp)) {
        setError("Card expiration must be MM/YY.");
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const now = Date.now();
      const itemId = id ?? crypto.randomUUID();
      let item: Item;
      const base = {
        id: itemId,
        title: title.trim(),
        notes,
        created_at: 0,
        updated_at: now,
        favicon: favicon ?? "",
      };
      if (kind === "login") {
        item = { type: "login", ...base, ...login };
      } else if (kind === "note") {
        item = { type: "note", ...base, ...note };
      } else {
        item = { type: "card", ...base, ...card };
      }
      await api.saveItem(item);
      onSaved?.();
      onClose();
    } catch (e: any) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="toolbar">
        <div>
          <p className="screen-eyebrow">Item · {id === null ? "New" : "Edit"}</p>
          <h2>{title.trim() || (id === null ? "New item" : "Untitled")}</h2>
        </div>
        <div className="actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            <XIcon /> Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div className="kind-tabs" aria-label="Item kind">
        {(["login", "note", "card"] as ItemKind[]).map((k) => (
          <button
            key={k}
            type="button"
            className={kind === k ? "active" : ""}
            onClick={() => setKind(k)}
          >
            {k}
          </button>
        ))}
      </div>

      <div className="fields">
        <div className="field">
          <p className="field-label">Title</p>
          <div className="field-row">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Title"
              autoFocus={id === null}
            />
          </div>
        </div>

        {kind === "login" && (
          <>
            <div className="field">
              <p className="field-label">Login method</p>
              <div className="method-grid" role="radiogroup" aria-label="Login method">
                {methods.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={login.method === m.id}
                    className={`method-option ${login.method === m.id ? "active" : ""}`}
                    onClick={() => setLogin({ ...login, method: m.id })}
                  >
                    <MethodChip method={m.id} size={20} />
                    <span>{m.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <p className="field-label">URL</p>
              <div className="field-row">
                {favicon && (
                  <img
                    src={favicon}
                    alt=""
                    style={{ width: 16, height: 16, marginRight: 8 }}
                  />
                )}
                <input
                  value={login.url}
                  onChange={(e) => setLogin({ ...login, url: e.target.value })}
                  onBlur={handleUrlBlur}
                  aria-label="URL"
                  spellCheck={false}
                  autoComplete="off"
                  inputMode="url"
                  placeholder="https://example.com"
                />
              </div>
            </div>
            {login.method === "credentials" && (
              <>
                <div className="field">
                  <p className="field-label">Username</p>
                  <div className="field-row">
                    <input
                      value={login.username}
                      onChange={(e) => setLogin({ ...login, username: e.target.value })}
                      aria-label="Username"
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </div>
                </div>
                <div className="field">
                  <p className="field-label">Password</p>
                  <div className="copy-row">
                    <div className="field-row">
                      <input
                        className="mono"
                        type={showPassword ? "text" : "password"}
                        value={login.password}
                        onChange={(e) => setLogin({ ...login, password: e.target.value })}
                        aria-label="Password"
                        spellCheck={false}
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        className="reveal"
                        onClick={() => setShowPassword((s) => !s)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        aria-pressed={showPassword}
                        title={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                    <button
                      type="button"
                      className={`copy-inline ${copied === "password" ? "copied" : ""}`}
                      onClick={() => copy("password", login.password)}
                      disabled={!login.password}
                    >
                      {copied === "password" ? <CheckIcon /> : <CopyIcon />}
                      {copied === "password" ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {kind === "note" && (
          <div className="field">
            <p className="field-label">Body</p>
            <div className="field-row">
              <textarea
                rows={8}
                value={note.body}
                onChange={(e) => setNote({ body: e.target.value })}
                aria-label="Note body"
                spellCheck={false}
              />
            </div>
          </div>
        )}

        {kind === "card" && (
          <>
            <div className="field">
              <p className="field-label">Cardholder</p>
              <div className="field-row">
                <input
                  value={card.cardholder}
                  onChange={(e) => setCard({ ...card, cardholder: e.target.value })}
                  aria-label="Cardholder"
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="field">
              <p className="field-label">Number</p>
              <div className="copy-row">
                <div className="field-row">
                  <input
                    className="mono"
                    type="text"
                    value={card.number}
                    onChange={(e) => {
                      const formatted = formatCardNumber(e.target.value);
                      setCard({ ...card, number: formatted });
                    }}
                    aria-label="Card number"
                    spellCheck={false}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="1234-5678-9012-3456"
                    maxLength={19}
                  />
                </div>
                <button
                  type="button"
                  className={`copy-inline ${copied === "number" ? "copied" : ""}`}
                  onClick={() => copy("number", card.number)}
                  disabled={!card.number}
                >
                  {copied === "number" ? <CheckIcon /> : <CopyIcon />}
                  {copied === "number" ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
            <div className="field">
              <p className="field-label">Exp</p>
              <div className="field-row">
                <input
                  className="mono"
                  value={card.exp}
                  onChange={(e) => {
                    const formatted = formatCardExp(e.target.value);
                    setCard({ ...card, exp: formatted });
                  }}
                  aria-label="Card expiration"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="MM/YY"
                  maxLength={5}
                />
              </div>
            </div>
            <div className="field">
              <p className="field-label">CVV</p>
              <div className="copy-row">
                <div className="field-row">
                  <input
                    className="mono"
                    type="password"
                    value={card.cvv}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
                      setCard({ ...card, cvv: digits });
                    }}
                    aria-label="CVV"
                    spellCheck={false}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={4}
                  />
                </div>
                <button
                  type="button"
                  className={`copy-inline ${copied === "cvv" ? "copied" : ""}`}
                  onClick={() => copy("cvv", card.cvv)}
                  disabled={!card.cvv}
                >
                  {copied === "cvv" ? <CheckIcon /> : <CopyIcon />}
                  {copied === "cvv" ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          </>
        )}

        <div className="field">
          <p className="field-label">Notes</p>
          <div className="field-row">
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              aria-label="Notes"
              spellCheck={false}
            />
          </div>
        </div>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}

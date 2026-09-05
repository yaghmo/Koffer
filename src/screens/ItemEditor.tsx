import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Item, ItemKind, LoginFields, NoteFields, CardFields } from "../lib/types";
import { CopyIcon, CheckIcon, EyeIcon, EyeOffIcon, XIcon } from "../components/Icon";

interface Props {
  id: string | null;
  initialKind?: ItemKind;
  onClose: () => void;
  onSaved?: () => void;
}

const emptyLogin = (): LoginFields => ({ url: "", username: "", password: "" });
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

// Card expiration: YYYY-MM (HTML month input) or MM/YY. Empty allowed.
function isValidExp(s: string): boolean {
  if (!s.trim()) return true;
  return /^(\d{4}-\d{2}|\d{2}\/\d{2})$/.test(s.trim());
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

  useEffect(() => {
    if (id === null) return;
    api.getItem(id).then((item) => {
      setKind(item.type);
      setTitle(item.title);
      setNotes(item.notes);
      if (item.type === "login") {
        setLogin({ url: item.url, username: item.username, password: item.password });
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

  async function save() {
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (kind === "login" && !isValidUrl(login.url)) {
      setError("URL must be a valid http(s) link (e.g. https://example.com).");
      return;
    }
    if (kind === "card" && !isValidExp(card.exp)) {
      setError("Card expiration must be YYYY-MM or MM/YY.");
      return;
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
              <p className="field-label">URL</p>
              <div className="field-row">
                <input
                  value={login.url}
                  onChange={(e) => setLogin({ ...login, url: e.target.value })}
                  aria-label="URL"
                  spellCheck={false}
                  autoComplete="off"
                  inputMode="url"
                  placeholder="https://example.com"
                />
              </div>
            </div>
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
                    onChange={(e) => setCard({ ...card, number: e.target.value })}
                    aria-label="Card number"
                    spellCheck={false}
                    inputMode="numeric"
                    autoComplete="off"
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
                  onChange={(e) => setCard({ ...card, exp: e.target.value })}
                  aria-label="Card expiration"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="YYYY-MM"
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
                    onChange={(e) => setCard({ ...card, cvv: e.target.value })}
                    aria-label="CVV"
                    spellCheck={false}
                    inputMode="numeric"
                    autoComplete="off"
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

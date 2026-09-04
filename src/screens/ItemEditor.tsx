import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Item, ItemKind, LoginFields, NoteFields, CardFields } from "../lib/types";
import { CopyIcon, CheckIcon, XIcon } from "../components/Icon";

interface Props {
  id: string | null;
  onClose: () => void;
}

const emptyLogin = (): LoginFields => ({ url: "", username: "", password: "" });
const emptyNote = (): NoteFields => ({ body: "" });
const emptyCard = (): CardFields => ({ cardholder: "", number: "", exp: "", cvv: "" });

export default function ItemEditor({ id, onClose }: Props) {
  const [kind, setKind] = useState<ItemKind>("login");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [login, setLogin] = useState<LoginFields>(emptyLogin());
  const [note, setNote] = useState<NoteFields>(emptyNote());
  const [card, setCard] = useState<CardFields>(emptyCard());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

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
                />
              </div>
            </div>
            <div className="field">
              <p className="field-label">Password</p>
              <div className="copy-row">
                <div className="field-row">
                  <input
                    className="mono"
                    type="text"
                    value={login.password}
                    onChange={(e) => setLogin({ ...login, password: e.target.value })}
                    aria-label="Password"
                    spellCheck={false}
                  />
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
                />
              </div>
            </div>
            <div className="field">
              <p className="field-label">CVV</p>
              <div className="copy-row">
                <div className="field-row">
                  <input
                    className="mono"
                    type="text"
                    value={card.cvv}
                    onChange={(e) => setCard({ ...card, cvv: e.target.value })}
                    aria-label="CVV"
                    spellCheck={false}
                    inputMode="numeric"
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

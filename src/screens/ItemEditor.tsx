import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Item, ItemKind, LoginFields, NoteFields, CardFields } from "../lib/types";

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

  async function copy(text: string) {
    try {
      await api.copyToClipboard(text, 30);
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
        <h2>{id === null ? "New item" : "Edit item"}</h2>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="filters">
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

      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
      </label>

      {kind === "login" && (
        <>
          <label>
            URL
            <input
              value={login.url}
              onChange={(e) => setLogin({ ...login, url: e.target.value })}
              aria-label="URL"
            />
          </label>
          <label>
            Username
            <input
              value={login.username}
              onChange={(e) => setLogin({ ...login, username: e.target.value })}
              aria-label="Username"
            />
          </label>
          <label>
            Password
            <div className="row">
              <input
                type="text"
                value={login.password}
                onChange={(e) => setLogin({ ...login, password: e.target.value })}
                aria-label="Password"
              />
              <button type="button" onClick={() => copy(login.password)}>
                Copy
              </button>
            </div>
          </label>
        </>
      )}

      {kind === "note" && (
        <label>
          Body
          <textarea
            rows={8}
            value={note.body}
            onChange={(e) => setNote({ body: e.target.value })}
            aria-label="Note body"
          />
        </label>
      )}

      {kind === "card" && (
        <>
          <label>
            Cardholder
            <input
              value={card.cardholder}
              onChange={(e) => setCard({ ...card, cardholder: e.target.value })}
              aria-label="Cardholder"
            />
          </label>
          <label>
            Number
            <input
              value={card.number}
              onChange={(e) => setCard({ ...card, number: e.target.value })}
              aria-label="Card number"
            />
          </label>
          <label>
            Exp
            <input
              value={card.exp}
              onChange={(e) => setCard({ ...card, exp: e.target.value })}
              aria-label="Card expiration"
            />
          </label>
          <label>
            CVV
            <div className="row">
              <input
                type="text"
                value={card.cvv}
                onChange={(e) => setCard({ ...card, cvv: e.target.value })}
                aria-label="CVV"
              />
              <button type="button" onClick={() => copy(card.cvv)}>
                Copy
              </button>
            </div>
          </label>
        </>
      )}

      <label>
        Notes
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          aria-label="Notes"
        />
      </label>

      {error && <p className="error">{error}</p>}
    </form>
  );
}

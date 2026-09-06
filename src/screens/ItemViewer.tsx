import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Item } from "../lib/types";
import { CopyIcon, CheckIcon, EyeIcon, EyeOffIcon, PencilIcon, XIcon, TrashIcon, ExternalIcon } from "../components/Icon";
import { methodLabel, MethodChip } from "../lib/methods";

interface Props {
  id: string;
  onEdit: (id: string) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
}

const mask = (s: string) => (s ? "•".repeat(Math.max(8, s.length)) : "—");

function Field({
  label,
  value,
  mono,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onCopy?: () => void;
  copied?: boolean;
}) {
  return (
    <div className="field">
      <p className="field-label">{label}</p>
      <div className="copy-row">
        <div className="field-row">
          <input
            className={mono ? "mono" : undefined}
            value={value || ""}
            readOnly
            spellCheck={false}
            aria-label={label}
          />
        </div>
        {onCopy && (
          <button
            type="button"
            className={`copy-inline ${copied ? "copied" : ""}`}
            onClick={onCopy}
            disabled={!value}
            aria-label={`Copy ${label}`}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    </div>
  );
}

function SecretField({
  label,
  value,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <p className="field-label">{label}</p>
      <div className="copy-row">
        <div className="field-row">
          <input
            className="mono"
            type={show ? "text" : "password"}
            value={show ? value : mask(value)}
            readOnly
            spellCheck={false}
            aria-label={label}
          />
          <button
            type="button"
            className="reveal"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide" : "Show"}
            aria-pressed={show}
            title={show ? "Hide" : "Show"}
          >
            {show ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
        <button
          type="button"
          className={`copy-inline ${copied ? "copied" : ""}`}
          onClick={onCopy}
          disabled={!value}
          aria-label={`Copy ${label}`}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export default function ItemViewer({ id, onEdit, onClose, onDelete }: Props) {
  const [item, setItem] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setItem(null);
    setError(null);
    api
      .getItem(id)
      .then((it) => setItem(it))
      .catch((err) => setError(String(err)));
  }, [id]);

  async function copy(label: string, text: string) {
    if (!text) return;
    try {
      await api.copyToClipboard(text, 30);
      setCopied(label);
      window.setTimeout(
        () => setCopied((c) => (c === label ? null : c)),
        1400
      );
    } catch {
      // ignore
    }
  }

  if (error) {
    return (
      <div className="editor">
        <div className="toolbar">
          <div>
            <p className="screen-eyebrow">Item</p>
            <h2>Could not load</h2>
          </div>
          <div className="actions">
            <button type="button" className="btn-ghost" onClick={onClose}>
              <XIcon /> Close
            </button>
          </div>
        </div>
        <p className="error" role="alert">{error}</p>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="editor">
        <div className="toolbar">
          <div>
            <p className="screen-eyebrow">Item</p>
            <h2>Loading…</h2>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="editor">
      <div className="toolbar">
        <div>
          <p className="screen-eyebrow">Item · {item.type}</p>
          <h2>{item.title || "Untitled"}</h2>
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              if (confirm(`Delete "${item.title}"?`)) onDelete(item.id);
            }}
            aria-label="Delete item"
            title="Delete"
          >
            <TrashIcon />
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            <XIcon /> Close
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onEdit(item.id)}
            aria-label="Edit item"
          >
            <PencilIcon /> Edit
          </button>
          {item.type === "login" && item.url && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => api.openLoginItem(item.id).catch(() => {})}
              aria-label="Open in browser"
            >
              <ExternalIcon /> Open
            </button>
          )}
        </div>
      </div>

      <div className="fields">
        <Field label="Title" value={item.title} />
        {item.type === "login" && (
          <>
            <div className="field">
              <p className="field-label">Login method</p>
              <div className="method-static">
                <MethodChip method={item.method || "credentials"} size={22} />
                <span>{methodLabel(item.method || "credentials")}</span>
              </div>
            </div>
            <Field
              label="URL"
              value={item.url}
              mono
              onCopy={() => copy("url", item.url)}
              copied={copied === "url"}
            />
            {item.method === "credentials" ? (
              <>
                <Field
                  label="Username"
                  value={item.username}
                  onCopy={() => copy("username", item.username)}
                  copied={copied === "username"}
                />
                <SecretField
                  label="Password"
                  value={item.password}
                  onCopy={() => copy("password", item.password)}
                  copied={copied === "password"}
                />
              </>
            ) : item.username ? (
              <>
                <Field
                  label="Account"
                  value={item.username}
                  onCopy={() => copy("username", item.username)}
                  copied={copied === "username"}
                />
                {item.password && (
                  <SecretField
                    label="Password"
                    value={item.password}
                    onCopy={() => copy("password", item.password)}
                    copied={copied === "password"}
                  />
                )}
              </>
            ) : null}
          </>
        )}
        {item.type === "note" && (
          <Field label="Body" value={item.body} />
        )}
        {item.type === "card" && (
          <>
            <Field
              label="Cardholder"
              value={item.cardholder}
              onCopy={() => copy("cardholder", item.cardholder)}
              copied={copied === "cardholder"}
            />
            <SecretField
              label="Number"
              value={item.number}
              onCopy={() => copy("number", item.number)}
              copied={copied === "number"}
            />
            <Field
              label="Exp"
              value={item.exp}
              onCopy={() => copy("exp", item.exp)}
              copied={copied === "exp"}
            />
            <SecretField
              label="CVV"
              value={item.cvv}
              onCopy={() => copy("cvv", item.cvv)}
              copied={copied === "cvv"}
            />
          </>
        )}
        {item.notes && <Field label="Notes" value={item.notes} />}
      </div>
    </div>
  );
}

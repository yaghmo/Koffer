import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Item } from "../lib/types";
import { CopyIcon, CheckIcon, EyeIcon, EyeOffIcon, PencilIcon, XIcon, TrashIcon, ExternalIcon } from "../components/Icon";
import { methodLabel, MethodChip } from "../lib/methods";
import { useHotkey } from "../lib/useHotkey";

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
    <div className="flex flex-col gap-1.5">
      <p className="label-md">{label}</p>
      <div className="flex items-center gap-2">
        <input
          className={`field flex-1 ${mono ? "font-mono" : ""}`}
          value={value || ""}
          readOnly
          spellCheck={false}
          aria-label={label}
        />
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
            disabled={!value}
            aria-label={`Copy ${label}`}
            className={`btn-secondary ${copied ? "!border-secondary !text-secondary" : ""}`}
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
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
    <div className="flex flex-col gap-1.5">
      <p className="label-md">{label}</p>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            className="field w-full pr-10 font-mono"
            type={show ? "text" : "password"}
            value={show ? value : mask(value)}
            readOnly
            spellCheck={false}
            aria-label={label}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide" : "Show"}
            aria-pressed={show}
            title={show ? "Hide" : "Show"}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-outline transition-colors duration-150 ease-out hover:text-on-surface"
          >
            {show ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
          </button>
        </div>
        <button
          type="button"
          onClick={onCopy}
          disabled={!value}
          aria-label={`Copy ${label}`}
          className={`btn-secondary ${copied ? "!border-secondary !text-secondary" : ""}`}
        >
          {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
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

  useHotkey("escape", onClose);

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

  if (error) {
    return (
      <div className="dialog flex h-full w-[480px] flex-col gap-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-headline-sm text-on-surface">Could not load</h2>
          <button type="button" onClick={onClose} className="btn-secondary" aria-label="Close">
            <XIcon size={14} />
          </button>
        </div>
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="dialog flex h-full w-[480px] flex-col gap-4 p-6">
        <h2 className="text-headline-sm text-on-surface">Loading…</h2>
      </div>
    );
  }

  return (
    <div role="dialog" aria-modal="true" className="dialog flex h-full w-[480px] flex-col gap-6 overflow-y-auto p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="label-sm">{item.type}</span>
          <h2 className="truncate text-headline-sm text-on-surface">{item.title || "Untitled"}</h2>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {item.type === "login" && item.url && (
            <button
              type="button"
              onClick={() => api.openLoginItem(item.id).catch(() => {})}
              aria-label="Open in browser"
              className="btn-primary"
            >
              <ExternalIcon size={14} /> Open
            </button>
          )}
          <button type="button" onClick={() => onEdit(item.id)} aria-label="Edit item" className="btn-secondary">
            <PencilIcon size={14} /> Edit item
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm(`Delete "${item.title}"?`)) onDelete(item.id);
            }}
            aria-label="Delete item"
            className="rounded-control p-2 text-error transition-colors duration-150 ease-out hover:bg-error/12"
          >
            <TrashIcon size={14} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-control p-2 text-on-surface-variant transition-colors duration-150 ease-out hover:bg-white/4 hover:text-on-surface"
          >
            <XIcon size={14} />
          </button>
        </div>
      </div>

      <div className="card flex flex-col gap-4 p-4">
        <Field label="Title" value={item.title} />
        {item.type === "login" && (
          <>
            <div className="flex flex-col gap-1.5">
              <p className="label-md">Login method</p>
              <div className="flex items-center gap-2 text-on-surface">
                <MethodChip method={item.method || "credentials"} size={22} />
                <span>{methodLabel(item.method || "credentials")}</span>
              </div>
            </div>
            <Field label="URL" value={item.url} mono onCopy={() => copy("url", item.url)} copied={copied === "url"} />
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
        {item.type === "note" && <Field label="Body" value={item.body} />}
        {item.type === "card" && (
          <>
            <Field
              label="Cardholder"
              value={item.cardholder}
              onCopy={() => copy("cardholder", item.cardholder)}
              copied={copied === "cardholder"}
            />
            <SecretField label="Number" value={item.number} onCopy={() => copy("number", item.number)} copied={copied === "number"} />
            <Field label="Exp" value={item.exp} onCopy={() => copy("exp", item.exp)} copied={copied === "exp"} />
            <SecretField label="CVV" value={item.cvv} onCopy={() => copy("cvv", item.cvv)} copied={copied === "cvv"} />
          </>
        )}
      </div>
      {item.notes && (
        <div className="card p-4">
          <Field label="Notes" value={item.notes} />
        </div>
      )}
    </div>
  );
}

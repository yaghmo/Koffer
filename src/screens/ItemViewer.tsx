import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { onItemsChanged } from "../lib/events";
import type { Item, TotpCode } from "../lib/types";
import { CopyIcon, CheckIcon, EyeIcon, EyeOffIcon, PencilIcon, XIcon, TrashIcon, ExternalIcon, CardBrandIcon, NoteIcon } from "../components/Icon";
import { methodLabel, MethodChip } from "../lib/methods";
import { useHotkey } from "../lib/useHotkey";
import ConfirmDialog from "../components/ConfirmDialog";
import Markdown from "../components/Markdown";

interface Props {
  id: string;
  onEdit: (id: string) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
}

const mask = (s: string) => (s ? "•".repeat(Math.max(8, s.length)) : "None");

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
    <div className="flex flex-col gap-1">
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
            className={`btn-secondary ${copied ? "!border-on-surface" : ""}`}
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
    <div className="flex flex-col gap-1">
      <p className="label-md">{label}</p>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            className="field w-full pr-8 font-mono"
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
          className={`btn-secondary ${copied ? "!border-on-surface" : ""}`}
        >
          {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/**
 * The current authenticator code. Asked of the app once a second rather than
 * worked out here, so the key never has to be decoded in the webview.
 */
function TotpField({ id, onCopy, copied }: { id: string; onCopy: (code: string) => void; copied: boolean }) {
  const [totp, setTotp] = useState<TotpCode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const tick = () =>
      api
        .totpCode(id)
        .then((t) => live && (setTotp(t), setError(null)))
        .catch((e) => live && setError(String(e)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [id]);

  if (error) {
    return (
      <div className="flex flex-col gap-1">
        <p className="label-md">2FA code</p>
        <p role="alert" className="text-body-sm text-error">{error}</p>
      </div>
    );
  }
  // Split in half so it reads like the phone apps show it: "123 456".
  const shown = totp ? totp.code.replace(/^(\d{3,4})(\d{3,4})$/, "$1 $2") : "";
  return (
    <div className="flex flex-col gap-1">
      <p className="label-md">2FA code</p>
      <div className="flex items-center gap-2">
        <input className="field flex-1 font-mono tracking-widest" value={shown} readOnly aria-label="2FA code" />
        <span
          className={`w-8 text-right font-mono text-body-sm ${totp && totp.seconds_left <= 5 ? "text-error" : "text-on-surface-variant"}`}
          aria-label={totp ? `${totp.seconds_left} seconds left` : undefined}
        >
          {totp ? `${totp.seconds_left}s` : ""}
        </span>
        <button
          type="button"
          onClick={() => totp && onCopy(totp.code)}
          disabled={!totp}
          aria-label="Copy 2FA code"
          className={`btn-secondary ${copied ? "!border-on-surface" : ""}`}
        >
          {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

const dateOf = (secs: number) => new Date(secs * 1000).toLocaleDateString();

/**
 * A browser login last worked with a password that is not the saved one,
 * and the user did not update. The saved one may be stale.
 */
function LastSeenBanner({
  id,
  seen,
  onChanged,
}: {
  id: string;
  seen: { password: string; seen_at: number };
  onChanged: () => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div
      role="status"
      aria-label="Password may be out of date"
      className="flex flex-col gap-2 rounded-control border border-outline-variant p-3"
    >
      <p className="flex items-start gap-2 text-body-sm text-on-surface">
        <span className="flag">Out of date</span>
        <span>Your last successful login ({dateOf(seen.seen_at)}) used a different password.</span>
      </p>
      {shown && <p className="font-mono text-body-sm text-on-surface">{seen.password}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => setShown((s) => !s)}>
          {shown ? "Hide" : "Reveal"}
        </button>
        <button type="button" className="btn-secondary" onClick={() => api.useLastSeen(id).then(onChanged)}>
          Use this one
        </button>
        <button type="button" className="btn-secondary" onClick={() => api.dismissLastSeen(id).then(onChanged)}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

/** Replaced passwords, collapsed by default: rarely needed, never lost. */
function PreviousPasswords({
  id,
  previous,
  onChanged,
  onCopy,
}: {
  id: string;
  previous: { password: string; replaced_at: number }[];
  onChanged: () => void;
  onCopy: (label: string, text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState<number | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className="link self-start"
        onClick={() => setOpen((o) => !o)}
      >
        Previous passwords ({previous.length})
      </button>
      {open && (
        <ul aria-label="Previous passwords" className="flex flex-col gap-1">
          {previous.map((p, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="w-24 text-body-sm text-on-surface-variant">{dateOf(p.replaced_at)}</span>
              <span className="flex-1 truncate font-mono text-body-sm">
                {revealed === i ? p.password : mask(p.password)}
              </span>
              <button type="button" className="btn-secondary" onClick={() => setRevealed(revealed === i ? null : i)}>
                {revealed === i ? "Hide" : "Reveal"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => onCopy(`prev-${i}`, p.password)}>
                Copy
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => api.restorePreviousPassword(id, i).then(onChanged)}
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ItemViewer({ id, onEdit, onClose, onDelete }: Props) {
  const [item, setItem] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const reload = () =>
    api
      .getItem(id)
      .then((it) => setItem(it))
      .catch((err) => setError(String(err)));

  useEffect(() => {
    setItem(null);
    setError(null);
    reload();
    // The browser extension can update this login while it is on screen.
    const unlisten = onItemsChanged(() => reload());
    return () => {
      unlisten.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <div className="dialog sheet flex h-full w-[480px] flex-col gap-4 p-6">
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
      <div className="dialog sheet flex h-full w-[480px] flex-col gap-4 p-6">
        <h2 className="text-headline-sm text-on-surface">Loading…</h2>
      </div>
    );
  }

  return (
    <>
    <div role="dialog" aria-modal="true" className="dialog sheet flex h-full w-[480px] flex-col gap-6 overflow-y-auto p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {item.type === "card" && <CardBrandIcon bin={item.number} size={32} />}
          {item.type === "note" && (
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-control bg-surface-container-high text-on-surface-variant">
              <NoteIcon size={16} />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="truncate text-headline-sm text-on-surface">{item.title || "Untitled"}</h2>
            <p className="label-md capitalize">{item.type}</p>
          </div>
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
            onClick={() => setConfirmingDelete(true)}
            aria-label="Delete item"
            className="rounded-control p-2 text-error transition-colors duration-150 ease-out hover:bg-surface-container-high"
          >
            <TrashIcon size={14} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-control p-2 text-on-surface-variant transition-colors duration-150 ease-out hover:bg-surface-container-high hover:text-on-surface"
          >
            <XIcon size={14} />
          </button>
        </div>
      </div>

      <div className="card flex flex-col gap-4 p-4">
        <Field label="Title" value={item.title} />
        {item.type === "login" && (
          <>
            <div className="flex flex-col gap-1">
              <p className="label-md">Login method</p>
              <div className="flex items-center gap-2 text-on-surface">
                <MethodChip method={item.method || "credentials"} size={22} />
                <span>{methodLabel(item.method || "credentials")}</span>
              </div>
            </div>
            <Field label="URL" value={item.url} mono onCopy={() => copy("url", item.url)} copied={copied === "url"} />
            {item.last_seen && item.last_seen.password !== item.password && (
              <LastSeenBanner id={item.id} seen={item.last_seen} onChanged={reload} />
            )}
            {item.method === "credentials" ? (
              <>
                <Field
                  label="Username"
                  value={item.username}
                  onCopy={() => copy("username", item.username)}
                  copied={copied === "username"}
                />
                {/* Only when there is one: most logins sign in by username,
                    and an empty row for every one of them is noise. */}
                {item.phone && (
                  <Field
                    label="Phone"
                    value={item.phone}
                    mono
                    onCopy={() => copy("phone", item.phone)}
                    copied={copied === "phone"}
                  />
                )}
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
            {item.totp && (
              <TotpField id={item.id} onCopy={(code) => copy("totp", code)} copied={copied === "totp"} />
            )}
            {item.previous_passwords && item.previous_passwords.length > 0 && (
              <PreviousPasswords
                id={item.id}
                previous={item.previous_passwords}
                onChanged={reload}
                onCopy={copy}
              />
            )}
          </>
        )}
        {item.type === "note" && (
          <div className="flex flex-col gap-1">
            <p className="label-md">Body</p>
            <div className="rounded-control border border-outline-variant bg-surface-container-lowest p-3">
              <Markdown source={item.body} />
            </div>
          </div>
        )}
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
          <div className="flex flex-col gap-1">
            <p className="label-md">Comments</p>
            <p className="whitespace-pre-wrap rounded-control border border-outline-variant bg-surface-container-lowest p-3 text-body-md text-on-surface-variant">
              {item.notes}
            </p>
          </div>
        </div>
      )}
    </div>
    {confirmingDelete && (
      <ConfirmDialog
        title="Delete item"
        message={`Delete "${item.title}"? This can't be undone.`}
        typeToConfirm="Delete"
        confirmLabel={`Delete ${item.type}`}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => {
          setConfirmingDelete(false);
          onDelete(item.id);
        }}
      />
    )}
    </>
  );
}

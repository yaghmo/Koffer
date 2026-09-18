import { useState } from "react";
import { api } from "../lib/api";
import { CheckIcon, CopyIcon, ShieldIcon } from "./Icon";

/**
 * Shows a freshly minted recovery code — once.
 *
 * Only the wrapped key is stored, never the code, so this dialog is the only
 * time it exists anywhere outside the user's notes. The acknowledgement
 * checkbox is the point: it is very easy to close this and assume it can be
 * found again later.
 */
export default function RecoveryCodeDialog({
  code,
  onDone,
}: {
  code: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  async function copy() {
    try {
      await api.copyToClipboard(code, 60);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard busy — the code is on screen either way
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Recovery code"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-5"
    >
      <div className="dialog flex w-full max-w-[520px] flex-col gap-4 p-6">
        <div className="flex items-center gap-2.5">
          <ShieldIcon size={18} />
          <div>
            <p className="label-sm text-secondary">Write this down</p>
            <h2 className="text-headline-sm text-on-surface">Your recovery code</h2>
          </div>
        </div>

        <p className="text-body-sm text-on-surface-variant">
          This is the only way back into your vault if you forget the master password. It is shown
          once and cannot be recovered — store it on paper, somewhere away from this computer.
        </p>

        <p
          className="select-all rounded-control border border-primary/30 bg-surface-container-lowest px-4 py-4 text-center font-mono text-body-lg tracking-widest text-on-surface"
          aria-label="Recovery code"
        >
          {code}
        </p>

        <div className="rounded-control border border-warning/30 bg-warning/10 px-3 py-2">
          <p className="text-body-sm text-warning">
            Anyone holding this code and a copy of your vault file can open it. Treat it like the
            master password itself.
          </p>
        </div>

        <button type="button" className="btn-secondary self-start" onClick={copy}>
          {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          {copied ? "Copied — clears in 60s" : "Copy to clipboard"}
        </button>

        <label className="flex items-start gap-2 text-body-sm text-on-surface">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          I have written this code down somewhere safe.
        </label>

        <button type="button" className="btn-primary self-end" onClick={onDone} disabled={!acknowledged}>
          Done
        </button>
      </div>
    </div>
  );
}

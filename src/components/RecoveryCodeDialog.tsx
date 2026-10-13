import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/api";
import { CheckIcon, CopyIcon, ShieldIcon } from "./Icon";

/**
 * The code as the recovery screen will read it: case, spaces and dashes do
 * not count, and I/L and O are the 1 and 0 they are mistaken for (Crockford
 * base32, the same rule `recovery.rs` decodes with).
 */
function normalize(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
}

/**
 * Shows a freshly minted recovery code — once.
 *
 * Only the wrapped key is stored, never the code, so this dialog is the only
 * time it exists anywhere outside the user's notes. So it does not close
 * until the code has been typed back: it is very easy to close this and
 * assume it can be found again later, and a tick box proved nothing.
 */
export default function RecoveryCodeDialog({
  code,
  onDone,
}: {
  code: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const matches = normalize(typed) === normalize(code);
  const wrong = normalize(typed).length >= normalize(code).length && !matches;

  async function copy() {
    try {
      await api.copyToClipboard(code, 60);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard busy — the code is on screen either way
    }
  }

  async function saveTxt() {
    setSaveError(null);
    try {
      const dest = await save({
        defaultPath: "recovery-code.txt",
        filters: [{ name: "Text", extensions: ["txt"] }],
      });
      if (!dest) return;
      await api.saveRecoveryCode(dest, code);
      setSaved(dest);
    } catch (e) {
      setSaveError(String(e));
    }
  }

  if (confirming) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Confirm recovery code"
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-6"
      >
        <div className="dialog flex w-full max-w-[520px] flex-col gap-4 p-6">
          <div className="flex items-center gap-2">
            <ShieldIcon size={18} />
            <div>
              <h2 className="text-headline-sm text-on-surface">Type your recovery code</h2>
            </div>
          </div>
          <p className="text-body-sm text-on-surface-variant">
            From wherever you saved it, not from memory. If you can read it back now, you can read it
            back the day you need it.
          </p>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-label="Type your recovery code"
            spellCheck={false}
            autoComplete="off"
            autoFocus
            className="field text-center font-mono tracking-widest"
          />
          {wrong && (
            <p role="alert" className="text-body-sm text-error">
              That doesn't match. Check what you saved against the code.
            </p>
          )}
          <div className="flex items-center justify-between">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setTyped("");
                setConfirming(false);
              }}
            >
              Show the code again
            </button>
            <button type="button" className="btn-primary" onClick={onDone} disabled={!matches}>
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Recovery code"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-6"
    >
      <div className="dialog flex w-full max-w-[520px] flex-col gap-4 p-6">
        <div className="flex items-center gap-2">
          <ShieldIcon size={18} />
          <div>
            <h2 className="text-headline-sm text-on-surface">Your recovery code</h2>
          </div>
        </div>

        <p className="text-body-sm text-on-surface-variant">
          This is the only way back into your vault if you forget the master password. It is shown
          once and cannot be recovered. Store it on paper, somewhere away from this computer.
        </p>

        <p
          className="select-all rounded-control border border-outline-variant px-4 py-4 text-center font-mono text-body-lg tracking-widest text-on-surface"
          aria-label="Recovery code"
        >
          {code}
        </p>

        <p className="flex items-start gap-2 text-body-sm text-on-surface">
          <span className="flag">Shown once</span>
          <span>
            Anyone holding this code and a copy of your vault file can open it. Treat it like the
            master password itself.
          </span>
        </p>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={copy}>
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            {copied ? "Copied. Clears in 60 seconds." : "Copy to clipboard"}
          </button>
          <button type="button" className="btn-secondary" onClick={saveTxt}>
            {saved ? <CheckIcon size={14} /> : null}
            {saved ? "Saved" : "Save as .txt"}
          </button>
        </div>

        {saved && (
          <p role="status" className="flex items-start gap-2 text-body-sm text-on-surface">
            <span className="flag">Plain text</span>
            <span>
              Saved to {saved}. A file next to your vault is only as safe as this computer: print it
              or move it to a USB stick, then delete it here.
            </span>
          </p>
        )}
        {saveError && (
          <p role="alert" className="text-body-sm text-error">
            Could not save: {saveError}
          </p>
        )}

        <button type="button" className="btn-primary self-end" onClick={() => setConfirming(true)}>
          Next
        </button>
      </div>
    </div>
  );
}

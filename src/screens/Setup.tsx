import { useState } from "react";
import { api } from "../lib/api";
import type { Account } from "../lib/types";
import { EyeIcon, EyeOffIcon, PlusIcon, XIcon } from "../components/Icon";
import { Emblem } from "../components/Emblem";
import { passwordStrength } from "../lib/passwordStrength";
import RecoveryCodeDialog from "../components/RecoveryCodeDialog";

interface Props {
  onCreated: (account: Account) => void;
  /** Back out of vault creation — without it this screen is a dead end. */
  onCancel: () => void;
}

function StrengthMeter({ password }: { password: string }) {
  const s = passwordStrength(password);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="label-md">Strength</span>
        <span className={`label-md ${s.className}`}>{s.label}</span>
      </div>
      <div className="flex gap-1" role="img" aria-label={`Password strength: ${s.label}`}>
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={`h-1 flex-1 rounded-full transition-colors duration-150 ease-out ${
              password && step <= s.score
                ? s.score >= 3
                  ? "bg-secondary"
                  : s.score === 2
                    ? "bg-tertiary"
                    : "bg-error"
                : "bg-surface-container-high"
            }`}
          />
        ))}
      </div>
      {s.hint && <p className="text-body-sm text-on-surface-variant">{s.hint}</p>}
    </div>
  );
}

export default function Setup({ onCreated, onCancel }: Props) {
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Held until the code has been acknowledged, so the vault is never handed
  // over before its only recovery path has been seen.
  const [pending, setPending] = useState<{ account: Account; code: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Display name is required.");
      return;
    }
    if (pw.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (pw !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const account = await api.setupVault(pw, trimmedName);
      let code = "";
      try {
        code = await api.createRecoveryCode(pw);
      } catch {
        // A vault without a recovery code is still a usable vault; Settings
        // can mint one later rather than failing the whole creation here.
      }
      if (code) setPending({ account, code });
      else onCreated(account);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (pending) {
    return (
      <RecoveryCodeDialog code={pending.code} onDone={() => onCreated(pending.account)} />
    );
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 p-5">
      <div className="card flex w-full max-w-[440px] flex-col items-center gap-6 p-8">
        <Emblem size={56} />
        <p className="label-sm text-secondary">New vault</p>

        <form onSubmit={submit} className="flex w-full flex-col gap-4">
          <p className="rounded-control border border-warning/30 bg-warning/10 px-3 py-2 text-body-sm text-warning">
            We can't recover this password if you forget it.
          </p>

          <div className="flex flex-col gap-1.5">
            <p className="label-md">Display name</p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              aria-label="Display name"
              spellCheck={false}
              maxLength={40}
              className="field"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="label-md">Master password</p>
            <div className="relative flex items-center">
              <input
                type={show ? "text" : "password"}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                aria-label="Master password"
                spellCheck={false}
                autoComplete="new-password"
                className="field pr-10 font-mono"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? "Hide password" : "Show password"}
                aria-pressed={show}
                title={show ? "Hide password" : "Show password"}
                className="absolute right-2 text-outline transition-colors duration-150 ease-out hover:text-on-surface"
              >
                {show ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
              </button>
            </div>
          </div>

          <StrengthMeter password={pw} />

          <div className="flex flex-col gap-1.5">
            <p className="label-md">Confirm</p>
            <input
              type={show ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-label="Confirm master password"
              spellCheck={false}
              autoComplete="new-password"
              className="field font-mono"
            />
          </div>

          {error && (
            <p role="alert" className="text-body-sm text-error">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy || !name || !pw || !confirm}>
            <PlusIcon size={16} />
            {busy ? "Creating…" : "Create vault"}
          </button>
          <button type="button" className="btn-secondary w-full" onClick={onCancel} disabled={busy}>
            <XIcon size={14} /> Cancel
          </button>
        </form>
      </div>
    </div>
  );
}

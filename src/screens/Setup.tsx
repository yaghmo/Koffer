import { useState } from "react";
import { api } from "../lib/api";
import type { Account } from "../lib/types";
import { EyeIcon, EyeOffIcon, PlusIcon } from "../components/Icon";
import { Emblem } from "../components/Emblem";

interface Props {
  onCreated: (account: Account) => void;
}

export default function Setup({ onCreated }: Props) {
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      onCreated(account);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 p-5">
      <div className="card flex w-full max-w-[440px] flex-col items-center gap-6 p-8">
        <Emblem size={56} glow />
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
        </form>
      </div>
    </div>
  );
}

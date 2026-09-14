import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Account } from "../lib/types";
import { EyeIcon, EyeOffIcon, PlusIcon, LockIcon, UnlockIcon } from "../components/Icon";
import { Emblem } from "../components/Emblem";

interface Props {
  accounts: Account[];
  onUnlocked: (account: Account) => void;
  onAddNew: () => void;
}

export default function AccountLock({ accounts, onUnlocked, onAddNew }: Props) {
  const [selectedId, setSelectedId] = useState<string>(accounts[0]?.id ?? "");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // After a delete (or any account list change), drop a selection that no
  // longer exists and reset the form. Without this the deleted vault keeps
  // showing as "selected" until the user picks another one.
  useEffect(() => {
    if (selectedId && !accounts.some((a) => a.id === selectedId)) {
      setSelectedId(accounts[0]?.id ?? "");
      setPw("");
      setError(null);
    }
  }, [accounts, selectedId]);

  const selected = accounts.find((a) => a.id === selectedId);

  function pickAccount(id: string) {
    setSelectedId(id);
    setPw("");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setError(null);
    setBusy(true);
    try {
      await api.unlockVault(pw, selected.id);
      onUnlocked(selected);
    } catch {
      setError("Wrong password. Try again.");
      setPw("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 p-5">
      <div className="card flex w-full max-w-[440px] flex-col items-center gap-6 p-8">
        <Emblem size={56} glow />
        <p className="label-sm flex items-center gap-2 text-secondary">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-secondary" aria-hidden />
          Locked
        </p>

        {!selected ? (
          <div className="flex w-full flex-col items-center gap-4 text-center">
            <p className="text-body-md text-on-surface-variant">No vaults exist on this device.</p>
            <button type="button" className="btn-primary w-full" onClick={onAddNew}>
              <PlusIcon size={16} /> Create one
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex w-full flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <p className="label-md">{accounts.length > 1 ? "Choose a vault" : "Vault"}</p>
              <ul className="flex flex-col gap-1 rounded-control border border-white/8 bg-surface p-1">
                {accounts.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => pickAccount(a.id)}
                      className={`flex w-full flex-col gap-0.5 rounded-[6px] px-3 py-2 text-left transition-colors duration-150 ease-out ${
                        a.id === selectedId ? "bg-surface-container-high" : "hover:bg-white/4"
                      }`}
                    >
                      <span className="text-body-md font-medium text-on-surface">{a.name}</span>
                      {a.id === selectedId && <span className="label-md">Local vault · this device</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-1.5">
              <p className="label-md">Master password</p>
              <div className="relative flex items-center">
                <LockIcon size={16} className="pointer-events-none absolute left-3 text-outline" />
                <input
                  type={show ? "text" : "password"}
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  autoFocus
                  aria-label="Master password"
                  spellCheck={false}
                  autoComplete="off"
                  className="field pl-9 pr-10 font-mono"
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
              {error && (
                <p role="alert" className="text-body-sm text-error">
                  {error}
                </p>
              )}
            </div>

            <button type="submit" className="btn-primary w-full" disabled={busy || !pw}>
              <UnlockIcon size={16} />
              {busy ? "Unlocking…" : "Unlock"}
            </button>

            <button
              type="button"
              onClick={onAddNew}
              disabled={busy}
              className="self-center text-body-sm font-medium text-on-surface-variant underline decoration-outline-variant underline-offset-4 transition-colors duration-150 ease-out hover:text-primary hover:decoration-primary disabled:opacity-50"
            >
              <PlusIcon size={14} className="mr-1 inline align-[-2px]" /> Add another vault
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

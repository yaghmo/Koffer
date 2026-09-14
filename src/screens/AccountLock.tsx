import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Account } from "../lib/types";
import { EyeIcon, EyeOffIcon, PlusIcon, LockIcon, UnlockIcon } from "../components/Icon";
import { Emblem } from "../components/Emblem";
import { useHotkey } from "../lib/useHotkey";
import { useOutsideClose } from "../lib/useOutsideClose";

const CRYPTO_BADGES = ["ARGON2ID", "AES-256-GCM", "LOCAL · AIR-GAPPED"];

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
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  useHotkey("escape", () => setSwitcherOpen(false), switcherOpen);
  useOutsideClose(switcherRef, switcherOpen, () => setSwitcherOpen(false));

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
    setSwitcherOpen(false);
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
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {CRYPTO_BADGES.map((b) => (
            <span key={b} className="label-sm rounded-chip border border-white/8 px-2 py-1 text-tertiary">
              {b}
            </span>
          ))}
        </div>

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
              <p className="label-md">Vault</p>
              <div className="relative" ref={switcherRef}>
                <div className="flex items-center justify-between gap-3 rounded-control border border-white/8 bg-surface px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-body-md font-medium text-on-surface">{selected.name}</p>
                    <p className="label-md">Local vault · this device</p>
                  </div>
                  {accounts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setSwitcherOpen((o) => !o)}
                      aria-haspopup="menu"
                      aria-expanded={switcherOpen}
                      className="btn-secondary shrink-0"
                    >
                      Switch
                    </button>
                  )}
                </div>
                {switcherOpen && (
                  <div
                    role="menu"
                    className="absolute left-0 top-full z-20 mt-1 flex w-full flex-col overflow-hidden rounded-control border border-white/8 bg-surface shadow-lg"
                  >
                    {accounts
                      .filter((a) => a.id !== selectedId)
                      .map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          role="menuitem"
                          onClick={() => pickAccount(a.id)}
                          className="px-3 py-2 text-left text-body-sm text-on-surface transition-colors duration-150 ease-out hover:bg-white/4"
                        >
                          {a.name}
                        </button>
                      ))}
                  </div>
                )}
              </div>
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

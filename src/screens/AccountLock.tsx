import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Account } from "../lib/types";
import { EyeIcon, EyeOffIcon, PlusIcon, UnlockIcon } from "../components/Icon";

interface Props {
  accounts: Account[];
  onUnlocked: (account: Account) => void;
  onAddNew: () => void;
}

export default function AccountLock({ accounts, onUnlocked, onAddNew }: Props) {
  const [selectedId, setSelectedId] = useState<string>(
    accounts[0]?.id ?? ""
  );
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

  if (!selected) {
    return (
      <div className="stage">
        <div className="screen-eyebrow">No accounts</div>
        <div className="stage-frame">
          <p className="hint">No vaults exist on this device.</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onAddNew}
          >
            <PlusIcon /> Create one
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stage">
      <div className="screen-eyebrow">Vault · Locked</div>
      <form onSubmit={submit} className="lock">
        <div className="stage-frame">
          <div className="safelight" aria-hidden />

          <div className="account-picker">
            <p className="label">
              {accounts.length > 1 ? "Choose a vault" : "Vault"}
            </p>
            <div className="account-list">
              {accounts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`account-row ${a.id === selectedId ? "active" : ""}`}
                  onClick={() => pickAccount(a.id)}
                >
                  <span className="account-name">{a.name}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="label">Master password · {selected.name}</p>
          <div className="field-row">
            <input
              type={show ? "text" : "password"}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoFocus
              aria-label="Master password"
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              className="reveal"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? "Hide password" : "Show password"}
              aria-pressed={show}
              title={show ? "Hide password" : "Show password"}
            >
              {show ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !pw}
          >
            <UnlockIcon />
            {busy ? "Unlocking…" : "Unlock"}
          </button>

          <button
            type="button"
            className="link"
            onClick={onAddNew}
            disabled={busy}
          >
            <PlusIcon /> Add another vault
          </button>
        </div>
      </form>
    </div>
  );
}

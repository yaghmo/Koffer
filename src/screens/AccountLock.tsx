import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Account } from "../lib/types";
import { EyeIcon, EyeOffIcon, PlusIcon, UnlockIcon, XIcon } from "../components/Icon";

interface Props {
  accounts: Account[];
  onUnlocked: (account: Account) => void;
  onReset: (accountId: string) => void;
  onAddNew: () => void;
}

type ResetStep = "idle" | "warn1" | "warn2" | "confirm";

export default function AccountLock({ accounts, onUnlocked, onReset, onAddNew }: Props) {
  const [selectedId, setSelectedId] = useState<string>(
    accounts[0]?.id ?? ""
  );

  // After a delete (or any account list change), drop a selection that no
  // longer exists and reset the form. Without this the deleted vault keeps
  // showing as "selected" until the user picks another one.
  useEffect(() => {
    if (selectedId && !accounts.some((a) => a.id === selectedId)) {
      setSelectedId(accounts[0]?.id ?? "");
      setPw("");
      setError(null);
      cancelReset();
    }
  }, [accounts, selectedId]);

  const selected = accounts.find((a) => a.id === selectedId);

  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset-flow state, scoped to the currently selected account.
  const [step, setStep] = useState<ResetStep>("idle");
  const [confirmPw, setConfirmPw] = useState("");
  const [confirmShow, setConfirmShow] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  function pickAccount(id: string) {
    setSelectedId(id);
    setPw("");
    setError(null);
    cancelReset();
  }

  function openReset() {
    setError(null);
    setStep("warn1");
  }

  function cancelReset() {
    setStep("idle");
    setConfirmPw("");
    setConfirmError(null);
    setConfirmShow(false);
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

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setConfirmError(null);
    setConfirmBusy(true);
    try {
      await api.resetVault(confirmPw, selected.id);
      cancelReset();
      onReset(selected.id);
    } catch {
      setConfirmError("Wrong password. Try again.");
      setConfirmPw("");
    } finally {
      setConfirmBusy(false);
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
    <>
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

            {selected ? (
              <>
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
                  onClick={openReset}
                  disabled={busy}
                >
                  Forgot password / reset this vault
                </button>
              </>
            ) : (
              <p className="hint">Pick a vault above to continue.</p>
            )}

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

      {step === "warn1" && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal modal-danger">
            <p className="meta">Reset · Warning 1 of 2</p>
            <h2>Permanently delete "{selected.name}"?</h2>
            <p>
              This will permanently delete this encrypted vault on disk. There
              is no recovery. Make sure you have no other way to recover your
              master password.
            </p>
            <div className="actions">
              <button type="button" className="btn-ghost" onClick={cancelReset}>
                <XIcon /> Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => setStep("warn2")}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {step === "warn2" && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal modal-danger">
            <p className="meta">Reset · Warning 2 of 2</p>
            <h2>Last warning</h2>
            <p>
              All items in "{selected.name}" will be lost. After this, you can
              set up a fresh vault with the same name.
            </p>
            <div className="actions">
              <button type="button" className="btn-ghost" onClick={cancelReset}>
                <XIcon /> Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => setStep("confirm")}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {step === "confirm" && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <form onSubmit={submitReset} className="modal modal-danger">
            <p className="meta">Reset · Confirm</p>
            <h2>Confirm reset</h2>
            <p>
              Re-enter the current master password to confirm. Wrong password
              aborts.
            </p>
            <div className="field">
              <p className="label">Confirm master password</p>
              <div className="field-row">
                <input
                  type={confirmShow ? "text" : "password"}
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  autoFocus
                  aria-label="Confirm master password"
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="reveal"
                  onClick={() => setConfirmShow((s) => !s)}
                  aria-label={confirmShow ? "Hide password" : "Show password"}
                  aria-pressed={confirmShow}
                  title={confirmShow ? "Hide password" : "Show password"}
                >
                  {confirmShow ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>
            {confirmError && <p className="error" role="alert">{confirmError}</p>}
            <div className="actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={cancelReset}
                disabled={confirmBusy}
              >
                <XIcon /> Cancel
              </button>
              <button
                type="submit"
                className="btn btn-danger"
                disabled={confirmBusy || !confirmPw}
              >
                {confirmBusy ? "Resetting…" : "Reset vault"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

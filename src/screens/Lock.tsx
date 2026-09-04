import { useState } from "react";
import { api } from "../lib/api";

interface Props {
  onUnlocked: () => void;
  /** Called after a successful "forgot password / reset vault" flow. */
  onReset?: () => void;
}

type ResetStep = "idle" | "warn1" | "warn2" | "confirm";

export default function Lock({ onUnlocked, onReset }: Props) {
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset-flow state
  const [step, setStep] = useState<ResetStep>("idle");
  const [confirmPw, setConfirmPw] = useState("");
  const [confirmShow, setConfirmShow] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

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
    setError(null);
    setBusy(true);
    try {
      await api.unlockVault(pw);
      onUnlocked();
    } catch (e: any) {
      setError("Wrong password. Try again.");
      setPw("");
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    setConfirmError(null);
    setConfirmBusy(true);
    try {
      await api.resetVault(confirmPw);
      cancelReset();
      onReset?.();
    } catch {
      setConfirmError("Wrong password. Try again.");
      setConfirmPw("");
    } finally {
      setConfirmBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={submit} className="lock">
        <h2>Unlock your vault</h2>
        <label>
          Master password
          <div className="password-row">
            <input
              type={show ? "text" : "password"}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoFocus
              aria-label="Master password"
            />
            <button
              type="button"
              className="reveal"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? "Hide password" : "Show password"}
              aria-pressed={show}
              title={show ? "Hide password" : "Show password"}
            >
              {show ? "🙈" : "👁"}
            </button>
          </div>
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>
        <button
          type="button"
          className="link"
          onClick={openReset}
          disabled={busy}
        >
          Forgot password / reset vault
        </button>
      </form>

      {step === "warn1" && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>Reset your vault?</h2>
            <p>
              This will permanently delete the encrypted vault on disk. There
              is no recovery. Make sure you have no other way to recover your
              master password.
            </p>
            <div className="actions">
              <button type="button" onClick={cancelReset}>
                Cancel
              </button>
              <button type="button" onClick={() => setStep("warn2")}>
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {step === "warn2" && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>Last warning</h2>
            <p>
              All your items will be lost. After this, the app returns to a
              fresh state and you will set a new master password.
            </p>
            <div className="actions">
              <button type="button" onClick={cancelReset}>
                Cancel
              </button>
              <button type="button" onClick={() => setStep("confirm")}>
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {step === "confirm" && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <form onSubmit={submitReset} className="modal">
            <h2>Confirm reset</h2>
            <p className="muted">
              Re-enter your current master password to confirm. Wrong password
              aborts.
            </p>
            <label>
              Confirm master password
              <div className="password-row">
                <input
                  type={confirmShow ? "text" : "password"}
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  autoFocus
                  aria-label="Confirm master password"
                />
                <button
                  type="button"
                  className="reveal"
                  onClick={() => setConfirmShow((s) => !s)}
                  aria-label={confirmShow ? "Hide password" : "Show password"}
                  aria-pressed={confirmShow}
                  title={confirmShow ? "Hide password" : "Show password"}
                >
                  {confirmShow ? "🙈" : "👁"}
                </button>
              </div>
            </label>
            {confirmError && <p className="error">{confirmError}</p>}
            <div className="actions">
              <button type="button" onClick={cancelReset} disabled={confirmBusy}>
                Cancel
              </button>
              <button type="submit" className="danger" disabled={confirmBusy || !confirmPw}>
                {confirmBusy ? "Resetting…" : "Reset vault"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

import { useState } from "react";
import { api } from "../lib/api";
import { EyeIcon, EyeOffIcon, LockIcon } from "../components/Icon";

interface Props {
  onCreated: () => void;
}

export default function Setup({ onCreated }: Props) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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
      await api.setupVault(pw);
      onCreated();
    } catch (e: any) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stage">
      <div className="screen-eyebrow">New vault</div>
      <form onSubmit={submit} className="setup">
        <div className="stage-frame">
          <div className="safelight" aria-hidden />
          <p className="hint">
            Choose a master password.{" "}
            <span className="hint-strong">
              We cannot recover it if you forget it.
            </span>
          </p>
          <div className="field">
            <p className="label">Master password</p>
            <div className="field-row">
              <input
                type={show ? "text" : "password"}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoFocus
                aria-label="Master password"
                spellCheck={false}
                autoComplete="new-password"
              />
            </div>
          </div>
          <div className="field">
            <p className="label">Confirm</p>
            <div className="field-row">
              <input
                type={show ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                aria-label="Confirm master password"
                spellCheck={false}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="reveal"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? "Hide passwords" : "Show passwords"}
                aria-pressed={show}
                title={show ? "Hide passwords" : "Show passwords"}
              >
                {show ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !pw || !confirm}
          >
            <LockIcon />
            {busy ? "Creating…" : "Create vault"}
          </button>
        </div>
      </form>
    </div>
  );
}

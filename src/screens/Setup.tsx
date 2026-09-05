import { useState } from "react";
import { api } from "../lib/api";
import type { Account } from "../lib/types";
import { EyeIcon, EyeOffIcon, PlusIcon } from "../components/Icon";

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
    <div className="stage">
      <div className="screen-eyebrow">New vault</div>
      <form onSubmit={submit} className="setup">
        <div className="stage-frame">
          <div className="safelight" aria-hidden />
          <p className="hint">
            Choose a display name and a master password.{" "}
            <span className="hint-strong">
              We cannot recover the password if you forget it.
            </span>
          </p>
          <div className="field">
            <p className="label">Display name</p>
            <div className="field-row">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                aria-label="Display name"
                spellCheck={false}
                maxLength={40}
              />
            </div>
          </div>
          <div className="field">
            <p className="label">Master password</p>
            <div className="field-row">
              <input
                type={show ? "text" : "password"}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                aria-label="Master password"
                spellCheck={false}
                autoComplete="new-password"
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
            </div>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !name || !pw || !confirm}
          >
            <PlusIcon />
            {busy ? "Creating…" : "Create vault"}
          </button>
        </div>
      </form>
    </div>
  );
}

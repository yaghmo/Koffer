import { useState } from "react";
import { api } from "../lib/api";

interface Props {
  onCreated: () => void;
}

export default function Setup({ onCreated }: Props) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
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
    <form onSubmit={submit} className="setup">
      <h2>Create your vault</h2>
      <p className="muted">
        Choose a master password. We cannot recover it if you forget it.
      </p>
      <label>
        Master password
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
          aria-label="Master password"
        />
      </label>
      <label>
        Confirm
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-label="Confirm master password"
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create vault"}
      </button>
    </form>
  );
}

import { useState } from "react";
import { api } from "../lib/api";

interface Props {
  onUnlocked: () => void;
}

export default function Lock({ onUnlocked }: Props) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.unlockVault(pw);
      onUnlocked();
    } catch (e: any) {
      setError("Wrong password. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="lock">
      <h2>Unlock your vault</h2>
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
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "Unlocking…" : "Unlock"}
      </button>
    </form>
  );
}

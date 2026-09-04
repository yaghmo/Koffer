import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { onVaultLocked } from "./lib/events";
import { LockIcon, UnlockIcon } from "./components/Icon";
import Setup from "./screens/Setup";
import Lock from "./screens/Lock";
import Vault from "./screens/Vault";

type Status = "loading" | "no-vault" | "locked" | "unlocked";

const APP_VERSION = "0.1.0";

export default function App() {
  const [status, setStatus] = useState<Status>("loading");
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    api.vaultExists().then((exists) => {
      setStatus(exists ? "locked" : "no-vault");
    });
    const unlisten = onVaultLocked(() => setStatus("locked"));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Reset autolock on any user activity
  useEffect(() => {
    if (status !== "unlocked") return;
    const reset = () => api.resetActivity();
    window.addEventListener("mousedown", reset);
    window.addEventListener("keydown", reset);
    return () => {
      window.removeEventListener("mousedown", reset);
      window.removeEventListener("keydown", reset);
    };
  }, [status]);

  // Quiet clock for the header. Single source of drift.
  useEffect(() => {
    const id = window.setInterval(() => setTime(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const stamp = formatStamp(time);

  return (
    <div className="app">
      <header className="app-header">
        <div className="mark">Password Manager</div>
        <div className="actions">
          <span className="meta">{stamp}</span>
          {status === "unlocked" && (
            <button
              className="btn-ghost"
              onClick={() => api.lockVault()}
              aria-label="Lock vault"
            >
              <UnlockIcon /> Lock
            </button>
          )}
          {status === "locked" && (
            <span className="meta" aria-hidden>
              <LockIcon /> Locked
            </span>
          )}
        </div>
      </header>
      <main className="app-main">
        {status === "loading" && <p className="muted">Loading…</p>}
        {status === "no-vault" && (
          <Setup onCreated={() => setStatus("unlocked")} />
        )}
        {status === "locked" && (
          <Lock
            onUnlocked={() => setStatus("unlocked")}
            onReset={() => setStatus("no-vault")}
          />
        )}
        {status === "unlocked" && <Vault />}
      </main>
    </div>
  );
}

function formatStamp(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} · v${APP_VERSION}`;
}

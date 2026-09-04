import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { onVaultLocked } from "./lib/events";
import Setup from "./screens/Setup";
import Lock from "./screens/Lock";
import Vault from "./screens/Vault";

type Status = "loading" | "no-vault" | "locked" | "unlocked";

export default function App() {
  const [status, setStatus] = useState<Status>("loading");

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

  return (
    <div className="app">
      <header>
        <h1>Password Manager</h1>
        {status === "unlocked" && (
          <button onClick={() => api.lockVault()}>Lock</button>
        )}
      </header>
      <main>
        {status === "loading" && <p>Loading…</p>}
        {status === "no-vault" && (
          <Setup onCreated={() => setStatus("unlocked")} />
        )}
        {status === "locked" && (
          <Lock
            onUnlocked={() => setStatus("unlocked")}
            onReset={() => setStatus("no-vault")}
          />
        )}
        {status === "unlocked" && (
          <Vault />
        )}
      </main>
    </div>
  );
}

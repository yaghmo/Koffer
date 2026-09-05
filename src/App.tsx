import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { onVaultLocked } from "./lib/events";
import Setup from "./screens/Setup";
import Lock from "./screens/Lock";
import Vault from "./screens/Vault";
import Settings from "./screens/Settings";
import Sidebar from "./components/Sidebar";

type Status = "loading" | "no-vault" | "locked" | "unlocked";
type View = "vault" | "settings";
type Filter = "all" | "login" | "note" | "card";

export default function App() {
  const [status, setStatus] = useState<Status>("loading");
  const [view, setView] = useState<View>("vault");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    api.vaultExists().then((exists) => {
      setStatus(exists ? "locked" : "no-vault");
    });
    const unlisten = onVaultLocked(() => {
      setStatus("locked");
      setView("vault");
    });
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

  if (status === "loading") {
    return (
      <div className="app">
        <main className="app-main">
          <p className="muted">Loading…</p>
        </main>
      </div>
    );
  }

  if (status === "no-vault") {
    return (
      <div className="app">
        <main className="app-main">
          <Setup onCreated={() => setStatus("unlocked")} />
        </main>
      </div>
    );
  }

  if (status === "locked") {
    return (
      <div className="app">
        <main className="app-main">
          <Lock
            onUnlocked={() => setStatus("unlocked")}
            onReset={() => setStatus("no-vault")}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="app-with-sidebar">
      <Sidebar
        isUnlocked={status === "unlocked"}
        onLock={() => api.lockVault()}
        currentView={view}
        onNavigate={setView}
        currentFilter={filter}
        onFilterChange={setFilter}
      />
      <main className="app-main">
        {view === "vault" && <Vault filter={filter} />}
        {view === "settings" && <Settings />}
      </main>
    </div>
  );
}

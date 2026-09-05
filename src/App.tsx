import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { onVaultLocked } from "./lib/events";
import Setup from "./screens/Setup";
import AccountLock from "./screens/AccountLock";
import Vault from "./screens/Vault";
import Settings from "./screens/Settings";
import Sidebar from "./components/Sidebar";
import type { Account } from "./lib/types";

type Status = "loading" | "no-accounts" | "locked" | "unlocked";
type View = "vault" | "settings";
type Filter = "all" | "login" | "note" | "card";

export default function App() {
  const [status, setStatus] = useState<Status>("loading");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currentAccount, setCurrentAccount] = useState<Account | null>(null);
  const [view, setView] = useState<View>("vault");
  const [filter, setFilter] = useState<Filter>("all");
  const [editingId, setEditingId] = useState<string | "new" | null>(null);

  useEffect(() => {
    api.listAccounts().then((list) => {
      setAccounts(list);
      setStatus(list.length === 0 ? "no-accounts" : "locked");
    });
    const unlisten = onVaultLocked(() => {
      setStatus("locked");
      setView("vault");
      setEditingId(null);
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

  // Sidebar nav/filter always closes the editor. Unsaved changes are lost;
  // matching the user's mental model that "clicking a section goes there."
  function navigate(nextView: View) {
    setEditingId(null);
    setView(nextView);
  }
  function changeFilter(next: Filter) {
    setEditingId(null);
    setFilter(next);
  }

  function handleLock() {
    setStatus("locked");
    setView("vault");
    setEditingId(null);
    api.lockVault().catch(() => {});
  }

  async function refreshAccounts() {
    const list = await api.listAccounts();
    setAccounts(list);
    return list;
  }

  if (status === "loading") {
    return (
      <div className="app">
        <main className="app-main">
          <p className="muted">Loading…</p>
        </main>
      </div>
    );
  }

  if (status === "no-accounts") {
    return (
      <div className="app">
        <main className="app-main">
          <Setup
            onCreated={async (acct) => {
              setCurrentAccount(acct);
              setAccounts([acct]);
              setStatus("unlocked");
            }}
          />
        </main>
      </div>
    );
  }

  if (status === "locked") {
    return (
      <div className="app">
        <main className="app-main">
          <AccountLock
            accounts={accounts}
            onUnlocked={(acct) => {
              setCurrentAccount(acct);
              setStatus("unlocked");
            }}
            onReset={async (deletedId) => {
              const list = await refreshAccounts();
              if (list.length === 0) {
                setStatus("no-accounts");
              }
              // Otherwise stay on the lock screen, list refreshed.
              // The deleted id is removed from `accounts` automatically.
              // Suppress unused warning when no extra logic.
              void deletedId;
            }}
            onAddNew={async () => {
              setStatus("no-accounts");
            }}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="app-with-sidebar">
      <Sidebar
        accountName={currentAccount?.name ?? ""}
        isUnlocked={status === "unlocked"}
        onLock={handleLock}
        currentView={view}
        onNavigate={navigate}
        currentFilter={filter}
        onFilterChange={changeFilter}
      />
      <main className="app-main">
        {view === "vault" && (
          <Vault
            filter={filter}
            editingId={editingId}
            onEditItem={(id) => setEditingId(id)}
            onEditNew={() => setEditingId("new")}
            onEditorClose={() => setEditingId(null)}
          />
        )}
        {view === "settings" && currentAccount && (
          <Settings accountId={currentAccount.id} onLock={handleLock} />
        )}
      </main>
    </div>
  );
}

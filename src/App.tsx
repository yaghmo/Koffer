import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { onVaultLocked } from "./lib/events";
import Setup from "./screens/Setup";
import AccountLock from "./screens/AccountLock";
import Vault from "./screens/Vault";
import Settings from "./screens/Settings";
import ItemViewer from "./screens/ItemViewer";
import Sidebar from "./components/Sidebar";
import type { Account, ItemKind } from "./lib/types";

type Status = "loading" | "no-accounts" | "locked" | "unlocked";
type View = "vault" | "settings";
type Filter = "all" | "login" | "note" | "card";

// editingTarget is null when the editor is closed, an existing id when
// editing, or { kind } when creating a new item of a specific kind.
type EditingTarget =
  | { kind: "existing"; id: string }
  | { kind: "new"; itemKind: ItemKind }
  | null;

export default function App() {
  const [status, setStatus] = useState<Status>("loading");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currentAccount, setCurrentAccount] = useState<Account | null>(null);
  const [view, setView] = useState<View>("vault");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<EditingTarget>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  // Bumped after viewer-side delete so the vault list refetches.
  const [vaultRefresh, setVaultRefresh] = useState(0);

  useEffect(() => {
    api.listAccounts().then((list) => {
      setAccounts(list);
      setStatus(list.length === 0 ? "no-accounts" : "locked");
    });
    const unlisten = onVaultLocked(() => {
      setStatus("locked");
      setView("vault");
      setEditing(null);
      setViewingId(null);
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

  // Sidebar nav/filter always closes the viewer/editor. Unsaved changes are
  // lost; matches the user's mental model that "clicking a section goes there."
  function navigate(nextView: View) {
    setEditing(null);
    setViewingId(null);
    setView(nextView);
  }
  function changeFilter(next: Filter) {
    setEditing(null);
    setViewingId(null);
    setFilter(next);
  }

  function handleLock() {
    setStatus("locked");
    setView("vault");
    setEditing(null);
    setViewingId(null);
    // Always re-pull the account list so a vault deleted from Settings (or
    // anywhere else) stops appearing on the lock screen immediately.
    refreshAccounts().catch(() => {});
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
            editing={editing}
            viewingId={viewingId}
            refreshKey={vaultRefresh}
            onViewItem={(id) => {
              setEditing(null);
              setViewingId(id);
            }}
            onEditItem={(id) => {
              setViewingId(null);
              setEditing({ kind: "existing", id });
            }}
            onEditNew={(itemKind) => {
              setViewingId(null);
              setEditing({ kind: "new", itemKind });
            }}
            onEditorClose={() => setEditing(null)}
            onViewerClose={() => setViewingId(null)}
            onItemSaved={() => setVaultRefresh((n) => n + 1)}
          />
        )}
        {view === "settings" && currentAccount && (
          <Settings
            accountId={currentAccount.id}
            onLock={handleLock}
          />
        )}
        {/* Viewer overlays both views so the user can pop in from anywhere */}
        {viewingId && (
          <ItemViewerOverlay
            id={viewingId}
            onEdit={(id) => {
              setViewingId(null);
              setEditing({ kind: "existing", id });
            }}
            onClose={() => setViewingId(null)}
            onDeleted={() => setVaultRefresh((n) => n + 1)}
          />
        )}
      </main>
    </div>
  );
}

function ItemViewerOverlay(props: {
  id: string;
  onEdit: (id: string) => void;
  onClose: () => void;
  onDeleted: () => void;
}) {
  return (
    <div className="overlay">
      <ItemViewer
        id={props.id}
        onEdit={props.onEdit}
        onClose={props.onClose}
        onDelete={async (id) => {
          await api.deleteItem(id);
          props.onDeleted();
          props.onClose();
        }}
      />
    </div>
  );
}

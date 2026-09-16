import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { onVaultLocked } from "./lib/events";
import Setup from "./screens/Setup";
import AccountLock from "./screens/AccountLock";
import Vault from "./screens/Vault";
import Settings from "./screens/Settings";
import PersonalInfoScreen from "./screens/PersonalInfo";
import ItemViewer from "./screens/ItemViewer";
import Stats from "./screens/Stats";
import Sidebar from "./components/Sidebar";
import type { Account, ItemKind } from "./lib/types";

type Status = "loading" | "no-accounts" | "locked" | "unlocked";
type View = "vault" | "settings" | "personal" | "stats";
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
  const [autolock, setAutolock] = useState<{ remainingSecs: number; timeoutSecs: number } | null>(null);

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

  // Polling this is also what makes the idle lock actually happen — nothing
  // else calls the backend's autolock check.
  useEffect(() => {
    if (status !== "unlocked") {
      setAutolock(null);
      return;
    }
    let cancelled = false;
    const id = window.setInterval(async () => {
      try {
        const s = await api.autolockStatus();
        if (cancelled) return;
        if (s.locked) {
          setStatus("locked");
          setView("vault");
          setEditing(null);
          setViewingId(null);
          refreshAccounts().catch(() => {});
        } else {
          setAutolock({ remainingSecs: s.remaining_secs, timeoutSecs: s.timeout_secs });
        }
      } catch {
        // transient IPC hiccup; next tick retries
      }
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
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
    setView("vault");
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
      <div className="flex h-screen items-center justify-center bg-surface-container-lowest">
        <p className="text-body-md text-on-surface-variant">Loading…</p>
      </div>
    );
  }

  // A reset can remove the last account while status is "locked".
  if (status === "no-accounts" || (status === "locked" && accounts.length === 0)) {
    return (
      <div className="h-screen bg-surface-container-lowest">
        <main className="h-full">
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
      <div className="h-screen bg-surface-container-lowest">
        <main className="h-full">
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
    <div className="flex h-screen">
      <Sidebar
        accountName={currentAccount?.name ?? ""}
        isUnlocked={status === "unlocked"}
        onLock={handleLock}
        currentView={view}
        onNavigate={navigate}
        currentFilter={filter}
        onFilterChange={changeFilter}
        autolock={autolock}
      />
      <main className="flex-1 overflow-y-auto">
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
        {view === "personal" && <PersonalInfoScreen />}
        {view === "stats" && <Stats />}
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
    <div className="fixed inset-0 z-40 flex items-stretch justify-end bg-black/50" onClick={props.onClose}>
      <div onClick={(e) => e.stopPropagation()}>
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
    </div>
  );
}

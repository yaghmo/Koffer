import { useEffect, useState } from "react";
import { api } from "./lib/api";
import {
  onApproveRequest,
  onExtendRequest,
  onFillRequest,
  onItemsChanged,
  onVaultLocked,
  type ApproveRequest,
  type FillRequest,
} from "./lib/events";
import { fetchMissingLogos, refreshSiteLogos } from "./lib/logos";
import { logUi } from "./lib/log";
import Setup from "./screens/Setup";
import AccountLock from "./screens/AccountLock";
import Vault from "./screens/Vault";
import Settings from "./screens/Settings";
import PersonalInfoScreen from "./screens/PersonalInfo";
import ItemViewer from "./screens/ItemViewer";
import Stats from "./screens/Stats";
import Sidebar from "./components/Sidebar";
import ConfirmDialog from "./components/ConfirmDialog";
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
  // Set when the editor is opened from outside the vault view (e.g. Stats),
  // so closing it can return there instead of always landing on "vault".
  const [returnView, setReturnView] = useState<View | null>(null);
  // Bumped after viewer-side delete so the vault list refetches.
  const [vaultRefresh, setVaultRefresh] = useState(0);
  const [autolock, setAutolock] = useState<{ remainingSecs: number; timeoutSecs: number } | null>(null);
  // Set when the browser extension filled a login with the idle timer almost
  // up, and cleared when the vault locks or the user answers.
  const [extendAsk, setExtendAsk] = useState<number | null>(null);
  // Set when a paired browser asked for a password on a site it has never
  // been approved for. The call was already refused; this only decides
  // whether the next one is.
  const [approveAsk, setApproveAsk] = useState<ApproveRequest | null>(null);
  // With "confirm every fill" on: one handout the browser is waiting on.
  const [fillAsk, setFillAsk] = useState<FillRequest | null>(null);
  // A line that says what just happened and then gets out of the way. The
  // approval dialog closes the instant it is answered, which left no sign
  // that anything had been granted — and "did that work?" is the one
  // question a permission prompt must not leave behind.
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.listAccounts(), api.unlockedAccount().catch(() => null)]).then(([list, open]) => {
      setAccounts(list);
      // A reload (F5) keeps the backend unlocked; showing the lock screen
      // over an open vault would lie about its state.
      if (open) {
        setCurrentAccount(open);
        setStatus("unlocked");
        return;
      }
      // Zero accounts is not itself a reason to skip AccountLock — its own
      // empty state ("No vaults exist on this device") already handles that
      // and offers both "Create one" and "Import vault" (onAddNew/import).
      setStatus("locked");
    });
    const unlisten = onVaultLocked(() => {
      logUi("info", "app", "vault locked by backend (idle timeout or lock command)");
      setStatus("locked");
      setView("vault");
      setEditing(null);
      setViewingId(null);
      setReturnView(null);
      setExtendAsk(null);
      setApproveAsk(null);
      setFillAsk(null);
      setNotice(null);
    });
    const unlistenExtend = onExtendRequest((remaining) => {
      logUi("info", "app", `extension filled a login with ${remaining}s left`);
      setExtendAsk(remaining);
    });
    const unlistenApprove = onApproveRequest((req) => {
      logUi("info", "app", `extension asked to be approved for ${req.host}`);
      // First come, first served. A second request while one is on screen is
      // dropped rather than swapped in: re-rendering this dialog under the
      // pointer would change which site the next click approves.
      setApproveAsk((current) => current ?? req);
    });
    const unlistenFill = onFillRequest((req) => {
      logUi("info", "app", `extension asked to fill on ${req.host}`);
      // Same rule as approvals: never swap the dialog under the pointer.
      setFillAsk((current) => current ?? req);
    });
    return () => {
      unlisten.then((fn) => fn());
      unlistenExtend.then((fn) => fn());
      unlistenApprove.then((fn) => fn());
      unlistenFill.then((fn) => fn());
    };
  }, []);

  // A notice says its piece and goes. Cleared on a new one so two in a row
  // do not leave the first one's timer to cut the second short.
  useEffect(() => {
    if (notice === null) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  // Re-check every login's favicon once per unlocked session, so a site that
  // changed its icon updates without anyone pressing the Settings button.
  //
  // This is a no-op unless the user opted in: unforced, `refreshSiteLogos`
  // returns immediately when `auto_refresh_icons` is off, which it is by
  // default. Left on because each check is a request to a site you hold an
  // account with, it would put the vault's whole account list into DNS and
  // TLS SNI, timestamped to every unlock.
  // ponytail: serial fetches on a background promise; batch them if a large
  // vault ever makes the first seconds after unlock feel slow.
  useEffect(() => {
    if (status !== "unlocked") return;
    let cancelled = false;
    refreshSiteLogos()
      .then(([updated, total]) => {
        logUi("info", "logos", `launch refresh updated=${updated} of=${total}`);
        if (!cancelled && updated > 0) setVaultRefresh((n) => n + 1);
      })
      .catch((e) => logUi("warn", "logos", `launch refresh failed: ${String(e)}`));
    return () => {
      cancelled = true;
    };
  }, [status]);

  // A login the browser just saved has no logo yet; look it up once.
  useEffect(() => {
    if (status !== "unlocked") return;
    const unlisten = onItemsChanged(() => {
      fetchMissingLogos()
        .then((updated) => {
          if (updated > 0) setVaultRefresh((n) => n + 1);
        })
        .catch((e) => logUi("warn", "logos", `new login logo failed: ${String(e)}`));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [status]);

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
    logUi("info", "nav", `view=${nextView}`);
    setEditing(null);
    setViewingId(null);
    setReturnView(null);
    setView(nextView);
  }
  function changeFilter(next: Filter) {
    logUi("info", "nav", `filter=${next}`);
    setEditing(null);
    setViewingId(null);
    setReturnView(null);
    setFilter(next);
    setView("vault");
  }

  function handleLock() {
    setStatus("locked");
    setView("vault");
    setEditing(null);
    setViewingId(null);
    setReturnView(null);
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

  // "no-accounts" is reached only via AccountLock's own "Create one"/"Add
  // another vault" affordance (onAddNew below) — an empty account list on
  // its own (fresh install, or a reset that removed the last account) stays
  // on "locked" so AccountLock's empty state (with its "Import vault"
  // option) is reachable.
  if (status === "no-accounts") {
    return (
      <div className="h-screen bg-surface-container-lowest">
        <main className="h-full">
          <Setup
            onCreated={async (acct) => {
              setCurrentAccount(acct);
              setAccounts([acct]);
              setStatus("unlocked");
            }}
            onCancel={() => {
              logUi("info", "app", "vault creation cancelled");
              setStatus("locked");
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
              logUi("info", "app", `unlocked account=${acct.id}`);
              setCurrentAccount(acct);
              setStatus("unlocked");
            }}
            onAddNew={async () => {
              setStatus("no-accounts");
            }}
            onImported={async () => {
              await refreshAccounts().catch(() => {});
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
            onEditorClose={() => {
              setEditing(null);
              if (returnView) {
                setView(returnView);
                setReturnView(null);
              }
            }}
            onViewerClose={() => setViewingId(null)}
            onItemSaved={() => setVaultRefresh((n) => n + 1)}
            onFilterChange={changeFilter}
          />
        )}
        {view === "settings" && currentAccount && (
          <Settings
            accountId={currentAccount.id}
            onLock={handleLock}
          />
        )}
        {view === "personal" && <PersonalInfoScreen />}
        {view === "stats" && <Stats onViewItem={(id) => setViewingId(id)} />}
        {/* Only a person here may extend the session. The fill itself does
            not touch the idle timer, or a paired browser would be enough to
            hold the vault open indefinitely. Held back while an approval is
            on screen so the two never stack. */}
        {extendAsk !== null && approveAsk === null && status === "unlocked" && (
          <ConfirmDialog
            title="Keep the vault unlocked?"
            message={`The browser extension just filled a login, and the vault locks in about ${Math.max(
              1,
              Math.round(extendAsk / 60)
            )} minute${Math.round(extendAsk / 60) === 1 ? "" : "s"}. Filling does not extend the session on its own.`}
            confirmLabel="Keep unlocked"
            tone="primary"
            onConfirm={() => {
              api.resetActivity().catch(() => {});
              logUi("info", "app", "session extended from the extension prompt");
              setExtendAsk(null);
            }}
            onCancel={() => setExtendAsk(null)}
          />
        )}
        {/* Pairing lets a browser ask; this is what answers. The bridge has
            already refused the call that triggered it, so saying no here
            costs nothing but the fill the user just tried. */}
        {approveAsk !== null && status === "unlocked" && (
          <ConfirmDialog
            title={`Fill logins for ${approveAsk.host}?`}
            message={`${approveAsk.label} asked to fill logins on ${approveAsk.host}. ${
              approveAsk.count === 0
                ? "You have no saved login for this site yet."
                : `You have ${approveAsk.count} saved login${approveAsk.count === 1 ? "" : "s"} for it.`
            } Allow it, and this browser can fill that site from now on without asking again. It still cannot touch any other site until you say so.`}
            confirmLabel="Allow"
            tone="primary"
            onConfirm={() => {
              const { origin, host, label } = approveAsk;
              api
                .bridgeApprove(origin, host)
                .then(() => {
                  logUi("info", "app", `approved ${host} for the extension`);
                  setNotice(`${label} can now fill logins for ${host}.`);
                })
                .catch((e) => {
                  logUi("warn", "app", `approval failed: ${String(e)}`);
                  setNotice(`${host} could not be approved: ${String(e)}`);
                });
              setApproveAsk(null);
            }}
            onCancel={() => setApproveAsk(null)}
          />
        )}
        {fillAsk !== null && approveAsk === null && status === "unlocked" && (
          <ConfirmDialog
            title={`Fill ${fillAsk.host}?`}
            message={`${fillAsk.label} wants the ${fillAsk.what === "totp" ? "2FA code" : fillAsk.what} for ${
              fillAsk.title || "a login"
            }${fillAsk.username ? ` (${fillAsk.username})` : ""} on ${fillAsk.host}. Allow covers this one request. If you did not just ask for it in your browser, say no.`}
            confirmLabel="Allow"
            tone="primary"
            onConfirm={() => {
              const { origin, id, host } = fillAsk;
              api.bridgeConfirmFill(origin, id, host).catch((e) => setNotice(`Could not allow it: ${String(e)}`));
              setFillAsk(null);
            }}
            onCancel={() => setFillAsk(null)}
          />
        )}
        {notice !== null && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center px-5"
          >
            <p className="dialog max-w-[420px] px-4 py-2.5 text-center text-body-sm text-on-surface">
              {notice}
            </p>
          </div>
        )}
        {/* Viewer overlays both views so the user can pop in from anywhere */}
        {viewingId && (
          <ItemViewerOverlay
            id={viewingId}
            onEdit={(id) => {
              setViewingId(null);
              setEditing({ kind: "existing", id });
              setReturnView(view === "vault" ? null : view);
              setView("vault");
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

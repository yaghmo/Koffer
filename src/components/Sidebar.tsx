import { LockIcon, UnlockIcon } from "./Icon";

interface Props {
  isUnlocked: boolean;
  onLock: () => void;
  currentView: "vault" | "settings";
  onNavigate: (view: "vault" | "settings") => void;
  currentFilter: "all" | "login" | "note" | "card";
  onFilterChange: (filter: "all" | "login" | "note" | "card") => void;
}

export default function Sidebar({
  isUnlocked,
  onLock,
  currentView,
  onNavigate,
  currentFilter,
  onFilterChange,
}: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-title">Password Manager</h1>
        <p className="sidebar-version">v0.1.0</p>
      </div>

      {isUnlocked && (
        <>
          <nav className="sidebar-nav">
            <button
              className={`sidebar-link ${currentView === "vault" ? "active" : ""}`}
              onClick={() => onNavigate("vault")}
            >
              Vault
            </button>
            <div className="sidebar-filters">
              <button
                className={`sidebar-filter ${currentFilter === "all" ? "active" : ""}`}
                onClick={() => onFilterChange("all")}
              >
                All items
              </button>
              <button
                className={`sidebar-filter ${currentFilter === "login" ? "active" : ""}`}
                onClick={() => onFilterChange("login")}
              >
                Logins
              </button>
              <button
                className={`sidebar-filter ${currentFilter === "note" ? "active" : ""}`}
                onClick={() => onFilterChange("note")}
              >
                Notes
              </button>
              <button
                className={`sidebar-filter ${currentFilter === "card" ? "active" : ""}`}
                onClick={() => onFilterChange("card")}
              >
                Cards
              </button>
            </div>
            <button
              className={`sidebar-link ${currentView === "settings" ? "active" : ""}`}
              onClick={() => onNavigate("settings")}
            >
              Settings
            </button>
          </nav>

          <div className="sidebar-footer">
            <button className="sidebar-lock" onClick={onLock}>
              <LockIcon size={16} />
              Lock vault
            </button>
          </div>
        </>
      )}

      {!isUnlocked && (
        <div className="sidebar-locked">
          <UnlockIcon size={24} />
          <p>Vault locked</p>
        </div>
      )}
    </aside>
  );
}

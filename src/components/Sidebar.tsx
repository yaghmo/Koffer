import type { ReactNode } from "react";
import { GridIcon, KeyIcon, NoteIcon, CardIcon, UserIcon, SettingsIcon, LockIcon, UnlockIcon } from "./Icon";
import { Emblem } from "./Emblem";

interface Props {
  accountName: string;
  isUnlocked: boolean;
  onLock: () => void;
  currentView: "vault" | "settings" | "personal";
  onNavigate: (view: "vault" | "settings" | "personal") => void;
  currentFilter: "all" | "login" | "note" | "card";
  onFilterChange: (filter: "all" | "login" | "note" | "card") => void;
  autolock: { remainingSecs: number; timeoutSecs: number } | null;
}

const RING_RADIUS = 14;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function formatMinSec(totalSecs: number): string {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function AutolockRing({ remainingSecs, timeoutSecs }: { remainingSecs: number; timeoutSecs: number }) {
  const fraction = timeoutSecs > 0 ? remainingSecs / timeoutSecs : 0;
  const offset = RING_CIRCUMFERENCE * (1 - fraction);
  return (
    <div className="flex items-center gap-2" title="Time until auto-lock">
      <svg width={32} height={32} viewBox="0 0 32 32" className="-rotate-90">
        <circle cx={16} cy={16} r={RING_RADIUS} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={2.5} />
        <circle
          cx={16}
          cy={16}
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={offset}
          className="text-tertiary transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
      </svg>
      <span className="label-md">{formatMinSec(remainingSecs)}</span>
    </div>
  );
}

const VAULT_ITEMS = [
  { key: "all" as const, label: "All items", Icon: GridIcon },
  { key: "login" as const, label: "Logins", Icon: KeyIcon },
  { key: "note" as const, label: "Notes", Icon: NoteIcon },
  { key: "card" as const, label: "Cards", Icon: CardIcon },
];

function NavRow({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-control px-3 py-2 text-left text-body-md font-medium transition-colors duration-150 ease-out ${
        active
          ? "bg-surface-container-high text-on-surface"
          : "text-on-surface-variant hover:bg-white/4 hover:text-on-surface"
      }`}
    >
      {children}
    </button>
  );
}

export default function Sidebar({
  accountName,
  isUnlocked,
  onLock,
  currentView,
  onNavigate,
  currentFilter,
  onFilterChange,
  autolock,
}: Props) {
  return (
    <aside className="flex h-full w-[220px] flex-col border-r border-white/6 bg-surface-container-lowest">
      <div className="flex items-center gap-2.5 border-b border-white/6 px-4 py-4">
        <Emblem size={28} />
        <div className="min-w-0">
          <p className="truncate text-body-md font-semibold text-on-surface">
            {accountName || "Password Manager"}
          </p>
          <p className="label-md">Local vault</p>
        </div>
      </div>

      {isUnlocked ? (
        <>
          <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
            <div className="flex flex-col gap-1">
              <p className="label-sm px-3 pb-1">Vault</p>
              {VAULT_ITEMS.map(({ key, label, Icon }) => (
                <NavRow
                  key={key}
                  active={currentView === "vault" && currentFilter === key}
                  onClick={() => onFilterChange(key)}
                >
                  <Icon size={16} /> {label}
                </NavRow>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              <p className="label-sm px-3 pb-1">Profile</p>
              <NavRow active={currentView === "personal"} onClick={() => onNavigate("personal")}>
                <UserIcon size={16} /> Personal info
              </NavRow>
            </div>
          </nav>
          <div className="flex flex-col gap-2 border-t border-white/6 p-3">
            <NavRow active={currentView === "settings"} onClick={() => onNavigate("settings")}>
              <SettingsIcon size={16} /> Settings
            </NavRow>
            {autolock && <AutolockRing remainingSecs={autolock.remainingSecs} timeoutSecs={autolock.timeoutSecs} />}
            <button type="button" onClick={onLock} className="btn-secondary w-full">
              <LockIcon size={16} /> Lock vault
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-on-surface-variant">
          <UnlockIcon size={24} />
          <p className="text-body-sm">Vault locked</p>
        </div>
      )}
    </aside>
  );
}

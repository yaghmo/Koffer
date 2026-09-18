import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  GridIcon,
  KeyIcon,
  NoteIcon,
  CardIcon,
  UserIcon,
  SettingsIcon,
  LockIcon,
  UnlockIcon,
  ChartIcon,
  ChevronIcon,
} from "./Icon";
import { Emblem } from "./Emblem";

// Whether the kind list under "All items" is expanded. Per-device UI state,
// so it lives in localStorage rather than in the encrypted vault.
const EXPANDED_KEY = "sidebar-vault-expanded";

function loadExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_KEY) !== "false";
  } catch {
    return true;
  }
}

interface Props {
  accountName: string;
  isUnlocked: boolean;
  onLock: () => void;
  currentView: "vault" | "settings" | "personal" | "stats";
  onNavigate: (view: "vault" | "settings" | "personal" | "stats") => void;
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

// The three kinds are views onto "All items", so the sidebar nests them
// under it rather than listing four siblings.
const KIND_ITEMS = [
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
      className={`flex w-full items-center gap-2.5 rounded-control px-3 py-2 text-left text-body-md font-medium transition-colors duration-150 ease-out ${
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
  const [expanded, setExpanded] = useState<boolean>(loadExpanded);

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, String(expanded));
    } catch {
      // a blocked storage quota is not worth failing navigation over
    }
  }, [expanded]);

  // Landing on a kind from elsewhere (a "+ more" link) should reveal where
  // you are in the tree.
  useEffect(() => {
    if (currentFilter !== "all") setExpanded(true);
  }, [currentFilter]);

  const inVault = currentView === "vault";

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
              <div className="flex items-center gap-0.5">
                <div className="min-w-0 flex-1">
                  <NavRow active={inVault && currentFilter === "all"} onClick={() => onFilterChange("all")}>
                    <GridIcon size={16} /> All items
                  </NavRow>
                </div>
                {/* Separate from the row so opening the tree does not also
                    navigate away from the section you are reading. */}
                <button
                  type="button"
                  onClick={() => setExpanded((e) => !e)}
                  aria-expanded={expanded}
                  aria-controls="vault-kinds"
                  aria-label={expanded ? "Collapse item kinds" : "Expand item kinds"}
                  className="rounded-control p-1.5 text-on-surface-variant transition-colors duration-150 ease-out hover:bg-white/4 hover:text-on-surface"
                >
                  <ChevronIcon
                    size={14}
                    className={`transition-transform duration-150 ease-out ${expanded ? "rotate-90" : ""}`}
                  />
                </button>
              </div>
              {expanded && (
                // The rule down the left is what makes these read as children
                // of All items rather than as three more top-level sections.
                <div id="vault-kinds" className="ml-[18px] flex flex-col gap-1 border-l border-white/8 pl-2">
                  {KIND_ITEMS.map(({ key, label, Icon }) => (
                    <NavRow
                      key={key}
                      active={inVault && currentFilter === key}
                      onClick={() => onFilterChange(key)}
                    >
                      <Icon size={16} /> {label}
                    </NavRow>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <p className="label-sm px-3 pb-1">Profile</p>
              <NavRow active={currentView === "personal"} onClick={() => onNavigate("personal")}>
                <UserIcon size={16} /> Personal info
              </NavRow>
            </div>
          </nav>
          <div className="flex flex-col gap-2 border-t border-white/6 p-3">
            <NavRow active={currentView === "stats"} onClick={() => onNavigate("stats")}>
              <ChartIcon size={16} /> Stats
            </NavRow>
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

import { useState, useEffect, useRef, type RefObject } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/api";
import { onBridgeChanged } from "../lib/events";
import { refreshSiteLogos } from "../lib/logos";
import type { BackupState, BridgeState, SecurityState, VaultStorage } from "../lib/types";
import { SettingsIcon, ShieldIcon, ImageIcon, XIcon, DatabaseIcon, KeyIcon, CloudIcon } from "../components/Icon";
import RecoveryCodeDialog from "../components/RecoveryCodeDialog";
import ApprovedSites from "../components/ApprovedSites";
import NeverSaveSites from "../components/NeverSaveSites";
import BrowserFeatures from "../components/BrowserFeatures";
import { fuzzyScore } from "../lib/fuzzy";
import { useHotkey } from "../lib/useHotkey";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

const DAY = 24 * 60 * 60;

function daysAgo(unixSecs: number): number {
  return Math.floor((Date.now() / 1000 - unixSecs) / DAY);
}

function formatMins(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

interface Props {
  accountId: string;
  onLock: () => void;
}

type GroupId = "general" | "security" | "browser" | "backup";

const GROUPS: { id: GroupId; label: string }[] = [
  { id: "general", label: "General" },
  { id: "security", label: "Security" },
  { id: "browser", label: "Browser extension" },
  { id: "backup", label: "Backup & storage" },
];

/**
 * Every section, in page order, with the words someone might search for.
 * The keywords are what the section's own text talks about, so a search
 * finds a setting by what it does, not only by its heading.
 */
const SECTIONS: { id: string; group: GroupId; title: string; keywords: string }[] = [
  { id: "autolock", group: "general", title: "Auto-lock", keywords: "idle timeout minutes lock inactivity" },
  { id: "clipboard", group: "general", title: "Clipboard", keywords: "copy clear seconds paste" },
  { id: "logos", group: "general", title: "Site logos", keywords: "icons favicon refresh images network" },
  {
    id: "security",
    group: "security",
    title: "Recovery code and master password",
    keywords: "recovery code master password change forgot",
  },
  { id: "danger", group: "security", title: "Danger zone", keywords: "reset delete wipe erase vault" },
  {
    id: "pairing",
    group: "browser",
    title: "Paired browsers",
    keywords: "extension chrome firefox pair unpair bridge port",
  },
  {
    id: "features",
    group: "browser",
    title: "What the extension may do",
    keywords: "save offer update password 2fa totp code approve prompt bar",
  },
  { id: "approved", group: "browser", title: "Approved sites", keywords: "allowed hosts revoke permission" },
  { id: "never", group: "browser", title: "Never offer to save", keywords: "blocked silenced sites list" },
  { id: "export", group: "backup", title: "Export a backup", keywords: "export file copy usb disk" },
  { id: "cloud", group: "backup", title: "Cloud backup", keywords: "upload worker token automatic r2" },
  { id: "storage", group: "backup", title: "Storage", keywords: "file size path database last saved" },
];

/** Sections matching a search, best first. */
function search(query: string) {
  return SECTIONS.map((sec) => ({ sec, score: fuzzyScore(query, `${sec.title} ${sec.keywords}`) }))
    .filter((r) => r.score !== null)
    .sort((a, b) => b.score! - a.score!)
    .map((r) => r.sec);
}

/**
 * The tree on the left: groups and their sections, or search results while
 * there is a query. Ctrl+K puts the cursor in the search box.
 */
function SettingsNav({
  group,
  query,
  onQuery,
  onGroup,
  onSection,
  searchRef,
}: {
  group: GroupId;
  query: string;
  onQuery: (q: string) => void;
  onGroup: (g: GroupId) => void;
  onSection: (id: string) => void;
  searchRef: RefObject<HTMLInputElement>;
}) {
  const results = query.trim() ? search(query) : null;
  const item = (active: boolean) =>
    `w-full rounded-control px-2 py-1.5 text-left text-body-sm transition-colors duration-150 ease-out hover:bg-white/6 ${
      active ? "bg-white/6 text-on-surface" : "text-on-surface-variant"
    }`;
  return (
    <nav aria-label="Settings sections" className="sticky top-8 flex w-[172px] flex-shrink-0 flex-col gap-4 self-start">
      <p className="text-body-md font-semibold text-on-surface">Settings</p>
      <input
        ref={searchRef}
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onQuery("");
          if (e.key === "Enter" && results && results[0]) onSection(results[0].id);
        }}
        placeholder="Search  Ctrl+K"
        aria-label="Search settings"
        className="field h-9"
      />
      {results ? (
        results.length === 0 ? (
          <p className="px-2 text-body-sm text-on-surface-variant">No matches.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {results.map((sec) => (
              <li key={sec.id}>
                <button type="button" className={item(false)} onClick={() => onSection(sec.id)}>
                  <span className="block truncate text-on-surface">{sec.title}</span>
                  <span className="block truncate text-label-md text-on-surface-variant">
                    {GROUPS.find((g) => g.id === sec.group)!.label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <ul className="flex flex-col gap-3">
          {GROUPS.map((g) => (
            <li key={g.id} className="flex flex-col gap-0.5">
              <button
                type="button"
                aria-current={g.id === group ? "page" : undefined}
                className={`${item(g.id === group)} font-semibold`}
                onClick={() => onGroup(g.id)}
              >
                {g.label}
              </button>
              <ul className="ml-3 flex flex-col gap-0.5 border-l border-white/8 pl-2">
                {SECTIONS.filter((sec) => sec.group === g.id).map((sec) => (
                  <li key={sec.id}>
                    <button type="button" className={item(false)} onClick={() => onSection(sec.id)}>
                      <span className="block truncate" title={sec.title}>
                        {sec.title}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

export default function Settings({ accountId, onLock }: Props) {
  const [group, setGroup] = useState<GroupId>("general");
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useHotkey("ctrl+k", () => searchRef.current?.focus());
  // A search shows every matching section at once; otherwise, one group.
  const visible = query.trim()
    ? search(query).map((sec) => sec.id)
    : SECTIONS.filter((sec) => sec.group === group).map((sec) => sec.id);
  const show = (id: string) => visible.includes(id);

  /** Open a section's group and bring the section into view. */
  function goTo(id: string) {
    const sec = SECTIONS.find((x) => x.id === id);
    if (!sec) return;
    setQuery("");
    setGroup(sec.group);
    requestAnimationFrame(() => {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      document
        .getElementById(`settings-${id}`)
        ?.scrollIntoView?.({ block: "start", behavior: reduce ? "auto" : "smooth" });
    });
  }

  const [autolockMins, setAutolockMins] = useState(15);
  const [busy, setBusy] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [logosBusy, setLogosBusy] = useState(false);
  const [showApproved, setShowApproved] = useState(false);
  const [logosProgress, setLogosProgress] = useState<[number, number] | null>(null);
  const [siteLogos, setSiteLogos] = useState<Record<string, string>>({});

  // Logos for the approved-sites list, read when it opens.
  useEffect(() => {
    if (!showApproved) return;
    api.listItems(undefined, "login").then((metas) => {
      const byHost: Record<string, string> = {};
      for (const m of metas) if (m.host && m.favicon && !byHost[m.host]) byHost[m.host] = m.favicon;
      setSiteLogos(byHost);
    });
  }, [showApproved]);
  const [logosResult, setLogosResult] = useState<string | null>(null);
  const [autoRefreshIcons, setAutoRefreshIcons] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [storage, setStorage] = useState<VaultStorage | null>(null);
  // Reset is two steps: acknowledge what is about to be destroyed, then
  // prove ownership with the master password.
  const [resetStep, setResetStep] = useState<"warn" | "password">("warn");
  const [security, setSecurity] = useState<SecurityState | null>(null);
  const [recoveryPw, setRecoveryPw] = useState("");
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [showRecoveryForm, setShowRecoveryForm] = useState(false);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [backup, setBackup] = useState<BackupState | null>(null);
  const [backupUrl, setBackupUrl] = useState("");
  const [backupToken, setBackupToken] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupResult, setBackupResult] = useState<string | null>(null);
  const [bridge, setBridge] = useState<BridgeState | null>(null);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  useEffect(() => {
    api.getConfig().then((cfg) => {
      setAutolockMins(cfg.autolock_mins);
      setAutoRefreshIcons(cfg.auto_refresh_icons);
    });
    loadStorage();
    loadSecurity();
    api
      .getBackupConfig()
      .then((b) => {
        setBackup(b);
        setBackupUrl(b.url);
      })
      .catch(() => {});
    loadBridge();
    // Approvals land from the app's dialog or the browser, not from here.
    const unlisten = onBridgeChanged(loadBridge);
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  function loadBridge() {
    api.bridgeState().then(setBridge).catch(() => setBridge(null));
  }

  async function startPairing() {
    setBridgeError(null);
    try {
      setPairCode(await api.bridgePairCode());
    } catch (err: any) {
      setBridgeError(String(err));
    }
  }

  async function stopPairing() {
    setPairCode(null);
    await api.bridgeCancelPairing().catch(() => {});
    loadBridge();
  }

  // The extension pairs against the running app, not against this screen, so
  // nothing here would ever notice it worked. Poll while a code is on
  // display and dismiss it the moment a new browser turns up, otherwise the
  // only way out of this panel is a button that silently kills the code.
  useEffect(() => {
    if (!pairCode) return;
    const before = bridge?.clients.length ?? 0;
    const id = window.setInterval(async () => {
      try {
        const next = await api.bridgeState();
        setBridge(next);
        if (next.clients.length > before) setPairCode(null);
      } catch {
        // transient IPC hiccup; next tick retries
      }
    }, 1500);
    return () => window.clearInterval(id);
  }, [pairCode]);

  async function unpair(origin: string) {
    setBridgeError(null);
    try {
      await api.bridgeUnpair(origin);
      loadBridge();
    } catch (err: any) {
      setBridgeError(String(err));
    }
  }

  const approvedTotal = (bridge?.clients ?? []).reduce(
    (n, c) => n + c.allowed_hosts.length,
    0
  );

  /** Take one site's approval back. The browser stays paired. */
  async function revokeHost(origin: string, host: string) {
    setBridgeError(null);
    try {
      await api.bridgeRevokeHost(origin, host);
      loadBridge();
    } catch (err: any) {
      setBridgeError(String(err));
    }
  }

  function loadSecurity() {
    api
      .securityState()
      .then(setSecurity)
      .catch(() => setSecurity(null));
  }

  async function issueRecoveryCode(e: React.FormEvent) {
    e.preventDefault();
    setRecoveryError(null);
    setRecoveryBusy(true);
    try {
      const code = await api.createRecoveryCode(recoveryPw);
      setRecoveryCode(code);
      setRecoveryPw("");
      setShowRecoveryForm(false);
      loadSecurity();
      loadStorage();
    } catch (err: any) {
      setRecoveryError(String(err));
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwDone(false);
    if (pwNext.length < 8) {
      setPwError("New password must be at least 8 characters.");
      return;
    }
    if (pwNext !== pwConfirm) {
      setPwError("New passwords do not match.");
      return;
    }
    setPwBusy(true);
    try {
      // A fresh vault key means the old recovery code no longer opens it;
      // the new one comes back here and goes straight on screen.
      const code = await api.changeMasterPassword(pwCurrent, pwNext);
      if (code) setRecoveryCode(code);
      setPwCurrent("");
      setPwNext("");
      setPwConfirm("");
      setPwDone(true);
      loadStorage();
    } catch (err: any) {
      setPwError(String(err));
    } finally {
      setPwBusy(false);
    }
  }

  function loadStorage() {
    api
      .vaultStorage()
      .then(setStorage)
      .catch(() => setStorage(null));
  }

  useHotkey("escape", () => closeReset(), showResetModal);

  function closeReset() {
    setShowResetModal(false);
    setResetStep("warn");
    setResetPassword("");
    setResetError(null);
  }

  async function saveAutolock() {
    setBusy(true);
    try {
      await api.setAutolockMins(autolockMins);
    } finally {
      setBusy(false);
    }
  }

  async function refreshLogos() {
    setLogosBusy(true);
    setLogosResult(null);
    try {
      const [updated, checked] = await refreshSiteLogos(true, (done, total) => setLogosProgress([done, total]));
      setLogosResult(`Updated ${updated} of ${checked} login logos.`);
    } finally {
      setLogosBusy(false);
      setLogosProgress(null);
    }
  }

  // Saved immediately rather than behind a Save button: it is one privacy
  // choice, and a toggle that silently needs confirming is the kind that ends
  // up on when the user believes it is off.
  async function saveAutoRefreshIcons(on: boolean) {
    setAutoRefreshIcons(on);
    try {
      await api.setAutoRefreshIcons(on);
    } catch {
      setAutoRefreshIcons(!on);
    }
  }

  async function exportBackup() {
    setExportError(null);
    let dest: string | null;
    try {
      dest = await save({ defaultPath: "vault-backup.enc" });
    } catch (err) {
      setExportError(`Export failed: ${String(err)}`);
      return;
    }
    if (!dest) return;
    setExportBusy(true);
    setExportResult(null);
    try {
      await api.exportVault(dest);
      setExportResult("Backup saved.");
      loadStorage();
      loadSecurity();
    } catch (err) {
      setExportError(`Export failed: ${String(err)}`);
    } finally {
      setExportBusy(false);
    }
  }

  async function saveBackupSettings() {
    setBackupBusy(true);
    setBackupError(null);
    setBackupResult(null);
    try {
      await api.setBackupConfig(backupUrl.trim(), backupToken.trim() || undefined);
      setBackupToken("");
      setBackup(await api.getBackupConfig());
      setBackupResult("Backup settings saved.");
    } catch (err) {
      setBackupError(String(err));
    } finally {
      setBackupBusy(false);
    }
  }

  async function runBackupNow() {
    setBackupBusy(true);
    setBackupError(null);
    setBackupResult(null);
    try {
      await api.backupNow();
      setBackup(await api.getBackupConfig());
      setBackupResult("Vault uploaded.");
    } catch (err) {
      setBackupError(String(err));
    } finally {
      setBackupBusy(false);
    }
  }

  async function disableBackup() {
    setBackupBusy(true);
    setBackupError(null);
    try {
      await api.clearBackupConfig();
      setBackupUrl("");
      setBackupToken("");
      setBackup(await api.getBackupConfig());
      setBackupResult("Cloud backup turned off.");
    } catch (err) {
      setBackupError(String(err));
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setResetError(null);
    setBusy(true);
    try {
      await api.resetVault(resetPassword, accountId);
      onLock();
    } catch (err: any) {
      setResetError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-[1000px] gap-6 px-6 py-8">
      <SettingsNav
        group={group}
        query={query}
        onQuery={setQuery}
        onGroup={(g) => {
          setQuery("");
          setGroup(g);
        }}
        onSection={goTo}
        searchRef={searchRef}
      />
      <div className="flex min-w-0 max-w-[720px] flex-1 flex-col gap-6">
        <div>
          <h1 className="text-headline-lg text-on-surface">
            {query.trim() ? "Search" : GROUPS.find((g) => g.id === group)!.label}
          </h1>
          <p className="text-body-md text-on-surface-variant">
            {query.trim()
              ? visible.length === 0
                ? `Nothing in Settings matches "${query.trim()}".`
                : `${visible.length} ${visible.length === 1 ? "section matches" : "sections match"} "${query.trim()}".`
              : "Stored only on this device."}
          </p>
        </div>

      {show("autolock") && (
        <section id="settings-autolock" className="scroll-mt-8">
          <div className="card flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2 text-on-surface">
              <ShieldIcon size={16} />
              <h2 className="text-body-md font-semibold">Auto-lock</h2>
            </div>
            <p className="text-body-sm text-on-surface-variant">Lock the vault after this long without activity.</p>
            {/* The value sits above the track: inline, it resizes when the text
                grows to "1 h 30 min" and drags the slider width with it. */}
            <div className="flex flex-col gap-2">
              <span className="label-md self-start rounded-chip bg-surface-container-high px-2 py-1">
                {formatMins(autolockMins)}
              </span>
              <input
                type="range"
                min="15"
                max="90"
                step="5"
                value={autolockMins}
                onChange={(e) => setAutolockMins(Number(e.target.value))}
                aria-label="Auto-lock timeout in minutes"
                className="h-1 w-full appearance-none rounded-full bg-surface-container-high accent-primary"
              />
            </div>
            <button type="button" className="btn-primary self-start" onClick={saveAutolock} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </section>
      )}

      {show("clipboard") && (
        <section id="settings-clipboard" className="scroll-mt-8">
          <div className="card flex flex-col gap-2 p-5">
            <div className="flex items-center gap-2 text-on-surface">
              <SettingsIcon size={16} />
              <h2 className="text-body-md font-semibold">Clipboard</h2>
            </div>
            <p className="text-body-sm text-on-surface-variant">
              Copied secrets clear after 30 seconds. Passwords copied when opening a login clear after 60.
            </p>
          </div>
        </section>
      )}

      {show("logos") && (
        <section id="settings-logos" className="scroll-mt-8">
          <div className="card flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2 text-on-surface">
              <ImageIcon size={16} />
              <h2 className="text-body-md font-semibold">Site logos</h2>
            </div>
            <p className="text-body-sm text-on-surface-variant">
              Logos are fetched when you add a login's URL, then re-checked at most every 30 days —
              each check is a request to that site, so it stays rare. Refresh to re-check all of them now.
            </p>
            <button type="button" className="btn-secondary self-start" onClick={refreshLogos} disabled={logosBusy}>
              {logosBusy && (
                <span
                  aria-hidden
                  className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
                />
              )}
              {logosBusy
                ? logosProgress
                  ? `Refreshing ${logosProgress[0]}/${logosProgress[1]}`
                  : "Refreshing…"
                : "Refresh site logos"}
            </button>
            {logosBusy && logosProgress && logosProgress[1] > 0 && (
              <div
                role="progressbar"
                aria-label="Refreshing site logos"
                aria-valuemin={0}
                aria-valuemax={logosProgress[1]}
                aria-valuenow={logosProgress[0]}
                className="h-1 w-full max-w-[320px] overflow-hidden rounded-full bg-white/8"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${(logosProgress[0] / logosProgress[1]) * 100}%` }}
                />
              </div>
            )}
            {logosResult && <p className="text-body-sm text-on-surface-variant">{logosResult}</p>}

            <label className="flex items-start gap-2 border-t border-white/6 pt-4 text-body-sm text-on-surface">
              <input
                type="checkbox"
                checked={autoRefreshIcons}
                onChange={(e) => saveAutoRefreshIcons(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              Re-check stale logos automatically each time the vault unlocks
            </label>
            <p className="text-body-sm text-on-surface-variant">
              Off by default. Turning it on contacts every site whose logo is over 30 days old, every
              time you unlock — so whoever can see your network (your internet provider, a proxy, or
              anyone on the same Wi-Fi) learns which sites you keep accounts with, and when you opened
              the vault. The sites themselves see a visit too. Nothing from inside the vault is sent,
              and the button above still works with this off.
            </p>
          </div>
        </section>
      )}

      {show("security") && (
        <section id="settings-security" className="scroll-mt-8">
          <div className="card flex flex-col gap-4 p-5">
            <div className="flex items-center gap-2 text-on-surface">
              <KeyIcon size={16} />
              <h2 className="text-body-md font-semibold">Security</h2>
            </div>

            <div className="flex flex-col gap-2 border-b border-white/6 pb-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-body-md text-on-surface">Recovery code</p>
                <span
                  className={`label-sm rounded-chip px-2 py-1 ${
                    security?.has_recovery ? "bg-secondary/15 text-secondary" : "bg-error/15 text-error"
                  }`}
                >
                  {security?.has_recovery ? "Set up" : "Not set up"}
                </span>
              </div>
              <p className="text-body-sm text-on-surface-variant">
                {security?.has_recovery
                  ? "A recovery code can open this vault if you forget the master password. Issuing a new one immediately invalidates the old."
                  : "Without a recovery code, forgetting the master password means losing every item in this vault."}
              </p>
              {showRecoveryForm ? (
                <form onSubmit={issueRecoveryCode} className="flex flex-col gap-2">
                  <p className="label-md">Confirm your master password</p>
                  <input
                    type="password"
                    value={recoveryPw}
                    onChange={(e) => setRecoveryPw(e.target.value)}
                    aria-label="Master password"
                    autoFocus
                    className="field font-mono"
                  />
                  {recoveryError && (
                    <p role="alert" className="text-body-sm text-error">
                      {recoveryError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setShowRecoveryForm(false);
                        setRecoveryPw("");
                        setRecoveryError(null);
                      }}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="btn-primary" disabled={recoveryBusy || !recoveryPw}>
                      {recoveryBusy ? "Generating…" : "Generate code"}
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className="btn-secondary self-start"
                  onClick={() => setShowRecoveryForm(true)}
                >
                  {security?.has_recovery ? "Issue a new code" : "Set up recovery code"}
                </button>
              )}
            </div>

            <form onSubmit={changePassword} className="flex flex-col gap-2">
              <p className="text-body-md text-on-surface">Master password</p>
              <p className="text-body-sm text-on-surface-variant">
                Changing it re-wraps the vault key, so nothing is re-encrypted and your recovery code
                keeps working.
              </p>
              <input
                type="password"
                value={pwCurrent}
                onChange={(e) => setPwCurrent(e.target.value)}
                aria-label="Current master password"
                placeholder="Current password"
                className="field font-mono"
              />
              <input
                type="password"
                value={pwNext}
                onChange={(e) => setPwNext(e.target.value)}
                aria-label="New master password"
                placeholder="New password"
                className="field font-mono"
              />
              <input
                type="password"
                value={pwConfirm}
                onChange={(e) => setPwConfirm(e.target.value)}
                aria-label="Confirm new master password"
                placeholder="Confirm new password"
                className="field font-mono"
              />
              {pwError && (
                <p role="alert" className="text-body-sm text-error">
                  {pwError}
                </p>
              )}
              {pwDone && <p className="text-body-sm text-secondary">Master password changed.</p>}
              <button
                type="submit"
                className="btn-secondary self-start"
                disabled={pwBusy || !pwCurrent || !pwNext || !pwConfirm}
              >
                {pwBusy ? "Changing…" : "Change password"}
              </button>
            </form>
          </div>
        </section>
      )}

      {show("export") && (
        <section id="settings-export" className="scroll-mt-8">
          <div className="card flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2 text-on-surface">
              <DatabaseIcon size={16} />
              <h2 className="text-body-md font-semibold">Backup</h2>
            </div>
            {security && (security.last_export_secs === 0 || daysAgo(security.last_export_secs) >= 30) && (
              <div className="rounded-control border border-warning/30 bg-warning/10 px-3 py-2">
                <p className="text-body-sm text-warning">
                  {security.last_export_secs === 0
                    ? "This vault has never been exported. It exists on one disk only."
                    : `Last backup: ${daysAgo(security.last_export_secs)} days ago.`}
                </p>
              </div>
            )}
            <p className="text-body-sm text-on-surface-variant">
              Save a copy of your encrypted vault file so a lost or replaced device doesn't mean lost
              data. The file only opens with your master password.
            </p>
            <button type="button" className="btn-secondary self-start" onClick={exportBackup} disabled={exportBusy}>
              {exportBusy ? "Exporting…" : "Export vault backup"}
            </button>
            {exportResult && <p className="text-body-sm text-on-surface-variant">{exportResult}</p>}
            {exportError && (
              <p role="alert" className="text-body-sm text-error">
                {exportError}
              </p>
            )}
          </div>
        </section>
      )}

      {show("pairing") && (
        <section id="settings-pairing" className="scroll-mt-8">
          <div className="card flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2 text-on-surface">
              <KeyIcon size={16} />
              <h2 className="text-body-md font-semibold">Paired browsers</h2>
              <span className="text-label-md text-on-surface-variant opacity-70">
                {bridge && bridge.clients.length > 0
                  ? `· ${bridge.clients.length} paired`
                  : "· Not paired"}
              </span>
            </div>

            <p className="text-body-sm text-on-surface-variant">
              Lets the extension fill logins in your browser. The app listens on{" "}
              <code>127.0.0.1:{bridge?.port ?? 38471}</code> — on this machine only, never the
              network. A paired browser can read a login <strong>only for the site it is
              actually on</strong>, and only while this vault is unlocked.
            </p>
            <p className="text-body-sm text-on-surface-variant">
              Pairing lets a browser <em>ask</em>. The first time it wants a password for a site,
              this window asks you, and the site is remembered below — so a stolen pairing cannot
              quietly walk through the vault. There is no shared password between the two: the
              browser signs what it sends with a key it cannot export, and that key is replaced
              hourly and dies after a week unused.
            </p>

            {bridge?.listen_error ? (
              <p role="alert" className="text-body-sm text-error">
                The bridge could not start: {bridge.listen_error}. The extension cannot reach the
                vault until that port is free.
              </p>
            ) : null}

            {pairCode ? (
              <div className="flex flex-col gap-2">
                <span className="label-md">Type this into the extension</span>
                <code className="field flex items-center font-mono text-headline-sm tracking-[0.35em] text-primary">
                  {pairCode}
                </code>
                <p className="text-body-sm text-on-surface-variant">
                  Good for three minutes, once. Three wrong tries and it is dead — ask for another.
                  This panel closes itself as soon as the browser pairs.
                </p>
                <button type="button" className="btn-secondary self-start" onClick={stopPairing}>
                  Cancel pairing
                </button>
              </div>
            ) : (
              <button type="button" className="btn-secondary self-start" onClick={startPairing}>
                Pair a browser
              </button>
            )}

            {bridge && bridge.clients.length > 0 && (
              <ul className="flex flex-col gap-2">
                {bridge.clients.map((c) => (
                  <li
                    key={c.origin}
                    className="flex flex-col gap-2 rounded-control border border-white/8 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 flex-col">
                        <span className="text-body-sm text-on-surface">{c.label}</span>
                        <span className="truncate font-mono text-label-md text-on-surface-variant">
                          {c.origin}
                        </span>
                      </span>
                      <button type="button" className="btn-secondary" onClick={() => unpair(c.origin)}>
                        Unpair
                      </button>
                    </div>
                    {c.port !== bridge.port && (
                      <span role="alert" className="text-body-sm text-warning">
                        Paired while the app was on port {c.port}; it is on {bridge.port} now. Pair
                        this browser again to reconnect it.
                      </span>
                    )}
                    <span className="text-label-md text-on-surface-variant opacity-70">
                      {c.allowed_hosts.length === 0
                        ? "No sites approved yet — it will ask on the first fill."
                        : `Approved for ${c.allowed_hosts.length} ${
                            c.allowed_hosts.length === 1 ? "site" : "sites"
                          }.`}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {bridgeError && (
              <p role="alert" className="text-body-sm text-error">
                {bridgeError}
              </p>
            )}
          </div>
        </section>
      )}

      {show("features") && (
        <section id="settings-features" className="scroll-mt-8">
          <BrowserFeatures />
        </section>
      )}

      {show("approved") && (
        <section id="settings-approved" className="scroll-mt-8">
          {/* Its own card rather than a row of chips inside the pairing panel.
              The list only grows — one entry per site you ever log into — and a
              growing list tucked under something else is one nobody reads. */}
          <div className="card flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2 text-on-surface">
              <ShieldIcon size={16} />
              <h2 className="text-body-md font-semibold">Approved sites</h2>
              <span className="text-label-md text-on-surface-variant opacity-70">
                · {approvedTotal} {approvedTotal === 1 ? "site" : "sites"}
              </span>
            </div>

            <p className="text-body-sm text-on-surface-variant">
              Pairing lets a browser <em>ask</em>; this is what it may be answered for. A site lands
              here when you say yes to the dialog this window raises, and revoking one puts it back
              to asking.
            </p>

            <button
              type="button"
              className="btn-secondary self-start"
              onClick={() => setShowApproved(true)}
              disabled={(bridge?.clients.length ?? 0) === 0}
            >
              {approvedTotal === 0 ? "See the list" : "See all approved sites"}
            </button>

            {(bridge?.clients.length ?? 0) === 0 && (
              <p className="text-body-sm text-on-surface-variant opacity-70">
                Nothing to show until a browser is paired.
              </p>
            )}
          </div>
        </section>
      )}

      {show("never") && (
        <section id="settings-never" className="scroll-mt-8">
          <NeverSaveSites />
        </section>
      )}

      {show("cloud") && (
        <section id="settings-cloud" className="scroll-mt-8">
          <div className="card flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2 text-on-surface">
              <CloudIcon size={16} />
              <h2 className="text-body-md font-semibold">Cloud backup</h2>
              <span
                className={
                  backup?.configured
                    ? "text-label-md text-on-surface-variant"
                    : "text-label-md text-on-surface-variant opacity-70"
                }
              >
                {backup?.configured ? "· On" : "· Not configured"}
              </span>
            </div>

            {!backup?.configured && (
              <p className="text-body-sm text-on-surface-variant">
                <strong>Off.</strong> Nothing leaves this device. Setting it up needs a Cloudflare
                account with R2 enabled — see <code>worker/README.md</code>. Until then, use{" "}
                <strong>Export vault backup</strong> above and keep the file somewhere else.
              </p>
            )}

            <p className="text-body-sm text-on-surface-variant">
              Keeps an encrypted copy in your own Cloudflare account, uploaded when this vault locks
              after a change. It is a copy, not a sync — editing the same vault on two machines is not
              supported.
            </p>
            <p className="text-body-sm text-on-surface-variant">
              Your <strong>master password is still required</strong> to open a restored vault. This is
              not account recovery and does not help with a forgotten password — your recovery code
              does that. Because a downloaded copy can be attacked offline, a strong master password
              matters more once this is on.
            </p>
            <p className="text-body-sm text-on-surface-variant">
              Paste the <strong>upload</strong> token below. It can upload but not download, which is
              why there are two. The app <strong>never stores your download token</strong> — keep that
              one with your recovery code, or the backup cannot be retrieved.
            </p>
            <p className="text-body-sm text-on-surface-variant">
              History is kept for 30 days; the latest copy never expires. Turning backup off only stops
              future uploads — it does not delete anything already in the cloud.
            </p>

            <label className="flex flex-col gap-1">
              <span className="label-md">Worker URL</span>
              <input
                type="url"
                value={backupUrl}
                onChange={(e) => setBackupUrl(e.target.value)}
                placeholder="https://vault-backup.you.workers.dev"
                className="field font-mono"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="label-md">Upload token</span>
              <input
                type="password"
                value={backupToken}
                onChange={(e) => setBackupToken(e.target.value)}
                placeholder={backup?.configured ? "Saved — leave blank to keep it, or enter a new one" : ""}
                className="field font-mono"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary self-start"
                onClick={saveBackupSettings}
                disabled={backupBusy || !backupUrl.trim() || (!backupToken.trim() && !backup?.configured)}
              >
                Save backup settings
              </button>
              {backup?.configured && (
                <>
                  <button
                    type="button"
                    className="btn-secondary self-start"
                    onClick={runBackupNow}
                    disabled={backupBusy}
                  >
                    {backupBusy ? "Uploading…" : "Back up now"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary self-start"
                    onClick={disableBackup}
                    disabled={backupBusy}
                  >
                    Turn off
                  </button>
                </>
              )}
            </div>

            {backup?.configured && (
              <p className="text-body-sm text-on-surface-variant">
                {backup.last_backup_secs === 0
                  ? "Never uploaded yet."
                  : `Last upload: ${daysAgo(backup.last_backup_secs)} days ago.`}
              </p>
            )}
            {/* Persisted from the last auto/manual attempt (e.g. an upload on lock
                that failed silently while no one was looking at this screen), so
                it stays visible on load even if the current session did nothing
                wrong. Suppressed once a fresh attempt below has its own result. */}
            {backup?.configured && backup.last_backup_error && !backupError && !backupResult && (
              <p role="alert" className="text-body-sm text-error">
                Last upload attempt failed: {backup.last_backup_error} (this may not reflect the
                current status — try "Back up now" to check).
              </p>
            )}
            {backupResult && <p className="text-body-sm text-on-surface-variant">{backupResult}</p>}
            {backupError && (
              <p role="alert" className="text-body-sm text-error">
                {backupError}
              </p>
            )}
          </div>
        </section>
      )}

      {show("storage") && (
        <section id="settings-storage" className="scroll-mt-8">
          <div className="card flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2 text-on-surface">
              <DatabaseIcon size={16} />
              <h2 className="text-body-md font-semibold">Storage</h2>
            </div>
            {storage ? (
              <dl className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="label-md">Database size</dt>
                  <dd className="font-mono text-body-sm text-on-surface">{formatBytes(storage.bytes)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="label-md">Last saved</dt>
                  <dd className="font-mono text-body-sm text-on-surface">
                    {storage.modified_secs ? new Date(storage.modified_secs * 1000).toLocaleString() : "—"}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="label-md">File</dt>
                  <dd className="break-all font-mono text-body-sm text-on-surface-variant">{storage.path}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-body-sm text-on-surface-variant">Vault file details unavailable.</p>
            )}
          </div>
        </section>
      )}

      {show("danger") && (
        <section id="settings-danger" className="scroll-mt-8">
          <div className="rounded-panel border border-error/30 bg-error/5 p-5">
            <h2 className="text-body-md font-semibold text-error">Danger zone</h2>
            <p className="mt-1 text-body-sm text-on-surface-variant">
              Permanently delete all items and reset the master password. This cannot be undone.
            </p>
            <button type="button" className="btn-danger mt-3" onClick={() => setShowResetModal(true)}>
              Reset vault
            </button>
          </div>
        </section>
      )}
      </div>

      {recoveryCode && (
        <RecoveryCodeDialog code={recoveryCode} onDone={() => setRecoveryCode(null)} />
      )}

      {showApproved && (
        <ApprovedSites
          clients={bridge?.clients ?? []}
          logos={siteLogos}
          onRevoke={revokeHost}
          onClose={() => setShowApproved(false)}
        />
      )}

      {showResetModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5"
          onClick={closeReset}
        >
          <div className="dialog dialog-danger flex w-full max-w-[420px] flex-col gap-4 p-6" onClick={(e) => e.stopPropagation()}>
            <p className="label-sm text-error">Reset · Step {resetStep === "warn" ? "1" : "2"} of 2</p>
            <h2 className="text-headline-sm text-error">Reset vault?</h2>
            {resetStep === "warn" ? (
            <>
              <p className="text-body-sm text-on-surface-variant">
                Every login, note and card in this vault is deleted permanently, and the master
                password is cleared. There is no undo and no recovery — export a backup first if you
                want to keep the data.
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={closeReset}>
                  <XIcon size={14} /> Cancel
                </button>
                <button type="button" className="btn-danger" onClick={() => setResetStep("password")}>
                  Continue
                </button>
              </div>
            </>
            ) : (
            <form onSubmit={handleReset} className="flex flex-col gap-4">
              <p className="text-body-sm text-on-surface-variant">
                Enter your current master password to confirm.
              </p>
              <input
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder="Master password"
                aria-label="Master password"
                autoFocus
                className="field font-mono"
              />
              {resetError && (
                <p role="alert" className="text-body-sm text-error">
                  {resetError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => setResetStep("warn")}>
                  Back
                </button>
                <button type="submit" className="btn-danger" disabled={busy || !resetPassword}>
                  {busy ? "Resetting…" : "Reset vault"}
                </button>
              </div>
            </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

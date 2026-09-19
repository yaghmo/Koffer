import { useState, useEffect } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/api";
import { refreshSiteLogos } from "../lib/logos";
import type { BackupState, SecurityState, VaultStorage } from "../lib/types";
import { SettingsIcon, ShieldIcon, ImageIcon, XIcon, DatabaseIcon, KeyIcon, CloudIcon } from "../components/Icon";
import RecoveryCodeDialog from "../components/RecoveryCodeDialog";
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

export default function Settings({ accountId, onLock }: Props) {
  const [autolockMins, setAutolockMins] = useState(15);
  const [busy, setBusy] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [logosBusy, setLogosBusy] = useState(false);
  const [logosResult, setLogosResult] = useState<string | null>(null);
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

  useEffect(() => {
    api.getConfig().then((cfg) => setAutolockMins(cfg.autolock_mins));
    loadStorage();
    loadSecurity();
    api
      .getBackupConfig()
      .then((b) => {
        setBackup(b);
        setBackupUrl(b.url);
      })
      .catch(() => {});
  }, []);

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
      await api.changeMasterPassword(pwCurrent, pwNext);
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
      const [updated, checked] = await refreshSiteLogos(true);
      setLogosResult(`Updated ${updated} of ${checked} login logos.`);
    } finally {
      setLogosBusy(false);
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
    <div className="mx-auto flex max-w-[720px] flex-col gap-6 px-8 py-8">
      <div>
        <p className="label-sm">Settings</p>
        <h1 className="text-headline-lg text-on-surface">Vault settings</h1>
        <p className="text-body-md text-on-surface-variant">Stored only on this device.</p>
      </div>

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

      <div className="card flex flex-col gap-2 p-5">
        <div className="flex items-center gap-2 text-on-surface">
          <SettingsIcon size={16} />
          <h2 className="text-body-md font-semibold">Clipboard</h2>
        </div>
        <p className="text-body-sm text-on-surface-variant">
          Copied secrets clear after 30 seconds. Passwords copied when opening a login clear after 60.
        </p>
      </div>

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
          {logosBusy ? "Refreshing…" : "Refresh site logos"}
        </button>
        {logosResult && <p className="text-body-sm text-on-surface-variant">{logosResult}</p>}
      </div>

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

      <div className="card flex flex-col gap-3 p-5">
        <div className="flex items-center gap-2 text-on-surface">
          <CloudIcon size={16} />
          <h2 className="text-body-md font-semibold">Cloud backup</h2>
        </div>

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

      <div className="rounded-panel border border-error/30 bg-error/5 p-5">
        <h2 className="text-body-md font-semibold text-error">Danger zone</h2>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          Permanently delete all items and reset the master password. This cannot be undone.
        </p>
        <button type="button" className="btn-danger mt-3" onClick={() => setShowResetModal(true)}>
          Reset vault
        </button>
      </div>

      {recoveryCode && (
        <RecoveryCodeDialog code={recoveryCode} onDone={() => setRecoveryCode(null)} />
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

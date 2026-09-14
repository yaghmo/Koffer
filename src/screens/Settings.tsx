import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { SettingsIcon, ShieldIcon, ImageIcon, XIcon } from "../components/Icon";
import { useHotkey } from "../lib/useHotkey";

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

  useEffect(() => {
    api.getConfig().then((cfg) => setAutolockMins(cfg.autolock_mins));
  }, []);

  useHotkey("escape", () => setShowResetModal(false), showResetModal);

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
      const metas = await api.listItems(undefined, "login");
      let updated = 0;
      for (const meta of metas) {
        const full = await api.getItem(meta.id);
        if (full.type !== "login" || !full.url) continue;
        try {
          const fetched = await api.fetchUrlMetadata(full.url);
          if (fetched.favicon_data_url) {
            await api.saveItem({ ...full, favicon: fetched.favicon_data_url });
            updated++;
          }
        } catch {
          // one site failing (offline, no favicon) shouldn't stop the rest
        }
      }
      setLogosResult(`Updated ${updated} of ${metas.length} login logos.`);
    } finally {
      setLogosBusy(false);
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
        <p className="text-body-sm text-on-surface-variant">Lock the vault after this many minutes of inactivity.</p>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min="15"
            max="30"
            value={autolockMins}
            onChange={(e) => setAutolockMins(Number(e.target.value))}
            aria-label="Auto-lock timeout in minutes"
            className="h-1 flex-1 appearance-none rounded-full bg-surface-container-high accent-primary"
          />
          <span className="label-md rounded-chip bg-surface-container-high px-2 py-1">{autolockMins} min</span>
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
          Logos are fetched once when you add a login's URL. Re-fetch all of them if a site has since
          changed its icon.
        </p>
        <button type="button" className="btn-secondary self-start" onClick={refreshLogos} disabled={logosBusy}>
          {logosBusy ? "Refreshing…" : "Refresh site logos"}
        </button>
        {logosResult && <p className="text-body-sm text-on-surface-variant">{logosResult}</p>}
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

      {showResetModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5"
          onClick={() => setShowResetModal(false)}
        >
          <div className="dialog dialog-danger flex w-full max-w-[420px] flex-col gap-4 p-6" onClick={(e) => e.stopPropagation()}>
            <p className="label-sm text-error">Reset · Confirm</p>
            <h2 className="text-headline-sm text-error">Reset vault?</h2>
            <p className="text-body-sm text-on-surface-variant">
              This will permanently delete all items. Enter your current master password to confirm.
            </p>
            <form onSubmit={handleReset} className="flex flex-col gap-4">
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
                <button type="button" className="btn-secondary" onClick={() => setShowResetModal(false)}>
                  <XIcon size={14} /> Cancel
                </button>
                <button type="submit" className="btn-danger" disabled={busy || !resetPassword}>
                  {busy ? "Resetting…" : "Reset vault"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

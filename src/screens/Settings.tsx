import { useState, useEffect } from "react";
import { api } from "../lib/api";

export default function Settings() {
  const [autolockMins, setAutolockMins] = useState(15);
  const [busy, setBusy] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);

  useEffect(() => {
    api.getConfig().then((cfg) => setAutolockMins(cfg.autolock_mins));
  }, []);

  async function saveAutolock() {
    setBusy(true);
    try {
      await api.setAutolockMins(autolockMins);
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setResetError(null);
    setBusy(true);
    try {
      await api.resetVault(resetPassword);
      window.location.reload();
    } catch (err: any) {
      setResetError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings">
      <div className="settings-header">
        <div>
          <p className="screen-eyebrow">Settings</p>
          <h1 className="screen-title">Vault preferences</h1>
        </div>
      </div>

      <div className="settings-section">
        <h2 className="settings-heading">Auto-lock</h2>
        <p className="settings-description">
          Lock the vault after this many minutes of inactivity.
        </p>
        <div className="settings-control">
          <input
            type="range"
            min="15"
            max="30"
            value={autolockMins}
            onChange={(e) => setAutolockMins(Number(e.target.value))}
            aria-label="Auto-lock timeout in minutes"
          />
          <p className="settings-value">{autolockMins} minutes</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={saveAutolock}
          disabled={busy}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="settings-section">
        <h2 className="settings-heading">Reset vault</h2>
        <p className="settings-description">
          Permanently delete all items and reset the master password. This cannot be undone.
        </p>
        <button
          className="btn btn-danger"
          onClick={() => setShowResetModal(true)}
        >
          Reset vault
        </button>
      </div>

      {showResetModal && (
        <div className="modal-backdrop" onClick={() => setShowResetModal(false)}>
          <div className="modal modal-danger" onClick={(e) => e.stopPropagation()}>
            <p className="modal-meta">Reset · Confirm</p>
            <h2>Reset vault?</h2>
            <p>
              This will permanently delete all {" "}
              items. Enter your current master password to confirm.
            </p>
            <form onSubmit={handleReset}>
              <div className="field">
                <div className="field-row">
                  <input
                    type="password"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    placeholder="Master password"
                    aria-label="Master password"
                    autoFocus
                  />
                </div>
              </div>
              {resetError && <p className="error" role="alert">{resetError}</p>}
              <div className="actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowResetModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-danger"
                  disabled={busy || !resetPassword}
                >
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

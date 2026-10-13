import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/api";
import type { Account } from "../lib/types";
import { EyeIcon, EyeOffIcon, PlusIcon, LockIcon, UnlockIcon, CheckIcon } from "../components/Icon";
import { useHotkey } from "../lib/useHotkey";

interface Props {
  accounts: Account[];
  onUnlocked: (account: Account) => void;
  onAddNew: () => void;
  onImported?: () => void | Promise<void>;
}

export default function AccountLock({ accounts, onUnlocked, onAddNew, onImported }: Props) {
  const [selectedId, setSelectedId] = useState<string>(accounts[0]?.id ?? "");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [importPath, setImportPath] = useState<string | null>(null);
  const [importName, setImportName] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  // Restore-from-cloud flow, reached from "Restore from cloud".
  const [restoring, setRestoring] = useState(false);
  const [restoreUrl, setRestoreUrl] = useState("");
  const [restoreToken, setRestoreToken] = useState("");
  const [restoreName, setRestoreName] = useState("");
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  // Recovery-code flow, reached from "Forgot your master password?".
  const [recovering, setRecovering] = useState(false);
  const [code, setCode] = useState("");
  const [newPw, setNewPw] = useState("");
  const [recoverBusy, setRecoverBusy] = useState(false);
  // Set right when we explicitly select a just-imported account, before the
  // parent's `accounts` prop has caught up (its refetch is an async IPC
  // round-trip). Cleared once `accounts` actually contains that id. Lets the
  // repair effect below tell "stale prop, wait for it" apart from "this
  // selection is genuinely gone" instead of reverting a deliberate selection
  // out from under the user.
  const pendingSelectionRef = useRef<string | null>(null);
  // Latest `accounts` value, kept current on every render so `confirmImport`
  // (a closure captured at the render it started in) can check the fresh
  // list after awaiting `onImported`, even if a prop update happened in the
  // meantime and this instance's `accounts` binding is now stale.
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  useHotkey("escape", () => setSwitcherOpen(false), switcherOpen);
  useHotkey("escape", () => setRecovering(false), recovering && !switcherOpen);
  useHotkey("escape", () => setRestoring(false), restoring && !switcherOpen);

  async function submitRecovery(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setError(null);
    setRecoverBusy(true);
    try {
      await api.recoverVault(code, newPw, selected.id);
      setCode("");
      setNewPw("");
      setRecovering(false);
      onUnlocked(selected);
    } catch (err: any) {
      setError(String(err));
    } finally {
      setRecoverBusy(false);
    }
  }

  // After a delete (or any account list change), drop a selection that no
  // longer exists and reset the form. Without this the deleted vault keeps
  // showing as "selected" until the user picks another one.
  useEffect(() => {
    if (accounts.some((a) => a.id === selectedId)) {
      if (pendingSelectionRef.current === selectedId) pendingSelectionRef.current = null;
      return;
    }
    if (pendingSelectionRef.current === selectedId) return;
    setSelectedId(accounts[0]?.id ?? "");
    setPw("");
    setError(null);
  }, [accounts, selectedId]);

  const selected = accounts.find((a) => a.id === selectedId);

  function pickAccount(id: string) {
    pendingSelectionRef.current = null;
    setSelectedId(id);
    setPw("");
    setError(null);
    setSwitcherOpen(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setError(null);
    setBusy(true);
    try {
      await api.unlockVault(pw, selected.id);
      onUnlocked(selected);
    } catch {
      setError("Wrong password. Try again.");
      setPw("");
    } finally {
      setBusy(false);
    }
  }

  async function pickImportFile() {
    try {
      const path = await open({ multiple: false });
      if (typeof path === "string") {
        setImportPath(path);
        setImportName("");
        setImportError(null);
      }
    } catch (err) {
      setImportError(String(err));
    }
  }

  async function confirmImport(e: React.FormEvent) {
    e.preventDefault();
    if (!importPath) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const result = await api.importVault(importPath, importName);
      setImportPath(null);
      pendingSelectionRef.current = result.id;
      setSelectedId(result.id);
      await onImported?.();
      // onImported's own refresh may have silently failed (it swallows its
      // error) and never landed `result.id` in `accounts`. Don't leave the
      // pending ref suppressing the repair effect forever in that case —
      // neither `accounts` nor `selectedId` will change again on their own
      // to make that effect re-run, so restore a valid selection right here
      // instead of waiting on an update that may never come.
      if (pendingSelectionRef.current === result.id && !accountsRef.current.some((a) => a.id === result.id)) {
        pendingSelectionRef.current = null;
        setSelectedId(accountsRef.current[0]?.id ?? "");
      }
    } catch (err) {
      setImportError(String(err));
    } finally {
      setImportBusy(false);
    }
  }

  async function confirmRestore(e: React.FormEvent) {
    e.preventDefault();
    setRestoreBusy(true);
    setRestoreError(null);
    try {
      const result = await api.restoreFromCloud(
        restoreUrl.trim(),
        restoreToken.trim(),
        restoreName.trim()
      );
      setRestoring(false);
      setRestoreUrl("");
      setRestoreToken("");
      setRestoreName("");
      pendingSelectionRef.current = result.id;
      setSelectedId(result.id);
      await onImported?.();
      // Same guard as confirmImport: onImported's refresh may swallow its own
      // error and never land `result.id` in `accounts`. Don't leave the
      // pending ref suppressing the repair effect forever in that case.
      if (pendingSelectionRef.current === result.id && !accountsRef.current.some((a) => a.id === result.id)) {
        pendingSelectionRef.current = null;
        setSelectedId(accountsRef.current[0]?.id ?? "");
      }
    } catch (err) {
      setRestoreError(String(err));
    } finally {
      setRestoreBusy(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center p-6">
      <div className="flex w-full max-w-[360px] flex-col gap-6">

        {restoring ? (
          <form onSubmit={confirmRestore} className="flex w-full flex-col gap-4">
            <div>
              <h1 className="text-headline-lg text-on-surface">Restore from cloud</h1>
              <p className="mt-1 text-body-sm text-on-surface-variant">
                Downloads the newest backup from your Worker and{" "}
                <strong className="text-on-surface">adds it as a new vault</strong>. Nothing on
                this device is overwritten.
              </p>
              <p className="mt-2 text-body-sm text-on-surface-variant">
                It will back up to that <strong className="text-on-surface">same bucket</strong>{" "}
                once unlocked. If you keep both vaults, turn cloud backup off in one.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="label-md">Worker URL</p>
              <input
                type="url"
                value={restoreUrl}
                onChange={(e) => setRestoreUrl(e.target.value)}
                aria-label="Worker URL"
                autoFocus
                spellCheck={false}
                autoComplete="off"
                className="field"
              />
            </div>
            <div className="flex flex-col gap-1">
              <p className="label-md">Download token</p>
              <input
                type="password"
                value={restoreToken}
                onChange={(e) => setRestoreToken(e.target.value)}
                aria-label="Download token"
                spellCheck={false}
                autoComplete="off"
                className="field font-mono"
              />
            </div>
            <div className="flex flex-col gap-1">
              <p className="label-md">Name</p>
              <input
                type="text"
                value={restoreName}
                onChange={(e) => setRestoreName(e.target.value)}
                aria-label="Name"
                className="field"
              />
              {restoreError && (
                <p role="alert" className="text-body-sm text-error">
                  {restoreError}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary flex-1" onClick={() => setRestoring(false)}>
                Back
              </button>
              <button
                type="submit"
                className="btn-primary flex-1"
                disabled={
                  restoreBusy || !restoreUrl.trim() || !restoreToken.trim() || !restoreName.trim()
                }
              >
                {restoreBusy ? "Restoring…" : "Restore"}
              </button>
            </div>
          </form>
        ) : !selected ? (
          <div className="flex w-full flex-col gap-4">
            <h1 className="text-headline-lg text-on-surface">No vaults exist on this device</h1>
            <button type="button" className="btn-primary w-full" onClick={onAddNew}>
              <PlusIcon size={16} /> Create one
            </button>
          </div>
        ) : recovering ? (
          <form onSubmit={submitRecovery} className="flex w-full flex-col gap-4">
            <div>
              <h1 className="text-headline-lg text-on-surface">Unlock with your recovery code</h1>
              <p className="mt-1 text-body-sm text-on-surface-variant">
                Enter the code issued when this vault was created, then choose a new master
                password. The recovery code itself keeps working afterwards.
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <p className="label-md">Recovery code</p>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                aria-label="Recovery code"
                autoFocus
                spellCheck={false}
                autoComplete="off"
                placeholder="K7F2Q 9MRXB 4TWHE 3NYD8 P6VJS 2GZK5"
                className="field font-mono tracking-wider"
              />
            </div>

            <div className="flex flex-col gap-1">
              <p className="label-md">New master password</p>
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                aria-label="New master password"
                spellCheck={false}
                autoComplete="new-password"
                className="field font-mono"
              />
            </div>

            {error && (
              <p role="alert" className="text-body-sm text-error">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary flex-1"
                onClick={() => {
                  setRecovering(false);
                  setError(null);
                }}
              >
                Back
              </button>
              <button
                type="submit"
                className="btn-primary flex-1"
                disabled={recoverBusy || !code.trim() || newPw.length < 8}
              >
                {recoverBusy ? "Recovering…" : "Recover vault"}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={submit} className="flex w-full flex-col gap-4">
            <h1 className="mb-2 text-headline-lg text-on-surface">Unlock your vault</h1>
            <div className="flex flex-col gap-1">
              <p className="label-md">Vault</p>
              <div className="flex items-center justify-between gap-3 rounded-control border border-outline-variant px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-body-md font-medium text-on-surface">{selected.name}</p>
                  <p className="label-md">Local vault on this device</p>
                </div>
                {accounts.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setSwitcherOpen(true)}
                    aria-haspopup="dialog"
                    className="btn-secondary shrink-0"
                  >
                    Switch
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <p className="label-md">Master password</p>
              <div className="relative flex items-center">
                <LockIcon size={16} className="pointer-events-none absolute left-3 text-outline" />
                <input
                  type={show ? "text" : "password"}
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  autoFocus
                  aria-label="Master password"
                  spellCheck={false}
                  autoComplete="off"
                  className="field pl-9 pr-10 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? "Hide password" : "Show password"}
                  aria-pressed={show}
                  title={show ? "Hide password" : "Show password"}
                  className="absolute right-2 text-outline transition-colors duration-150 ease-out hover:text-on-surface"
                >
                  {show ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                </button>
              </div>
              {error && (
                <p role="alert" className="text-body-sm text-error">
                  {error}
                </p>
              )}
            </div>

            <button type="submit" className="btn-primary w-full" disabled={busy || !pw}>
              <UnlockIcon size={16} />
              {busy ? "Unlocking…" : "Unlock"}
            </button>

            <button
              type="button"
              onClick={() => {
                setRecovering(true);
                setError(null);
              }}
              disabled={busy}
              className="link self-start"
            >
              Forgot your master password?
            </button>
          </form>
        )}

        {!restoring && (
          <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-outline-variant pt-4">
            {selected && !recovering && (
              <button type="button" onClick={onAddNew} disabled={busy} className="link">
                Add another vault
              </button>
            )}
            <button type="button" onClick={pickImportFile} className="link">
              Import vault
            </button>
            <button
              type="button"
              onClick={() => {
                setRestoring(true);
                setImportPath(null);
              }}
              className="link"
            >
              Restore from cloud
            </button>
          </div>
        )}

        {!importPath && importError && (
          <p role="alert" className="text-body-sm text-error">
            {importError}
          </p>
        )}

        {importPath && (
          <form onSubmit={confirmImport} className="flex w-full flex-col gap-4 border-t border-outline-variant pt-4">
            <div className="flex flex-col gap-1">
              <p className="label-md">Vault name</p>
              <input
                type="text"
                value={importName}
                onChange={(e) => setImportName(e.target.value)}
                aria-label="Vault name"
                autoFocus
                className="field"
              />
              {importError && (
                <p role="alert" className="text-body-sm text-error">
                  {importError}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setImportPath(null)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={importBusy || !importName.trim()}>
                {importBusy ? "Importing…" : "Import"}
              </button>
            </div>
          </form>
        )}

        {!restoring && selected && (
          <p className="text-body-sm text-on-surface-variant">
            Encrypted on this device with Argon2id and AES-256-GCM.
          </p>
        )}
      </div>

      {switcherOpen && accounts.length > 1 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
          onClick={() => setSwitcherOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Switch vault"
            className="dialog flex w-full max-w-[380px] flex-col gap-3 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-headline-sm text-on-surface">Choose a vault</h2>
            <div className="flex flex-col gap-1">
              {accounts.map((a) => {
                const isCurrent = a.id === selectedId;
                return (
                  <button
                    key={a.id}
                    type="button"
                    disabled={isCurrent}
                    onClick={() => pickAccount(a.id)}
                    className={`flex items-center justify-between gap-3 rounded-control px-3 py-2 text-left text-body-sm transition-colors duration-150 ease-out ${
                      isCurrent
                        ? "cursor-default text-on-surface-variant"
                        : "text-on-surface hover:bg-surface-container-high"
                    }`}
                  >
                    {a.name}
                    {isCurrent && (
                      <span className="label-md flex items-center gap-1">
                        <CheckIcon size={14} /> Current
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

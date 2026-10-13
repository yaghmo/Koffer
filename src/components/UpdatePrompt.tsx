import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { logUi } from "../lib/log";
import ConfirmDialog from "./ConfirmDialog";

/** Asks once per launch whether to install a newer build. Saying no costs
 *  nothing: the same question comes back the next time the app starts. */
export default function UpdatePrompt() {
  const [version, setVersion] = useState<string | null>(null);
  // The line shown after "Update": progress, then the reason if it failed.
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    // A failed check is not the user's problem: offline is a normal way to
    // run this app, so it goes to the log and nowhere else.
    api
      .checkUpdate()
      .then(setVersion)
      .catch((e) => logUi("warn", "update", `check failed: ${String(e)}`));
  }, []);

  if (status !== null) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center px-6"
      >
        <p className="dialog max-w-[420px] px-4 py-2 text-center text-body-sm text-on-surface">{status}</p>
      </div>
    );
  }
  if (version === null) return null;

  return (
    <ConfirmDialog
      title={`Update to Koffer ${version}?`}
      message="Koffer downloads the new version, checks its signature, then closes and reopens. Your vault stays as it is, and you unlock it again afterwards."
      confirmLabel="Update"
      cancelLabel="Not now"
      tone="primary"
      onConfirm={() => {
        setStatus("Downloading the update. Koffer restarts when it is ready.");
        api.installUpdate().catch((e) => {
          logUi("warn", "update", `install failed: ${String(e)}`);
          setStatus(`The update could not be installed: ${String(e)}. Koffer offers it again the next time it starts.`);
          window.setTimeout(() => {
            setStatus(null);
            setVersion(null);
          }, 8000);
        });
      }}
      onCancel={() => setVersion(null)}
    />
  );
}

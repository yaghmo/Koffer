import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ShieldIcon, XIcon } from "./Icon";

/**
 * Sites where the user clicked "Never for this site" on the extension's save
 * bar. Removing one lets that site offer again.
 */
export default function NeverSaveSites() {
  const [hosts, setHosts] = useState<string[] | null>(null);

  useEffect(() => {
    api.listNeverSave().then(setHosts).catch(() => setHosts([]));
  }, []);

  async function remove(host: string) {
    await api.removeNeverSave(host);
    setHosts((h) => (h ?? []).filter((x) => x !== host));
  }

  return (
    <div className="card flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2 text-on-surface">
        <ShieldIcon size={16} />
        <h2 className="text-body-md font-semibold">Never offer to save</h2>
      </div>
      <p className="text-body-sm text-on-surface-variant">
        The browser extension will not offer to save logins on these sites. Remove one to let it ask again.
      </p>
      {hosts !== null && hosts.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant opacity-70">No sites.</p>
      ) : (
        <ul aria-label="Never offer to save" className="flex flex-col gap-1.5">
          {(hosts ?? []).map((h) => (
            <li key={h} className="flex items-center justify-between gap-2">
              <span className="font-mono text-body-sm text-on-surface">{h}</span>
              <button type="button" className="btn-secondary" aria-label={`Remove ${h}`} onClick={() => remove(h)}>
                <XIcon size={14} /> Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

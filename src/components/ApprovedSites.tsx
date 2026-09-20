import { useMemo, useState } from "react";
import { KeyIcon, XIcon } from "./Icon";
import { useHotkey } from "../lib/useHotkey";
import type { PairedInfo } from "../lib/types";

/**
 * Every site a paired browser may be handed a password for, in one place.
 *
 * Pairing grants the ability to ask; this is the list of answers. It started
 * as a row of chips under each browser in Settings and outgrew that almost
 * immediately — the list only ever grows, one entry per site you log into,
 * and a growing list buried inside the pairing panel is one nobody reads.
 *
 * Grouped by browser rather than flattened, because revoking is per browser:
 * the same host approved in Chrome and in Firefox is two separate grants.
 */
export default function ApprovedSites({
  clients,
  onRevoke,
  onClose,
}: {
  clients: PairedInfo[];
  onRevoke: (origin: string, host: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  useHotkey("escape", onClose);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return clients
      .map((c) => ({
        client: c,
        hosts: [...c.allowed_hosts]
          .sort((a, b) => a.localeCompare(b))
          .filter((h) => needle === "" || h.includes(needle)),
      }))
      .filter((g) => g.hosts.length > 0);
  }, [clients, query]);

  const total = clients.reduce((n, c) => n + c.allowed_hosts.length, 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Approved sites"
      className="fixed inset-0 z-[65] flex items-center justify-center bg-black/60 p-5"
      onClick={onClose}
    >
      <div
        className="dialog flex max-h-[80vh] w-full max-w-[560px] flex-col gap-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2.5">
          <KeyIcon size={18} />
          <div className="min-w-0 flex-1">
            <p className="label-sm text-secondary">Browser extension</p>
            <h2 className="text-headline-sm text-on-surface">Approved sites</h2>
          </div>
          <button type="button" className="btn-secondary" aria-label="Close" onClick={onClose}>
            <XIcon size={14} />
          </button>
        </div>

        <p className="text-body-sm text-on-surface-variant">
          A paired browser may ask about any site; these are the ones it may be answered for.
          Revoking one puts that site back to asking — nothing else changes, and the browser
          stays paired.
        </p>

        {total > 8 && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by site"
            aria-label="Filter approved sites"
            spellCheck={false}
            autoComplete="off"
            className="field"
          />
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {total === 0 && (
            <p className="text-body-sm text-on-surface-variant opacity-70">
              No sites approved yet. The first time a paired browser wants a password for a
              site, this window will ask.
            </p>
          )}
          {total > 0 && groups.length === 0 && (
            <p className="text-body-sm text-on-surface-variant opacity-70">
              No approved site matches “{query}”.
            </p>
          )}
          {groups.map(({ client, hosts }) => (
            <div key={client.origin} className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2">
                <span className="text-body-sm font-semibold text-on-surface">{client.label}</span>
                <span className="text-label-md text-on-surface-variant opacity-70">
                  {hosts.length} {hosts.length === 1 ? "site" : "sites"}
                </span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {hosts.map((host) => (
                  <li
                    key={host}
                    className="flex items-center justify-between gap-3 rounded-control border border-white/8 px-3 py-2"
                  >
                    <span className="truncate font-mono text-label-md text-on-surface">{host}</span>
                    <button
                      type="button"
                      className="btn-secondary"
                      aria-label={`Stop filling ${host} in ${client.label}`}
                      onClick={() => onRevoke(client.origin, host)}
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

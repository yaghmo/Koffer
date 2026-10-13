import { useState } from "react";
import { api } from "../lib/api";
import type { LeakedLogin } from "../lib/types";

/**
 * Checks saved passwords against Have I Been Pwned, only when asked.
 *
 * It is the one place besides site logos where the app goes online, so it
 * says exactly what leaves the machine before the button, not after.
 */
export default function LeakCheck({ onViewItem }: { onViewItem: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [leaked, setLeaked] = useState<LeakedLogin[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setLeaked(await api.checkLeakedPasswords());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-body-md font-semibold text-on-surface">Leaked passwords</h2>
        {leaked && leaked.length > 0 && <span className="label-sm flex-shrink-0">{leaked.length}</span>}
      </div>
      <p className="text-body-sm text-on-surface-variant">
        Looks each password up in Have I Been Pwned's list of passwords seen in data leaks. Only the
        first 5 characters of each password's hash are sent; your passwords and your accounts never
        leave this machine. A match means the password itself is known to attackers, whichever site
        leaked it.
      </p>

      {error && <p className="text-body-sm text-error">{error}</p>}

      {leaked && leaked.length === 0 && (
        <p className="text-body-sm text-on-surface">None of your passwords appear in a known leak.</p>
      )}

      {leaked && leaked.length > 0 && (
        <ul className="flex max-h-[320px] flex-col gap-1 overflow-y-auto">
          {leaked.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => onViewItem(l.id)}
                className="flex w-full items-center justify-between gap-3 rounded-control px-2 py-1.5 text-left transition-colors duration-150 ease-out hover:bg-surface-container-high"
              >
                <span className="min-w-0 flex-1 truncate text-body-sm text-on-surface">
                  {l.title}
                  {l.username && <span className="text-on-surface-variant"> · {l.username}</span>}
                </span>
                <span className="flex flex-shrink-0 items-center gap-2">
                  <span className="label-md">
                    seen {l.count === 1 ? "once" : `${l.count.toLocaleString()} times`}
                  </span>
                  <span className="flag">Leaked</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="btn-secondary self-start" onClick={run} disabled={busy}>
        {busy ? "Checking…" : leaked ? "Check again" : "Check for leaked passwords"}
      </button>
    </div>
  );
}

import { api } from "./api";
import type { ItemMeta } from "./types";

/** A logo is re-checked at most this often. */
export const ICON_MAX_AGE_DAYS = 30;
const MAX_AGE_SECS = ICON_MAX_AGE_DAYS * 24 * 60 * 60;

/**
 * Re-fetch stale favicons. Returns [updated, checked].
 *
 * Only icons not checked in the last 30 days are fetched: every fetch is an
 * HTTP request to a site you hold an account with, so doing it on every
 * unlock would broadcast that list to the network over and over.
 *
 * `force` means "the user just asked for this" — it is what the Settings
 * button passes, and it skips both the age check and the opt-in check below.
 * Everything else is automatic and stays off unless `auto_refresh_icons` is
 * on, so the check lives here rather than at the call site: an automatic
 * caller added later is off by default without having to remember.
 *
 * Writes through `setItemFavicon`, not `saveItem`, so a refresh never bumps
 * `updated_at` — otherwise it would mark every login as freshly changed and
 * permanently hide the "stale password" health warning.
 */
export async function refreshSiteLogos(
  force = false,
  onProgress?: (done: number, total: number) => void,
): Promise<[number, number]> {
  if (!force && !(await api.getConfig()).auto_refresh_icons) return [0, 0];
  const now = Math.floor(Date.now() / 1000);
  const metas = await api.listItems(undefined, "login");
  const due = force ? metas : metas.filter((m) => now - m.icon_checked_at > MAX_AGE_SECS);
  return [await fetchLogos(due, onProgress), due.length];
}

/**
 * Fetch a logo for logins that have never had one looked up -- what the
 * browser saves arrives with none, and would otherwise sit there as a
 * letter. Not gated on `auto_refresh_icons`: it is the one fetch the editor
 * also makes when a URL is typed in, never a repeat, and the browser has
 * just been on that site anyway.
 */
export async function fetchMissingLogos(): Promise<number> {
  const metas = await api.listItems(undefined, "login");
  return fetchLogos(metas.filter((m) => m.host && !m.favicon && m.icon_checked_at === 0));
}

async function fetchLogos(due: ItemMeta[], onProgress?: (done: number, total: number) => void): Promise<number> {
  let updated = 0;
  let done = 0;
  onProgress?.(0, due.length);
  for (const meta of due) {
    try {
      const full = await api.getItem(meta.id);
      if (full.type === "login" && full.url) {
        const fetched = await api.fetchUrlMetadata(full.url);
        const changed = fetched.favicon_data_url && fetched.favicon_data_url !== full.favicon;
        // Stamped either way, so a site with no icon isn't retried tomorrow.
        await api.setItemFavicon(full.id, changed ? fetched.favicon_data_url : null);
        if (changed) updated++;
      }
    } catch {
      // one site failing (offline, no favicon) shouldn't stop the rest
    }
    onProgress?.(++done, due.length);
  }
  return updated;
}

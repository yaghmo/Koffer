import { api } from "./api";

/** A logo is re-checked at most this often. */
export const ICON_MAX_AGE_DAYS = 30;
const MAX_AGE_SECS = ICON_MAX_AGE_DAYS * 24 * 60 * 60;

/**
 * Re-fetch stale favicons. Returns [updated, checked].
 *
 * Only icons not checked in the last 30 days are fetched: every fetch is an
 * HTTP request to a site you hold an account with, so doing it on every
 * unlock would broadcast that list to the network over and over. `force`
 * skips the age check for the manual button in Settings.
 *
 * Writes through `setItemFavicon`, not `saveItem`, so a refresh never bumps
 * `updated_at` — otherwise it would mark every login as freshly changed and
 * permanently hide the "stale password" health warning.
 */
export async function refreshSiteLogos(force = false): Promise<[number, number]> {
  const now = Math.floor(Date.now() / 1000);
  const metas = await api.listItems(undefined, "login");
  const due = force ? metas : metas.filter((m) => now - m.icon_checked_at > MAX_AGE_SECS);
  let updated = 0;
  for (const meta of due) {
    const full = await api.getItem(meta.id);
    if (full.type !== "login" || !full.url) continue;
    try {
      const fetched = await api.fetchUrlMetadata(full.url);
      const changed = fetched.favicon_data_url && fetched.favicon_data_url !== full.favicon;
      // Stamped either way, so a site with no icon isn't retried tomorrow.
      await api.setItemFavicon(full.id, changed ? fetched.favicon_data_url : null);
      if (changed) updated++;
    } catch {
      // one site failing (offline, no favicon) shouldn't stop the rest
    }
  }
  return [updated, due.length];
}

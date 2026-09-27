import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { BrowserPref, Config } from "../lib/types";
import { SettingsIcon } from "./Icon";

const FEATURES: { pref: BrowserPref; key: keyof Config; label: string; detail: string }[] = [
  {
    pref: "offer_save",
    key: "browser_offer_save",
    label: "Offer to save new logins",
    detail: "After you sign in somewhere new, a bar asks whether to keep the login.",
  },
  {
    pref: "offer_update",
    key: "browser_offer_update",
    label: "Offer to update changed passwords",
    detail: "After a login with a new password, or a password change on the site.",
  },
  {
    pref: "totp",
    key: "browser_totp",
    label: "2FA codes in the browser",
    detail:
      "The popup and right-click menu can type a login's 2FA code into the page, and turning 2FA on at a site offers to save its key.",
  },
  {
    pref: "site_prompt",
    key: "browser_site_prompt",
    label: "Ask to approve a site on the page",
    detail: "A bar on sites this browser is not approved for yet. The popup can still ask.",
  },
  {
    pref: "personal",
    key: "browser_personal",
    label: "Personal info in forms",
    detail: "The popup's ID card fills name, email, phone and address from your profile into sign-up and checkout forms.",
  },
  {
    pref: "confirm_fills",
    key: "browser_confirm_fills",
    label: "Confirm every fill in the app",
    detail:
      "Each password, copy and 2FA code waits for a click here. The browser's key lives in its profile, where a program on this computer could copy it; with this on, the copy is useless without you.",
  },
];

/**
 * What the paired browser may do. The app enforces each switch, so an
 * extension that ignored them would still be refused.
 */
export default function BrowserFeatures() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getConfig().then(setCfg).catch((e) => setError(String(e)));
  }, []);

  async function toggle(pref: BrowserPref, key: keyof Config, on: boolean) {
    setError(null);
    setCfg((c) => (c ? { ...c, [key]: on } : c));
    try {
      await api.setBrowserPref(pref, on);
    } catch (e) {
      setCfg((c) => (c ? { ...c, [key]: !on } : c));
      setError(String(e));
    }
  }

  return (
    <div className="card flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2 text-on-surface">
        <SettingsIcon size={16} />
        <h2 className="text-body-md font-semibold">What the extension may do</h2>
      </div>
      <ul className="flex flex-col divide-y divide-white/6">
        {FEATURES.map((f) => (
          <li key={f.pref} className="py-3 first:pt-0 last:pb-0">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={!!cfg?.[f.key]}
                disabled={!cfg}
                onChange={(e) => toggle(f.pref, f.key, e.target.checked)}
                className="mt-0.5 h-4 w-4 flex-shrink-0 accent-primary"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-body-sm text-on-surface">{f.label}</span>
                <span className="text-body-sm text-on-surface-variant">{f.detail}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}

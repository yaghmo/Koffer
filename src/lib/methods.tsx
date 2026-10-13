import type { LoginMethod } from "./types";

export const methods: { id: LoginMethod; label: string }[] = [
  { id: "credentials", label: "Username & Password" },
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
  { id: "microsoft", label: "Microsoft" },
  { id: "apple", label: "Apple" },
  { id: "facebook", label: "Facebook" },
  { id: "other", label: "Other app" },
];

export const methodLabel = (m: LoginMethod): string =>
  methods.find((x) => x.id === m)?.label ?? "Login";

/**
 * The account you actually type credentials into for each provider. Picking
 * "Google" means signing in with a Gmail address on mail.google.com, so the
 * saved account item is titled and linked that way rather than "Google".
 */
export const PROVIDER_ACCOUNTS: Record<
  Exclude<LoginMethod, "credentials" | "other">,
  { label: string; url: string }
> = {
  google: { label: "Gmail", url: "https://mail.google.com" },
  github: { label: "GitHub", url: "https://github.com" },
  microsoft: { label: "Outlook", url: "https://outlook.live.com" },
  apple: { label: "iCloud", url: "https://www.icloud.com" },
  facebook: { label: "Facebook", url: "https://www.facebook.com" },
};

export function providerAccount(m: LoginMethod): { label: string; url: string } | null {
  return m === "credentials" || m === "other" ? null : PROVIDER_ACCOUNTS[m];
}

/** Emails are case-insensitive in practice, so store them lowercase. */
export function normalizeAccount(v: string): string {
  return v.includes("@") ? v.toLowerCase() : v;
}

// Provider hints: email domains + URL keywords that identify a provider.
const PROVIDER_HINTS: Record<
  Exclude<LoginMethod, "credentials" | "other">,
  { domains: string[]; urlKeywords: string[] }
> = {
  google: { domains: ["gmail.com", "googlemail.com"], urlKeywords: ["google.com"] },
  github: { domains: [], urlKeywords: ["github.com"] },
  microsoft: { domains: ["outlook.com", "hotmail.com", "live.com", "msn.com"], urlKeywords: ["microsoft.com", "live.com", "outlook.com"] },
  apple: { domains: ["icloud.com", "me.com", "mac.com"], urlKeywords: ["apple.com", "icloud.com"] },
  facebook: { domains: [], urlKeywords: ["facebook.com"] },
};

/** Which provider an account identifier belongs to, or null (e.g. "me@gmail.com" → "google"). */
export function providerForAccount(account: string): LoginMethod | null {
  if (!account) return null;
  const lower = account.toLowerCase();
  const at = lower.lastIndexOf("@");
  const domain = at >= 0 ? lower.slice(at + 1) : "";
  for (const key of Object.keys(PROVIDER_HINTS) as (keyof typeof PROVIDER_HINTS)[]) {
    if (PROVIDER_HINTS[key].domains.includes(domain)) return key;
  }
  return null;
}

/** True when the account identifier belongs to the given provider. */
export function accountMatchesProvider(account: string, method: LoginMethod): boolean {
  if (method === "credentials") return false;
  // "Other" covers providers we don't model, so any login in the vault qualifies.
  if (method === "other") return true;
  return providerForAccount(account) === method;
}

/** Brand mark per provider, in the provider's own colors. */
export function MethodChip({ method, size = 18 }: { method: LoginMethod; size?: number }) {
  const box = { width: size, height: size, flexShrink: 0 };
  switch (method) {
    case "google":
      return (
        <svg style={box} viewBox="0 0 48 48" aria-hidden>
          <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.7-.4-3.9H24v7.1h12.1c-.2 1.8-1.6 4.5-4.5 6.3l6.9 5.3c4.1-3.8 6.6-9.4 6.6-14.8z" />
          <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.3c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C8.1 41.1 15.4 46 24 46z" />
          <path fill="#FBBC05" d="M11.5 28.5c-.5-1.4-.7-2.9-.7-4.5s.3-3.1.7-4.5l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.4 10z" />
          <path fill="#EA4335" d="M24 10.6c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4.500 29.9 2 24 2 15.4 2 8.1 6.9 4.4 14l7.1 5.5c1.8-5.3 6.7-8.9 12.5-8.9z" />
        </svg>
      );
    case "github":
      return (
        <svg style={box} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="#ffffff"
            d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.8 10.9.6.1.8-.2.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.8 0-1.3.5-2.3 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.4 11.4 0 0 1 6 0C17.5 5 18.5 5.3 18.5 5.3c.6 1.7.2 2.9.1 3.2.8.9 1.2 1.9 1.2 3.2 0 4.5-2.7 5.5-5.3 5.8.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.8-5.8 7.8-10.9C23.5 5.7 18.3.5 12 .5z"
          />
        </svg>
      );
    case "microsoft":
      return (
        <svg style={box} viewBox="0 0 24 24" aria-hidden>
          <rect x="1" y="1" width="10" height="10" fill="#F25022" />
          <rect x="13" y="1" width="10" height="10" fill="#7FBA00" />
          <rect x="1" y="13" width="10" height="10" fill="#00A4EF" />
          <rect x="13" y="13" width="10" height="10" fill="#FFB900" />
        </svg>
      );
    case "apple":
      return (
        <svg style={box} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="#ffffff"
            d="M17.1 12.6c0-2.6 2.1-3.9 2.2-4-1.2-1.8-3.1-2-3.8-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.5 0 2 .8 3.3.8 1.4 0 2.2-1.2 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.6-1-2.6-3.9zM14.6 4.7c.7-.9 1.2-2.1 1.1-3.3-1 0-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.2 1.1.1 2.3-.6 3-1.5z"
          />
        </svg>
      );
    case "facebook":
      return (
        <svg style={box} viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="11" fill="#1877F2" />
          <path
            fill="#ffffff"
            d="M15.9 15.5l.5-3.2h-3.1v-2.1c0-.9.4-1.7 1.8-1.7h1.4V5.7s-1.3-.2-2.5-.2c-2.5 0-4.2 1.5-4.2 4.3v2.5H6.9v3.2h2.9V23a11.6 11.6 0 0 0 3.5 0v-7.5z"
          />
        </svg>
      );
    case "other":
      return (
        <svg style={box} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-on-surface-variant" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12h8M12 8v8" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg style={box} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-on-surface-variant" aria-hidden>
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      );
  }
}

# Security policy

This is a password manager, so a security bug here is worth more than any
other kind. Thank you for looking.

## Reporting a vulnerability

**Please do not open a public issue.** Report it privately through GitHub:
the repository's **Security** tab → **Report a vulnerability**. Only the
maintainer sees it, and the fix can ship before the details are public.

Include what you can of:

- what an attacker needs (a web page the user visits, a local process, a
  copy of the vault file, a copy of the browser profile...);
- the steps, or a proof of concept;
- what they get: which secret, or which action they can take.

You will get an answer within a week. Once a fix is out, the advisory is
published with credit to you, unless you would rather not be named.

## Supported versions

Only the latest release, and the `main` branch, get security fixes.

## Scope

In scope: the desktop app (`src-tauri/`, `src/`), the browser extension
(`extension/`) and the loopback bridge between them, and the optional
cloud-backup worker (`worker/`).

The design and the threats it answers are written down, which is the best
place to start looking:

- `extension/README.md` — how the extension pairs, signs every request,
  asks for per-site approval, and what a local process holding the browser's
  key can and cannot do;
- `PRODUCT.md` — the crypto (Argon2id, AES-256-GCM) and what never leaves
  the machine;
- `worker/README.md` — what the backup can and cannot read.

Known limits, already documented and not vulnerabilities on their own:

- Anything running as you on an unlocked machine can read what you can
  read; the vault defends the file at rest, not a compromised session.
- The browser's signing key lives in its profile. "Confirm every fill" in
  Settings is the answer to a copied key.
- There is no password recovery by design. Losing the master password and
  the recovery code loses the vault.

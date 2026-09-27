# Privacy policy

*Last updated: 28 September 2026.*

Password Manager collects nothing. There is no account, no server of ours,
no analytics, no telemetry and no crash reporting. What you store stays in
one encrypted file on your computer, readable only with your master
password.

## What stays on your computer

- **The vault** — logins, cards, notes, personal info — is one file
  encrypted with AES-256-GCM, under a key derived from your master password
  with Argon2id. The master password is never stored.
- **Settings and logs** sit next to it. The logs record what the app did
  (for example "filled one login"), never a password, key or personal value.

## When the app uses the network

Only in three cases, each started by you:

1. **Site logos.** When you enter a web address on a login, ask Settings to
   refresh logos, or turn on automatic logo refresh, the app fetches that
   site's page title and icon. The site learns that someone at your IP
   address loaded its icon. Nothing from the vault is sent.
2. **The leaked-password check** (Stats page, opt-in). For each password the
   app sends the first 5 characters of its SHA-1 hash to Have I Been Pwned
   (`api.pwnedpasswords.com`) and compares the answer on your computer. The
   password, and the full hash, never leave it.
3. **Cloud backup** (opt-in). The already-encrypted vault file is uploaded to
   a storage bucket in **your own** Cloudflare account, which you set up. We
   operate no server and cannot see it. See `worker/README.md`.

## The browser extension

- It talks only to the Password Manager app on your own computer, over
  `127.0.0.1`. It sends nothing to us or to any third party.
- It reads the page you are on to find login, code and form fields, and
  writes into them when you ask it to. What you type into a login form, and
  the key a site shows when you turn on two-factor sign-in, may be held in
  the browser's session memory for up to two minutes so the app can offer to
  save it; it is never written to disk and never sent anywhere but the app.
- The popup shows site logos the app already stored; it never loads an
  image from the web.

## Your data, your control

Everything is on your computer: you can export it, back it up, or delete the
vault file at any time, and nothing remains anywhere else — except a cloud
backup, if you turned one on, which lives in your Cloudflare account and
which you can delete there.

## Changes

Changes to this policy are made in this file, and its history is public in
the repository.

## Contact

Questions: open an issue at <https://github.com/yaghmo/password_manager>.
Security problems: see `SECURITY.md` and report them privately.

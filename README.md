# Koffer

https://github.com/user-attachments/assets/0163ac7f-79cf-41f3-ae34-32566a003547

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-3dbe8b)](LICENSE)
![Windows 10/11](https://img.shields.io/badge/Windows-10%20%7C%2011-0b0d10)
![Tauri 2](https://img.shields.io/badge/Tauri-2-0b0d10)
![Rust 1.75+](https://img.shields.io/badge/Rust-1.75%2B-0b0d10)
![Node.js 22.12+](https://img.shields.io/badge/Node.js-22.12%2B-0b0d10)
[![Extension: Chrome | Firefox](https://img.shields.io/badge/extension-Chrome%20%7C%20Firefox-0b0d10)](extension/README.md)

Local-only encrypted password manager for Windows. Tauri + React.

## Features

- Logins, cards, notes and a personal-info profile in one encrypted file (AES-256-GCM, Argon2id key from the master password)
- Recovery code at setup; no other way back in, by design
- Two-factor codes: paste a key or a screenshot of the QR code
- Password generator, opt-in leaked-password check, password history, and vault health on the Stats page
- Auto-lock after 15-30 minutes of inactivity, clipboard auto-clear (30s default)
- Encrypted export and import, and an optional backup of the encrypted file to your own Cloudflare account
- Browser extension for Chrome and Firefox: fills logins and 2FA codes, saves new logins, fills sign-up forms from your profile

## Install

Download the `.msi` from the [releases page](https://github.com/yaghmo/Koffer/releases) and double-click it.

The installer is not code-signed yet, so Windows SmartScreen warns on first run: click **More info**, then **Run anyway**. Each release lists SHA-256 hashes to check the download against. To check one, run `Get-FileHash` on the downloaded file in PowerShell and compare the result with the SHA-256 line in that release's notes.

## Requirements

Only for building from source.

- Windows 10/11
- Rust 1.75+ ([rustup](https://rustup.rs))
- Node.js 22.12+
- Tauri prerequisites: <https://tauri.app/start/prerequisites/>

## Develop

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

Installer: `src-tauri/target/release/bundle/msi/`

## Test

```bash
npm test                    # frontend
cd src-tauri && cargo test  # backend
```

## Manual test checklist

1. First run → setup wizard → create master password
2. Vault view appears
3. Add a login (title, URL, username, password) → save
4. Lock vault (bottom of the sidebar) → returns to lock screen
5. Unlock with same password → login still there
6. Wrong password → "Wrong password. Try again."
7. Generate password → length slider, class checkboxes → Copy
8. Copy a password from a login → wait 30s → clipboard should be cleared
9. Idle (configurable minutes) → app auto-locks

## Security notes

- Master password is never stored; lose it = lose your vault
- Vault file is encrypted at rest; safe to back up
- Closing the window hides it to the tray; the vault stays unlocked until you lock it (tray or button) or auto-lock fires. Exiting from the tray locks and wipes first
- Master key lives in Rust memory only; never crosses the IPC boundary
- One network call at launch: a check for a newer version (one public file on GitHub; nothing from the vault is sent, and nothing installs until you click Update). The rest are started by you: a site's title and favicon when you enter a login URL (public hosts only, size-capped), the opt-in leaked-password check (5 characters of a hash), and the opt-in backup to your own Cloudflare account. Vault contents are never sent in the clear. See `PRIVACY.md`.
- The browser extension talks to the app over `127.0.0.1:38471` (or the next free port, which the pairing code then names) — loopback only, and only after you pair it by hand. There is no shared token: the browser signs each request with a key its own JavaScript cannot export, and a password for a site it has not been approved for raises a dialog here first. `extension/README.md` has the whole model, including what it does not defend against.

## Security review

On 2026-11-14 an AI model (Claude Sonnet), directed by the author, read the parts of the code listed below and wrote tests against them. The same day it ran `cargo audit`, `npm audit` and a gitleaks scan of the full git history. This is not a third-party audit, and Koffer is built and maintained by one person.

The review covered the loopback bridge and the sealed channel between the app and the extension, vault storage and recovery, the cloud backup client and worker, the favicon and title fetch, the app's command surface, and the extension's manifest, background and content scripts. The attackers considered were a web page, another program on the same machine (including one that takes the bridge's port while the app is closed), someone holding a copy of the vault file, and the backup server.

It found nothing critical or high. Three low issues were fixed: a latent crash on a bad nonce length, a login URL that was checked in one form but opened in another, and a recorded reply from the app that could be replayed to the extension as the answer to a later request. Each reply is now tied to the request it answers, so update the app and the extension (0.5.0) together. Dependency updates cleared 13 of 18 `cargo audit` advisories and 2 high `npm audit` advisories.

These are known and still open:

- The extension's signing key lives in the browser profile, so a copy of the profile is a copy of the key. The defence is "Confirm every fill in the app" in Settings, under Browser extension.
- `export_vault` and `import_vault` take any path from the app window, so a compromised window could overwrite or read files you can reach. The content security policy makes that unlikely.
- The favicon fetch treats some special IPv6 and IPv4 ranges as public.
- A local process can use up the three pairing tries and force you to pair again.
- Whoever holds the backup upload token can overwrite the latest backup, and the app cannot tell an old copy from a new one.
- Unlocking has no attempt counter beyond the cost of Argon2id, and the password minimum is 8 bytes with no strength check.
- Two dependency advisories remain. `crypto-bigint` (RUSTSEC-2026-0387, timing variability, via `p256`) needs a major `p256` upgrade. `zip` (four advisories, via `tauri-plugin-updater`) only unpacks an update after its signature is verified, so an attacker would need a signed malicious archive. Some unmaintained crates in the build chain also remain.

The review never launched the app, the extension or a browser, so nothing was tested end to end. Several files were skimmed or skipped, including most of the extension popup and save bar, the React code, and parts of the item logic. It did not look at the built installer, GitHub settings, WebView2, or malware already running under your account.

Report a problem privately as described in [SECURITY.md](SECURITY.md).

## Out of scope (v1)

- Sync, mobile, multi-user
- Lock on Windows session lock (planned for v1.1)

## Browser extension

Fills, saves and offers 2FA codes in Chrome and Firefox, talking only to the
app on `127.0.0.1`. See [`extension/README.md`](extension/README.md).

**Try it without touching real accounts:** the
[test site](https://yaghmo.github.io/koffer/) has sign-in, sign-up,
two-step, phone, 2FA and "Sign in with…" pages. Everything on it is fake and
stays in your browser. `npm run testsite` serves the same pages locally.

## Contributing, security and privacy

- [CONTRIBUTING.md](CONTRIBUTING.md): how to build, test and send a change.
- [SECURITY.md](SECURITY.md): report vulnerabilities privately, never in an issue.
- [PRIVACY.md](PRIVACY.md): nothing is collected; the few network calls, all started by you.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [CHANGELOG.md](CHANGELOG.md).

## Support

If this is useful to you, you can [sponsor its development](https://github.com/sponsors/yaghmo).

## License

Copyright (C) 2026 Yaghmoracen Belmir.

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. It is distributed WITHOUT ANY WARRANTY; see [LICENSE](LICENSE) for
the full text.

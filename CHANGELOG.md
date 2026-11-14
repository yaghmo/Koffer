# Changelog

Notable changes, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- In-app updates. The app checks at launch for a newer build and asks before
  installing it; the download must be signed by Koffer's updater key. Once
  that key is a CI secret, pushing a `vX.Y.Z` tag publishes an update (see
  `SIGNING.md`).

### Changed

- New look, "Midnight": dark slate surfaces that step lighter as they come
  forward, one emerald accent for the main action of a screen, amber only for
  warnings. Flat, with no glow, glass or gradient. Set in Inter (bundled, never
  fetched) with IBM Plex Mono for passwords and codes. See `DESIGN.md`.
- Interface text rewritten in short plain sentences.
- New mark: a locked case with a light body, a slate handle and an emerald
  keyhole, on the dark rail. App, installer and extension icons are redrawn
  from it.
- Browser extension 0.4.0: the popup, the save bar and the pointer wear the
  same look. The toolbar badge is emerald.

### Removed

- IBM Plex Sans, from the app and the extension, and the old banner and launch
  video files in `design/`.

## [0.1.0] - 2026-10-05

First public release.

### Vault

- Logins, cards, notes and a personal-info profile in one file, encrypted
  with AES-256-GCM under an Argon2id key from the master password.
- Recovery code at setup; no other way back in, by design.
- Password generator, leaked-password check (Have I Been Pwned, k-anonymity,
  opt-in), password history, stale-password health on the Stats page.
- Two-factor codes: paste a key or a screenshot of the QR code.
- Auto-lock, clipboard auto-clear, encrypted export and import.
- Optional backup of the encrypted file to your own Cloudflare account.

### Browser extension (Chrome, Firefox)

- Pairs with the app over `127.0.0.1`; every request is signed with a key
  the browser cannot export, and each site needs approval in the app.
- Fills logins, including two-step sign-ins, phone logins and 2FA codes;
  offers the code of the account just signed in with.
- Offers to save new logins and changed passwords -- a forced "choose a new
  password" page updates the login just used -- and to save a site's 2FA
  key when you turn two-factor on there.
- Fills sign-up and checkout forms from your profile, and offers a strong
  generated password for new-password boxes.
- Points at a site's "Sign in with Google / GitHub ..." button for logins
  that use one, without clicking it.
- Optional: confirm every fill in the app.

### Security

- Three security reviews, the last of the whole repository; everything they
  found is fixed. Among them: a fresh vault key on
  every password or recovery change, the browser switches kept inside the
  encrypted vault, "confirm every fill" covering writes, one-time request
  signatures, and no site names in the log.

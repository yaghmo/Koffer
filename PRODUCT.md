# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

> Note: the app is a Tauri 2 desktop shell (Windows-targeted, built via `npm run tauri build` -> MSI). The frontend inside that shell is web. Live mode is not configured because iteration is via `npm run tauri dev` and frontend-only `vite dev`, not a browser session.

## Stack

- Tauri 2 (Rust backend) + React 18 + TypeScript 5 + Vite 5
- Rust 1.98.1, MSRV 1.75
- argon2 0.5 (Params::new(64*1024, 3, 1, Some(32)))
- aes-gcm 0.10 (12-byte fresh nonce per save)
- Vitest 2.1, Testing Library

## Users

Primary: a privacy- and security-aware individual running a personal Windows machine. They want a single, trustworthy place for credentials, payment cards, and private notes. They distrust cloud sync, browser built-ins, and ad-supported password services. They will run the app on a machine they own and lock it when they walk away.

Secondary: a developer reading the source to evaluate crypto hygiene before adopting. The UI must not contradict the engineering story.

## Product Purpose

Hold the user's secrets, encrypted at rest with a key only the master password can derive, on a machine no one else can reach. The product's reason to exist is the gap between "I trust my OS / browser / cloud" and "I want my secrets to be a single AES-GCM blob on disk that needs my password to read, with no network, no telemetry, no second copy."

Success means: the user unlocks once, finds or copies what they need, locks again. They do not think about the app between those moments. When they think about it, the absence of motion, the quietness of the canvas, and the visible care in the screen confirm it was worth installing.

## Positioning

The product is the inverse of a synced, multi-device password manager. Its mechanism — local-only Argon2id + AES-256-GCM, vault contents never leaving the machine, master key never crossing the Rust/JS boundary — is the same claim a competing product cannot make. The UI must show that mechanism only through absence: no sync indicators, no "your data is safe with us" copy, no cloud, no telemetry. Calm is the brand.

## Operating Context

- One user, one Windows 11 machine, one encrypted vault.
- The vault file lives at `%APPDATA%/password_manager/vault.enc` and the config at `%APPDATA%/password_manager/config.json`.
- Workflow: open app -> unlock -> search/browse/copy -> lock (or auto-lock fires).
- Auto-lock default 15 min (range 15-30). Clipboard TTL default 30 s.
- The "forgot password" flow is destructive by design: there is no recovery path, by design.

## Capabilities and Constraints

Capabilities:
- Create / unlock / lock / reset a vault with a master password (min 8 chars).
- Store login (url, username, password), note (body), card (cardholder, number, exp, cvv) items.
- Search by title, filter by kind.
- Generate passwords with configurable length and class composition.
- Copy to clipboard with TTL auto-clear.
- Auto-lock on idle.
- Reset vault from the Lock screen with password re-verification.

Constraints (durable):
- Local-only. Vault contents never leave the machine. Two network calls exist, both started by the user: fetching a site's title and favicon when a login URL is entered (public http(s) hosts only, size-capped, nothing from the vault sent), and the leaked-password check on the Stats page, which sends only the first 5 hex characters of each password's SHA-1 hash to Have I Been Pwned.
- Master key lives in Rust memory only; never serialized, never crosses the JS boundary.
- Argon2id (m=64 MiB, t=3, p=1) for key derivation.
- AES-256-GCM with a fresh 12-byte nonce per save.
- 16-byte KDF salt per vault, generated at setup.
- Auto-lock 15-30 min (default 15). Clipboard TTL 30 s default.
- Master password min 8 chars.
- Frontend never holds secrets at rest (clipboard aside).
- The "forgot password" path is destructive. There is no backdoor.

Accessibility (confirmed): keyboard-driven; the app must be fully usable without a mouse. Reveal toggles for password fields. Sufficient color contrast for body text and form states. Auto-lock should be paused on detected activity (already wired: mousedown + keydown reset the timer).

## Brand Commitments

None binding. Design is free within a tone the user described as "calm, security-respecting, no noise." Public release polish level applies: tasteful, refined, full product — but no enterprise-formal chrome.

## Evidence on Hand

- Working Tauri 2 desktop app, 41 lib + 2 integration Rust tests passing, 16 frontend tests passing, tsc clean, MSI build green.
- All 25 plan tasks complete; full feature set present.
- README in repo root (manual test checklist, build instructions).
- The incumbent visual system is a dark, generic, form-on-canvas theme. It is not a reference for the new world; it is evidence of what to replace.

## Product Principles

1. The UI should look like it does not need to talk loud. The strongest signal of trust here is restraint.
2. The lock screen and the reset flow are moments where the user is most exposed. They must feel deliberate, not procedural.
3. Speed is a security property. Search, copy, and unlock should feel instant, because hesitation makes the user retype the master password.
4. There is no sync indicator because there is no sync. Affordances that imply a network must not exist.
5. The master password is the only key. Every screen treats it that way.

## Accessibility & Inclusion

- Full keyboard navigation; no interaction that requires a mouse.
- Password fields have reveal toggles (existing).
- Sufficient contrast for body text and form states (target WCAG AA at minimum).
- Auto-lock pauses on detected user activity (mousedown + keydown) (existing).
- Modal dialogs use `role="dialog"` and `aria-modal="true"` (existing pattern in reset modals).

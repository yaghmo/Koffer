# Contributing

Thanks for helping. Bug reports, fixes, tests, docs and ideas are all
welcome.

**Found a security problem?** Do not open an issue; see `SECURITY.md`.

## Before you start

For anything bigger than a small fix, open an issue first and describe the
change. It saves you writing code that goes a direction the project will
not take. A few things are settled on purpose:

- **Local only.** No accounts, no sync service, no telemetry. New network
  calls need a very good reason and must be started by the user.
- **The master key never leaves Rust.** Nothing secret crosses into the web
  view at rest.
- **The extension never acts on its own.** It fills, saves or points when
  the user clicks, and every bridge route checks approval in the app.

## Set up

Requirements: Rust 1.75+, Node.js 20+, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev        # the app
npm run testsite         # a fake site for trying the extension
```

Load the extension from `extension/` as an unpacked (Chrome) or temporary
(Firefox) add-on; `extension/README.md` has the steps and how pairing works.

## Checks

Run these before sending a change; CI runs them too.

```bash
npm test                                  # frontend and extension (Vitest)
npx tsc --noEmit                          # types
cd src-tauri && cargo test --lib          # backend
cd src-tauri && cargo clippy --all-targets
npm run ext:lint                          # extension (web-ext)
```

A change to behaviour comes with a test that fails without it.

## Style

- Match the code around you: naming, comment density, idioms.
- Comments say **why**, not what: the constraint, the attack, the site that
  broke. The reasoning is often the most valuable part of a change here.
- Keep changes small and focused; one idea per pull request.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `test:` ...).

## Pull requests

- Describe what changed and why, and how you tested it.
- Update the docs that the change makes wrong (`README.md`,
  `extension/README.md`, `PRIVACY.md`).
- Screenshots help for anything visible.

## License

By contributing, you agree that your contribution is licensed under the
GNU General Public License v3.0 or later, the same as the project.

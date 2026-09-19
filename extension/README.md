# Browser extension

Detects login forms as you browse, badges the toolbar icon, and fills the
page from the vault when you pick an item.

## Load it

1. `chrome://extensions` → turn on **Developer mode**.
2. **Load unpacked** → select this folder.
3. In the vault app: **Settings → Browser extension → Pair a browser**.
4. Click the extension's toolbar icon and type the code it shows.

Edge, Brave, Opera and Vivaldi are the same steps — same MV3, same APIs.

### Firefox

`about:debugging` → **This Firefox** → **Load Temporary Add-on** → pick
`manifest.json`. Then pair exactly as above.

Two things differ, and both are handled:

- Firefox has no background service worker, so the manifest declares
  `background.scripts` next to `background.service_worker`. Each browser
  reads its own key. Chrome logs a warning about `scripts` needing manifest
  v2 and then loads the extension anyway — that warning is expected.
- Firefox treats `host_permissions` as *optional*, so the fetch to
  `127.0.0.1` is blocked until the user agrees. Pairing asks for it on the
  click, which is the only moment the prompt is allowed.

Safari needs an Xcode conversion and a macOS host app, and the vault itself
is Windows-only, so it is not on the list.

## What is here

| File | Does |
| --- | --- |
| `manifest.json` | MV3 manifest, Chromium and Firefox from one file. |
| `autofill.js` | Dependency-free DOM library: `detect`, `isLogin`, `fill`. No browser APIs, so it is unit-tested in `src/__tests__/autofillDetect.test.ts`. |
| `content.js` | Runs `autofill.js` on every page, reports the verdict, fills on request. |
| `background.js` | Service worker. Per-tab badge, and the right-click menu. |
| `popup.js` / `popup.html` | Where a fill is normally started. |
| `vault.js` | The one seam that talks to the desktop app. |
| `demo.html` | Open directly in a browser to exercise `autofill.js` by hand. |

## How it reaches the vault

The app listens on `127.0.0.1:38471` and answers nothing useful until a
human pairs this extension: the app shows an eight-character code, you type
it in here once, and the app hands back a token it stores **inside the
encrypted vault**. Four rules hold it up, and `src-tauri/src/bridge.rs` is
where they are enforced:

- **Loopback only.** It binds `127.0.0.1`, never `0.0.0.0`.
- **A human pairs it.** No other process on the machine can read a code off
  your screen, so no other process can pair itself. The code lasts three
  minutes, works once, and dies after three wrong guesses.
- **The token lives in the vault.** Encrypted at rest, and unverifiable the
  moment the vault locks — which is exactly when the extension should stop
  being able to ask for anything.
- **Rust decides what an origin may see.** This extension says which origin
  it is acting for; the app filters every lookup by it. Naming an item id is
  not enough — the origin has to own it. A bug up here cannot turn into one
  site's password being handed to another.

No response carries an `Access-Control-Allow-Origin` header and every
request must arrive with a `chrome-extension://` `Origin`, so a web page
that guesses the port still cannot read a thing.

Unpair from **Settings → Browser extension**; that revokes the token
immediately, whatever the browser still has stored.

A fill deliberately does **not** extend the unlocked session. If it did,
anything holding a token could poll the bridge and keep the vault open for
ever. When a fill lands close to the auto-lock, the app comes forward and
asks whether to stay unlocked — only an answer there extends it.

## What this does not defend against

- **A local process running as you.** The token lives in
  `chrome.storage.local`, a file in the browser profile, so malware can read
  it and use these routes directly. It needs the vault unlocked, and
  unpairing kills it, but it is a shorter path to plaintext than existed
  before. This is a deliberate trade for one-click autofill.
- **A compromised extension.** Pairing grants the whole vault, not one site:
  whoever holds the token picks which origin to ask about.
- **A forged `Origin` header.** Browsers will not let a page forge it, so
  pages really are shut out — but any local process can set it to anything.
  The pairing code and the token are what actually hold the door.

## Windows with no toolbar

"Sign in with Google" usually opens a `window.open` popup: a real browser
window with no toolbar, so there is no extension icon to click. The content
script still runs there and still detects the form — the *UI* is what is
missing, in exactly the window that needs it.

So the accounts for that page are also on the **right-click menu** of any
text field, under "Password Manager". Same rules as the popup: only
fillable accounts are clickable, and a provider login appears greyed out
naming the account you used.

Context menus are global rather than per-tab, so the menu can go stale if
you switch tabs without navigating. That is safe, not just unlikely: the
origin the menu was built for travels with the fill, and the content script
drops it when it no longer matches the page it is running in.

## Why the popup, and not an automatic fill

Detection badges a tab. It never fills. A password is written into a page
only when someone clicks the item they want, on the origin shown directly
above it in the popup. A page that can make the extension type a password
without that click is the whole attack, so the click is the feature.

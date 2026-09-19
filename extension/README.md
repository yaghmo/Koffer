# Browser extension

Detects login forms as you browse, badges the toolbar icon, and fills the
page from the vault when you pick an item.

## Load it

1. `chrome://extensions` → turn on **Developer mode**.
2. **Load unpacked** → select this folder.

Firefox and Safari are not packaged yet; the manifest is Chrome MV3.

## What is here

| File | Does |
| --- | --- |
| `manifest.json` | MV3 manifest. One permission, `activeTab`. |
| `autofill.js` | Dependency-free DOM library: `detect`, `isLogin`, `fill`. No browser APIs, so it is unit-tested in `src/__tests__/autofillDetect.test.ts`. |
| `content.js` | Runs `autofill.js` on every page, reports the verdict, fills on request. |
| `background.js` | Service worker. Turns a verdict into a per-tab badge. |
| `popup.js` / `popup.html` | The only place a fill can be started. |
| `vault.js` | The one seam that talks to the desktop app. |
| `demo.html` | Open directly in a browser to exercise `autofill.js` by hand. |

## Not wired up yet

`vault.js` rejects every call with `not-paired`, so the popup can show the
page state but has no items to offer. Choosing the transport — a localhost
socket with a pairing key, or a native-messaging host — replaces that one
file plus its counterpart in the Rust app, and nothing else.

## Why the popup, and not an automatic fill

Detection badges a tab. It never fills. A password is written into a page
only when someone clicks the item they want, on the origin shown directly
above it in the popup. A page that can make the extension type a password
without that click is the whole attack, so the click is the feature.
